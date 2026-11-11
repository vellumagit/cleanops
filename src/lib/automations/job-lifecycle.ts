import "server-only";
import { admin, isAutomationEnabled } from "./shared";
import { notify } from "@/lib/notify";
import { orgDividesCrewHours } from "@/lib/crew-hours";

// ─────────────────────────────────────────────────────────────────
// 33b. Job watch — the job that passed in silence
//
// Sibling of the clock-OUT guardrail above, watching the other end of the
// shift. Sollos already notices a job nobody was assigned to, and a shift
// nobody clocked out of. Nothing noticed the job that was assigned, came and
// went, and produced no evidence anyone did it: no clock-in, no status change,
// no human touch. Auto-complete then flips it and drafts an invoice, so the
// first person to discover nothing happened is the client reading the bill.
//
// Two words, each said once (src/lib/job-watch.ts holds the decision):
//   late start   → nudge the crew while showing up is still possible
//   no clock-in  → ask the office, before the money moves
//
// Silent for orgs that don't clock in at all — otherwise every job they book
// would raise a flag, and an alert that is always on is invisible.
// ─────────────────────────────────────────────────────────────────

export async function runJobWatch(): Promise<{
  considered: number;
  nudged: number;
  flagged: number;
  /** Orgs skipped because they have no recent clock-in activity at all. */
  orgsWithoutClockIn: string[];
}> {
  const db = admin();
  const { notify } = await import("@/lib/notify");
  const { classifyJob, lateStarters, orgUsesClockIn, saidForThisSchedule } = await import("@/lib/job-watch");
  const { jobWindowEndMs } = await import("@/lib/job-state");
  const { resolveBookingCoverage } = await import("@/lib/booking-coverage");
  const { getOrgTimezone } = await import("@/lib/org-timezone");
  const { formatDateTime } = await import("@/lib/format");

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  // Three days back: far enough to catch a weekend of silence, short enough
  // that switching this on doesn't dredge up months of history in one alert.
  const sinceIso = new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates } = (await db
    .from("bookings")
    .select(
      `id, organization_id, scheduled_at, duration_minutes, status, assigned_to,
       no_show_nudge_sent_at, no_clock_in_flagged_at, divide_hours_evenly, created_at,
       client:clients ( name )`,
    )
    .in("status", ["confirmed", "en_route", "in_progress"])
    .gte("scheduled_at", sinceIso)
    .lte("scheduled_at", nowIso)
    // Newest first: if the cap ever bites, the jobs that fall off are the
    // oldest, whose window has long passed and whose flag already went.
    .order("scheduled_at", { ascending: false })
    .limit(500)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      scheduled_at: string;
      duration_minutes: number | null;
      divide_hours_evenly: boolean | null;
      status: string;
      assigned_to: string | null;
      no_show_nudge_sent_at: string | null;
      no_clock_in_flagged_at: string | null;
      created_at: string;
      client: { name: string | null } | null;
    }> | null;
  };

  const considered = candidates?.length ?? 0;
  let nudged = 0;
  let flagged = 0;
  const orgsWithoutClockIn: string[] = [];
  if (!candidates || candidates.length === 0) {
    return { considered, nudged, flagged, orgsWithoutClockIn };
  }

  // Staffing (assignee OR crew OR claimed offer) and clock-in evidence, both
  // in one pass for every candidate rather than per-booking round trips.
  const ids = candidates.map((b) => b.id);
  const { selectInChunks } = await import("@/lib/supabase/chunked-in");
  const [coverage, { data: entryRows, error: entryErr }] = await Promise.all([
    resolveBookingCoverage(ids),
    // Chunked, and the error is fatal for this run: up to 500 ids in one
    // `.in()` overflowed the request before, and a failed read here looks
    // exactly like "nobody clocked in anywhere" — which would nudge every
    // crew and flag every job to the office, permanently.
    selectInChunks<{ booking_id: string | null }>(ids, (chunk) =>
      db
        .from("time_entries")
        .select("booking_id")
        .in("booking_id", chunk) as unknown as PromiseLike<{
        data: Array<{ booking_id: string | null }> | null;
        error: { message: string } | null;
      }>,
    ),
  ]);
  if (entryErr) {
    throw new Error(`job watch: clock-in evidence query failed: ${entryErr.message}`);
  }
  const clockedBookings = new Set(
    entryRows.map((r) => r.booking_id).filter(Boolean) as string[],
  );

  const byOrg = new Map<string, typeof candidates>();
  for (const b of candidates) {
    const list = byOrg.get(b.organization_id) ?? [];
    list.push(b);
    byOrg.set(b.organization_id, list);
  }

  for (const [orgId, jobs] of byOrg) {
    try {
      const [nudgeOn, alertOn, orgDivides] = await Promise.all([
        isAutomationEnabled(orgId, "job_not_started_nudge"),
        isAutomationEnabled(orgId, "no_clock_in_alert"),
        // A scheduling preference, read without the master switch like every
        // other reader (crew-hours.ts). Not an automation to be paused.
        orgDividesCrewHours(orgId),
      ]);
      if (!nudgeOn && !alertOn) continue;

      // Does this org clock in at all? An org running on paper would flag
      // every job it books.
      const { count: recentEntries } = (await db
        .from("time_entries")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .gte(
          "clock_in_at",
          new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString(),
        )) as unknown as { count: number | null };
      if (!orgUsesClockIn(recentEntries ?? 0)) {
        orgsWithoutClockIn.push(orgId);
        continue;
      }

      const toFlag: typeof jobs = [];
      // Late starts, each person measured from her own segment. Decided for
      // the whole org first so the "already told her" lookup is one query.
      type LateNudge = {
        booking: (typeof jobs)[number];
        membershipId: string;
        dueAtMs: number;
        key: string;
        /** True when this nudge covers the last person on the job. */
        last: boolean;
      };
      const lateNudges: LateNudge[] = [];

      for (const b of jobs) {
        // The window is the one the rules use (jobWindowEndMs): the crew's
        // shared length — an 18-hour house with four rostered is a 4.5-hour
        // window — or the end of the latest segment when people work their
        // own. A split 4h + 4h shift is an 8-hour window, and measuring it
        // as 4 asked the office about silence while the second cleaner's
        // part had barely begun.
        const cov = coverage.get(b.id);
        const crewIds = cov?.employeeIds ?? [];
        const segmentBy = new Map(
          (cov?.segments ?? []).map((seg) => [seg.membership_id, seg] as const),
        );
        const crewRows = crewIds.map((membershipId) => ({
          membership_id: membershipId,
          split_start_offset_minutes: segmentBy.get(membershipId)?.split_start_offset_minutes ?? null,
          split_duration_minutes: segmentBy.get(membershipId)?.split_duration_minutes ?? null,
        }));
        const scheduledAtMs = new Date(b.scheduled_at).getTime();
        const verdict = classifyJob({
          scheduledAtMs,
          windowEndMs: jobWindowEndMs(
            {
              scheduled_at: b.scheduled_at,
              duration_minutes: b.duration_minutes ?? 0,
              divides_hours: b.divide_hours_evenly === true || orgDivides,
            },
            crewRows,
          ),
          status: b.status,
          staffed: Boolean(cov?.staffed),
          hasClockIn: clockedBookings.has(b.id),
          nowMs,
          nudgedAtMs: b.no_show_nudge_sent_at
            ? new Date(b.no_show_nudge_sent_at).getTime()
            : null,
          flaggedAtMs: b.no_clock_in_flagged_at
            ? new Date(b.no_clock_in_flagged_at).getTime()
            : null,
          createdAtMs: new Date(b.created_at).getTime(),
        });

        if (verdict.kind === "late_start" && nudgeOn) {
          // Straight to the people who can still fix it. The office is not
          // told yet — someone running fifteen minutes late is not news.
          // Each person from her OWN start: on a split shift the afternoon
          // cleaner is not late at 9:15, and hears nothing until 1:15.
          // Nobody is late to a job she never said yes to. A crew member still
          // "pending" is the night-before digest's business ("hasn't
          // accepted"), not this nudge's — the line the office's "hasn't
          // clocked in" item already draws. Nov 8: Iryna was told she wasn't
          // clocked in to Ranj Asi while the office heard nothing about her,
          // because only one of the two rules skipped pending.
          const pending = new Set(cov?.pendingIds ?? []);
          const targets = crewRows
            .filter((c) => !pending.has(c.membership_id))
            .map((c) => ({
              membershipId: c.membership_id,
              startOffsetMinutes: c.split_start_offset_minutes,
            }));
          if (b.assigned_to && !crewIds.includes(b.assigned_to) && !pending.has(b.assigned_to)) {
            targets.push({ membershipId: b.assigned_to, startOffsetMinutes: null });
          }
          if (targets.length === 0) continue;
          const late = lateStarters({ scheduledAtMs, crew: targets, nowMs });
          const last = late.length === targets.length;
          for (const p of late) {
            lateNudges.push({
              booking: b,
              membershipId: p.membershipId,
              dueAtMs: p.dueAtMs,
              key: `late_start:${b.id}:${p.membershipId}`,
              last,
            });
          }
        } else if (verdict.kind === "no_clock_in" && alertOn) {
          toFlag.push(b);
        }
      }

      if (lateNudges.length > 0) {
        // Said once per person. The booking's own stamp can't carry that for
        // a crew whose starts differ, so each nudge is remembered under its
        // own key, and the stamp is written only once the last person on
        // the job has had hers — after which classifyJob stops asking.
        const { data: toldRows, error: toldErr } = (await db
          .from("needs_you_state" as never)
          .select("key, notified_at")
          .eq("organization_id" as never, orgId as never)
          .in(
            "key" as never,
            lateNudges.map((n) => n.key) as never,
          )) as unknown as {
          data: Array<{ key: string; notified_at: string | null }> | null;
          error: { message: string } | null;
        };
        if (toldErr) {
          throw new Error(`job watch: late-start memory query failed: ${toldErr.message}`);
        }
        const toldAt = new Map(
          (toldRows ?? []).map((r) => [r.key, r.notified_at ? new Date(r.notified_at).getTime() : null] as const),
        );
        const orgTz = await getOrgTimezone(orgId);
        const stampBookings = new Set<string>();
        for (const n of lateNudges) {
          if (n.last) stampBookings.add(n.booking.id);
          // Told about THIS schedule — a mark from before the job's start
          // is about the slot it was moved from.
          if (saidForThisSchedule(toldAt.get(n.key), new Date(n.booking.scheduled_at).getTime())) continue;
          // Mark first, then send: a failed mark means try next heartbeat,
          // never the same push every 30 minutes.
          const { error: markErr } = (await (db
            .from("needs_you_state" as never)
            .upsert(
              { organization_id: orgId, key: n.key, notified_at: nowIso } as never,
              { onConflict: "organization_id,key" } as never,
            ) as unknown as Promise<{ error: { message: string } | null }>));
          if (markErr) {
            console.error("[auto] job watch: could not remember late-start nudge", {
              key: n.key,
              error: markErr.message,
            });
            stampBookings.delete(n.booking.id);
            continue;
          }
          const when = formatDateTime(new Date(n.dueAtMs).toISOString(), orgTz);
          const ownStart = n.dueAtMs !== new Date(n.booking.scheduled_at).getTime();
          await notify({
            organizationId: orgId,
            audience: "membership",
            membershipId: n.membershipId,
            type: "job_not_started",
            title: "You're not clocked in",
            body: `${ownStart ? "Your part of " : ""}${n.booking.client?.name ?? "a job"} started at ${when} and you haven't clocked in. Open the job to clock in, or tell the office if you can't make it.`,
            href: `/field/jobs/${n.booking.id}`,
            fact: `${n.key}@${new Date(n.booking.scheduled_at).getTime()}`,
          });
          nudged++;
        }
        if (stampBookings.size > 0) {
          await db
            .from("bookings")
            .update({ no_show_nudge_sent_at: nowIso } as never)
            .in("id", [...stampBookings]);
        }
      }

      // ONE alert for the office listing every silent job, not one per job —
      // the same shape unstaffed_past_booking uses, for the same reason.
      if (toFlag.length > 0) {
        const names = toFlag
          .slice(0, 3)
          .map((b) => b.client?.name ?? "a client")
          .join(", ");
        await notify({
          organizationId: orgId,
          audience: "org-management",
          type: "job_no_clock_in",
          title:
            toFlag.length === 1
              ? "A job finished with no clock-in"
              : `${toFlag.length} jobs finished with no clock-in`,
          body: `${names}${toFlag.length > 3 ? ` and ${toFlag.length - 3} more` : ""} — somebody was assigned and the time has passed, but nobody ever clocked in. Confirm the work happened before it's completed and billed, or cancel it.`,
          // One job → open THAT job. The alert asks for a decision about a
          // specific booking, and landing on a list of hundreds makes the
          // reader do the search the notification already did.
          href:
            toFlag.length === 1
              ? `/app/bookings/${toFlag[0].id}`
              : "/app/bookings",
          // Money is about to move on the strength of no evidence. Email it.
          channels: { email: true },
          fact: `no_clock_in:${toFlag.map((b) => `${b.id}@${b.scheduled_at}`).sort().join(",")}`,
        });
        await db
          .from("bookings")
          .update({ no_clock_in_flagged_at: nowIso } as never)
          .in(
            "id",
            toFlag.map((b) => b.id),
          );
        flagged += toFlag.length;
      }
    } catch (err) {
      console.error(`[auto] job watch failed for org ${orgId}:`, err);
    }
  }

  if (nudged > 0 || flagged > 0) {
    console.log(
      `[auto] job watch: ${nudged} late-start nudge(s), ${flagged} no-clock-in flag(s) across ${byOrg.size} org(s)`,
    );
  }
  return { considered, nudged, flagged, orgsWithoutClockIn };
}
// 24. Auto-complete past bookings (daily)
export async function autoCompletePastBookings(): Promise<{
  completed: number;
}> {
  const db = admin();
  let completed = 0;

  const { data: orgs } = (await db
    .from("organizations")
    .select("id, booking_auto_complete_hours")
    .is("deleted_at", null)) as unknown as {
    data: Array<{
      id: string;
      booking_auto_complete_hours: number | null;
    }> | null;
  };

  for (const org of orgs ?? []) {
    // Two different questions, and they used to share one gate:
    //
    //   "should I flip statuses and draft invoices?"  — the toggle below
    //   "should I tell someone this job looks wrong?" — never optional
    //
    // The watchdog notifications (stale pending, unstaffed past) sat INSIDE
    // the auto-complete gate, so an owner who turned auto-complete off — or
    // just blanked the threshold — silently lost the warnings too, which is
    // precisely backwards: an org that doesn't auto-complete has MORE past
    // jobs drifting, not fewer. The alerts now run regardless; only the
    // status flip honours the toggle.
    const completionEnabled =
      (await isAutomationEnabled(org.id, "auto_complete_past_bookings")) &&
      org.booking_auto_complete_hours != null &&
      org.booking_auto_complete_hours >= 1;

    // Threshold for "past enough to be worth mentioning". When completion is
    // off there is no configured threshold, so fall back to a day — long
    // enough that this evening's jobs aren't nagged about tonight.
    const hours = completionEnabled
      ? (org.booking_auto_complete_hours as number)
      : 24;

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // Pending past its date is a human problem too, and a different one: the
    // office penciled a job in and never came back to it. Deliberately NOT in
    // the auto-complete set below — a duplicated job carries the source's
    // assignee and date, so a duplicate of a past job is pending + staffed +
    // past-due, exactly the shape that would auto-complete and draft an
    // invoice for something nobody ever confirmed.
    const { data: stalePending } = (await db
      .from("bookings")
      .select("id, scheduled_at, client:clients ( name )")
      .eq("organization_id", org.id)
      .eq("status", "pending")
      .lt("scheduled_at", cutoff)
      .limit(50)) as unknown as {
      data: Array<{
        id: string;
        scheduled_at: string;
        client: { name: string | null } | null;
      }> | null;
    };
    if (stalePending && stalePending.length > 0) {
      const names = stalePending
        .slice(0, 3)
        .map((b) => b.client?.name ?? "a client")
        .join(", ");
      await notify({
        audience: "org-management",
        organizationId: org.id,
        type: "general",
        title:
          stalePending.length === 1
            ? "A pending job's date has passed"
            : `${stalePending.length} pending jobs have passed their date`,
        body: `${names}${stalePending.length > 3 ? ` and ${stalePending.length - 3} more` : ""} — still marked Pending, so nobody confirmed them and the time has gone by. Confirm them if they happened, or cancel them.`,
        href:
          stalePending.length === 1
            ? `/app/bookings/${stalePending[0].id}`
            : "/app/bookings?status=pending",
        channels: { email: true },
        // Dated: this is meant to come back every night the jobs stay
        // pending; the fact only stops the same night saying it twice.
        fact: `stale_pending:${cutoff.slice(0, 10)}:${stalePending.map((b) => b.id).sort().join(",")}`,
      });
    }

    // Find candidates FIRST — we no longer blanket-complete, because a
    // booking nobody was assigned to is not evidence that work happened.
    // Auto-completing one drafts an invoice (and, with auto-send on, emails
    // a client a bill) for a job the system has no record of anyone doing.
    const { data: candidates, error: findErr } = (await db
      .from("bookings")
      .select("id, scheduled_at, duration_minutes, divide_hours_evenly, client:clients ( name )")
      .eq("organization_id", org.id)
      // Confirmed OR in progress; completed/cancelled are terminal, and
      // pending is handled above — it must never auto-complete.
      .in("status", ["confirmed", "in_progress"])
      // Started long enough ago to be worth a look. Whether it may CLOSE
      // is decided below from the job's end, not its start.
      .lt("scheduled_at", cutoff)
      .limit(200)) as unknown as {
      data: Array<{
        id: string;
        scheduled_at: string;
        duration_minutes: number | null;
        divide_hours_evenly: boolean | null;
        client: { name: string | null } | null;
      }> | null;
      error: { message: string } | null;
    };
    if (findErr) {
      console.error(
        `[auto] complete bookings failed for org ${org.id}:`,
        findErr.message,
      );
      continue;
    }
    if (!candidates || candidates.length === 0) continue;

    // Staffed = an assigned employee, a crew member, OR a claimed bench
    // offer. That last one is why this uses the shared helper: a freelancer
    // claim can't write bookings.assigned_to, so checking that column alone
    // reads a covered job as empty.
    const { resolveBookingCoverage } = await import("@/lib/booking-coverage");
    const coverage = await resolveBookingCoverage(candidates.map((b) => b.id));

    const staffedIds: string[] = [];
    const unstaffed: typeof candidates = [];
    for (const b of candidates) {
      if (coverage.get(b.id)?.staffed) staffedIds.push(b.id);
      else unstaffed.push(b);
    }

    // Unstaffed past jobs are a human problem, not a cron problem. Leave the
    // status alone and tell whoever can sort it out.
    if (unstaffed.length > 0) {
      const names = unstaffed
        .slice(0, 3)
        .map((b) => b.client?.name ?? "a client")
        .join(", ");
      await notify({
        audience: "org-management",
        organizationId: org.id,
        type: "unstaffed_past_booking",
        title:
          unstaffed.length === 1
            ? "A past job was never staffed"
            : `${unstaffed.length} past jobs were never staffed`,
        body: `${unstaffed.length > 3 ? `${names} and ${unstaffed.length - 3} more` : names} — nobody was assigned and the time has passed. These were NOT completed or invoiced. Check what happened, then close them out by hand.`,
        // Straight to the job when there's only one to look at.
        href:
          unstaffed.length === 1
            ? `/app/bookings/${unstaffed[0].id}`
            : "/app/bookings",
        // Work that never happened and was never billed. Email it.
        channels: { email: true },
        fact: `unstaffed_past:${cutoff.slice(0, 10)}:${unstaffed.map((b) => b.id).sort().join(",")}`,
      });
      console.log(
        `[auto] ${unstaffed.length} unstaffed past booking(s) left alone for org ${org.id}`,
      );
    }

    // Everything above is watchdog reporting and runs for every org. Only the
    // status flip + invoicing below is the auto-complete FEATURE.
    if (!completionEnabled) continue;
    if (staffedIds.length === 0) continue;

    // The grace runs from the job's END — the same window the job watch and
    // the computed state use — not from its start. Counted from the start,
    // a 10-hour job booked for 9:30 was closed by this sweep at 8:00 PM,
    // the very minute the job watch was due to ask the office whether it
    // happened; completed is terminal, so the question was never asked
    // (Ranj Asi, 2026-11-05). From the end, that job closes at 11:30 PM,
    // after the office has been asked.
    const { autoCompleteDue } = await import("@/lib/job-watch");
    const orgDivides = await orgDividesCrewHours(org.id);
    const byId = new Map(candidates.map((b) => [b.id, b]));
    const nowMs = Date.now();
    const dueIds = staffedIds.filter((id) => {
      const b = byId.get(id)!;
      const cov = coverage.get(id);
      const segmentBy = new Map((cov?.segments ?? []).map((s) => [s.membership_id, s] as const));
      return autoCompleteDue({
        scheduledAt: b.scheduled_at,
        durationMinutes: b.duration_minutes,
        dividesHours: b.divide_hours_evenly === true || orgDivides,
        crew: (cov?.employeeIds ?? []).map((membershipId) => ({
          membership_id: membershipId,
          split_start_offset_minutes: segmentBy.get(membershipId)?.split_start_offset_minutes ?? null,
          split_duration_minutes: segmentBy.get(membershipId)?.split_duration_minutes ?? null,
        })),
        graceHours: hours,
        nowMs,
      });
    });
    if (dueIds.length === 0) continue;

    // Not while someone is still on the clock. Completing drafts the
    // invoice, and a shift still running means the job is not over — the
    // clock-out guardrail will cap that shift and the next clock-out will
    // recompute the job. Say so to the office instead of closing around her.
    const { selectInChunks } = await import("@/lib/supabase/chunked-in");
    const { data: openShifts } = await selectInChunks<{ booking_id: string | null }>(
      dueIds,
      (chunk) =>
        db
          .from("time_entries")
          .select("booking_id")
          .in("booking_id", chunk)
          .is("clock_out_at", null) as unknown as PromiseLike<{
          data: Array<{ booking_id: string | null }> | null;
          error: { message: string } | null;
        }>,
    );
    const stillWorking = new Set(
      openShifts.map((r) => r.booking_id).filter(Boolean) as string[],
    );
    const toComplete = dueIds.filter((id) => !stillWorking.has(id));
    if (stillWorking.size > 0) {
      const names = candidates
        .filter((b) => stillWorking.has(b.id))
        .slice(0, 3)
        .map((b) => b.client?.name ?? "a client")
        .join(", ");
      await notify({
        audience: "org-management",
        organizationId: org.id,
        type: "general",
        title:
          stillWorking.size === 1
            ? "A past job still has someone on the clock"
            : `${stillWorking.size} past jobs still have someone on the clock`,
        body: `${names}${stillWorking.size > 3 ? ` and ${stillWorking.size - 3} more` : ""} — a shift is still running, so these were NOT completed or invoiced. Check Timesheets.`,
        href: "/app/timesheets",
        fact: `past_job_on_clock:${cutoff.slice(0, 10)}:${[...stillWorking].sort().join(",")}`,
      });
    }
    if (toComplete.length === 0) continue;

    // The rules own the status. Ask them about each due job; syncJob stores
    // completed when the window end plus the org's grace has passed (the
    // same clock as autoCompleteDue above), logs it, and drafts the invoice.
    // Nothing in this function writes bookings.status. Until 2026-11-14 the
    // sweep wrote completed itself and its own recompute could then revert
    // it (docs/job-lifecycle-map.md §4).
    const { syncJob } = await import("@/lib/job-sync");
    let closed = 0;
    for (const id of toComplete) {
      const res = await syncJob(id, "nightly_sweep");
      if (res && res.before !== "completed" && res.after === "completed") closed++;
    }
    completed += closed;
    if (closed > 0 || toComplete.length > 0) {
      console.log(
        `[auto] nightly sweep asked the rules about ${toComplete.length} due job(s) for org ${org.id}; ${closed} closed`,
      );
    }
  }
  return { completed };
}

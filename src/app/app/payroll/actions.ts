"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import { notifyPayrollPaid } from "@/lib/automations";
import { getOrgTimezone } from "@/lib/org-timezone";
import { zonedDayStartUtc, zonedMidnightUtc } from "@/lib/wall-clock";

type Result = { ok: true; id: string } | { ok: false; error: string };

/**
 * Compute + create a payroll run for a date range. Snapshots every
 * employee's hours, regular pay, bonuses, and PTO into payroll_items.
 */
export async function createPayrollRunAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();

  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Only owners and admins can create payroll runs." };
  }

  const period_start = String(formData.get("period_start") ?? "");
  const period_end = String(formData.get("period_end") ?? "");

  if (!period_start || !period_end) {
    return { ok: false, error: "Period start and end are required." };
  }
  if (new Date(period_end) < new Date(period_start)) {
    return { ok: false, error: "Period end must be on or after start." };
  }

  // `period_start`/`period_end` are CALENDAR DAYS in the org's timezone —
  // the same contract the Timesheets page resolves with these exact
  // helpers. The previous `${ymd}T00:00:00Z` anchored the window to UTC,
  // which in Edmonton meant a run labelled Aug 1–15 actually covered
  // Jul 31 18:00 → Aug 15 17:59 local: every evening shift filed into the
  // neighbouring period, run totals disagreed with the timesheet for the
  // same dates, and a final-day evening shift missed its own last run.
  // Same bug class 32b0105 fixed on timesheet edits. Half-open end, so
  // 23:59:59.5 isn't silently dropped either.
  const orgTz = await getOrgTimezone(membership.organization_id);
  const fromIso = zonedMidnightUtc(period_start, orgTz).toISOString();
  const toIso = zonedDayStartUtc(
    zonedMidnightUtc(period_end, orgTz),
    orgTz,
    1,
  ).toISOString();

  // Refuse to pay hours the system doesn't believe. needs_review is set when
  // a shift was auto-capped after nobody clocked out — the recorded time is
  // a ceiling, not an observation. Paying it silently is exactly how invented
  // hours reach a bank transfer. Block, name the count, and let the owner
  // confirm or correct them first (editing an entry clears the flag).
  const { count: unreviewed } = (await supabase
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", membership.organization_id)
    .is("payroll_run_id", null)
    .gte("clock_in_at", fromIso)
    .lt("clock_in_at", toIso)
    // Employee-era entries only — a subcontractor's capped shift is
    // Subcontractor pay's problem and must not block an employee run.
    .or("engagement_snapshot.eq.employee,engagement_snapshot.is.null")
    .eq("needs_review" as never, true as never)) as unknown as {
    count: number | null;
  };
  if ((unreviewed ?? 0) > 0) {
    return {
      ok: false,
      error: `${unreviewed} shift${unreviewed === 1 ? "" : "s"} in this period still need${unreviewed === 1 ? "s" : ""} review — nobody clocked out and the system capped the hours. Confirm or correct them on the Timesheets page, then run payroll.`,
    };
  }

  // Fetch data to compute
  const [{ data: entries }, { data: employees }, { data: bonuses }, { data: ptoRequests }] =
    await Promise.all([
      supabase
        .from("time_entries")
        .select(
          "id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, engagement_snapshot, booking:bookings ( hourly_rate_cents, total_cents )" as never,
        )
        .eq("organization_id", membership.organization_id)
        .is("payroll_run_id", null) // not already in a run
        .gte("clock_in_at", fromIso)
        .lt("clock_in_at", toIso)
        // Entries WORKED under the employee engagement. A NULL snapshot
        // (legacy / missed writer) falls through to the bucket gate below,
        // which resolves it by current engagement — the old behavior.
        .or("engagement_snapshot.eq.employee,engagement_snapshot.is.null")
        .not("clock_out_at", "is", null) as unknown as Promise<{
        data: Array<{
          id: string;
          employee_id: string | null;
          clock_in_at: string | null;
          clock_out_at: string | null;
          pay_rate_cents_snapshot: number | null;
          engagement_snapshot: string | null;
          booking: { hourly_rate_cents: number | null; total_cents: number } | null;
        }> | null;
      }>,
      // Include every active EMPLOYEE — owners who work shifts, and
      // manually-added shadow members, both belong on payroll.
      // Admin client because pay_rate_cents is RLS-locked from end-user
      // JWTs (migration 20260601040000). Org-filtered to stay scoped.
      //
      // Subcontractors are excluded here and nowhere else, deliberately. Every
      // loop below gates on `buckets.get(...)`, and only pushes an id onto the
      // counted* arrays once it has a bucket — so leaving a subcontractor out
      // of this seed keeps their hours, bonuses and PTO out of the run AND
      // leaves those rows unstamped (payroll_run_id stays NULL). Unstamped is
      // what makes them still visible as owed in Subcontractor pay. Filter
      // them out at the time_entries query instead and the rows would be
      // skipped but the arrays would be built the same way — the effect is
      // identical today, but this seed is the one place the two pay systems
      // are actually partitioned, so it is the one place to say so.
      createSupabaseAdminClient()
        .from("memberships")
        .select(
          "id, pay_rate_cents, display_name, profile:profiles ( full_name )",
        )
        .eq("status", "active")
        .eq("engagement" as never, "employee" as never)
        .eq("organization_id", membership.organization_id),
      supabase
        .from("bonuses")
        .select("id, employee_id, amount_cents, status, period_end")
        .eq("organization_id", membership.organization_id)
        .is("payroll_run_id", null) // not already in a run
        .gte("period_end", period_start)
        .lte("period_end", period_end)
        .in("status", ["pending"]),
      supabase
        .from("pto_requests")
        .select("id, employee_id, hours, status")
        .eq("organization_id", membership.organization_id)
        .eq("status", "approved")
        // Not already paid in a run (prevents double-pay across overlapping /
        // re-created runs — mirrors time_entries + bonuses).
        .is("payroll_run_id" as never, null as never)
        // OVERLAP with the period, not containment: a request that straddles
        // the period boundary (start before period_start or end after
        // period_end) must still be picked up, otherwise it was paid in
        // neither period. Paid in full in the first run that overlaps it, then
        // stamped so it can't be paid again.
        .lte("start_date", period_end)
        .gte("end_date", period_start),
    ]);

  type Bucket = {
    employeeName: string;
    minutes: number;
    regularCents: number;
    bonusCents: number;
    ptoHours: number;
    ptoCents: number;
    payRateCents: number;
  };

  const buckets = new Map<string, Bucket>();
  // Track which rows fed this run — WITH their owner, because only rows
  // belonging to people who survive the zero-value filter below may be
  // stamped. Stamping is "this run paid it"; stamping a filtered-out
  // person's row consumes it while paying $0, permanently.
  const countedEntries: Array<{ id: string; employeeId: string }> = [];
  const countedBonuses: Array<{ id: string; employeeId: string }> = [];
  const countedPto: Array<{ id: string; employeeId: string }> = [];

  // Seed with every active employee (so zero-hour rows still show up)
  for (const emp of employees ?? []) {
    buckets.set(emp.id, {
      employeeName:
        emp.display_name?.trim() || emp.profile?.full_name?.trim() || "Unknown",
      minutes: 0,
      regularCents: 0,
      bonusCents: 0,
      ptoHours: 0,
      ptoCents: 0,
      payRateCents: emp.pay_rate_cents ?? 0,
    });
  }

  // Entries WORKED as an employee whose owner has since been flipped to
  // subcontractor still belong to payroll — that is the whole point of the
  // snapshot. Give those owners a bucket too, but an HOURS-ONLY one: their
  // current-era PTO and bonuses belong to whatever system they are in now,
  // not to this run.
  const hoursOnly = new Set<string>();
  {
    const flippedIds = Array.from(
      new Set(
        (entries ?? [])
          .filter(
            (e) =>
              (e as { engagement_snapshot?: string | null })
                .engagement_snapshot === "employee" &&
              e.employee_id &&
              !buckets.has(e.employee_id),
          )
          .map((e) => e.employee_id as string),
      ),
    );
    if (flippedIds.length > 0) {
      const { data: flipped } = (await createSupabaseAdminClient()
        .from("memberships")
        .select("id, pay_rate_cents, display_name, profile:profiles ( full_name )")
        .in("id", flippedIds)
        .eq("organization_id", membership.organization_id)) as unknown as {
        data: Array<{
          id: string;
          pay_rate_cents: number | null;
          display_name: string | null;
          profile: { full_name: string | null } | null;
        }> | null;
      };
      for (const m of flipped ?? []) {
        hoursOnly.add(m.id);
        buckets.set(m.id, {
          employeeName:
            m.display_name?.trim() || m.profile?.full_name?.trim() || "Unknown",
          minutes: 0,
          regularCents: 0,
          bonusCents: 0,
          ptoHours: 0,
          ptoCents: 0,
          payRateCents: m.pay_rate_cents ?? 0,
        });
      }
    }
  }

  // Sum hours worked
  for (const e of entries ?? []) {
    if (!e.employee_id || !e.clock_in_at || !e.clock_out_at) continue;
    const bucket = buckets.get(e.employee_id);
    if (!bucket) continue;
    countedEntries.push({ id: e.id, employeeId: e.employee_id });
    const mins = Math.max(
      0,
      Math.round(
        (new Date(e.clock_out_at).getTime() -
          new Date(e.clock_in_at).getTime()) /
          60_000,
      ),
    );
    bucket.minutes += mins;
    // Rate precedence (first non-null wins):
    //   1. booking.hourly_rate_cents — owner-set per-booking override
    //   2. time_entries.pay_rate_cents_snapshot — locked at clock-in
    //   3. memberships.pay_rate_cents — current (legacy fallback)
    //
    // The snapshot fixes the "raise this month silently re-prices last
    // month's payroll" bug — historical hours stay at their original
    // rate even when memberships.pay_rate_cents changes later.
    const entry = e as { pay_rate_cents_snapshot?: number | null };
    const rate =
      e.booking?.hourly_rate_cents ??
      entry.pay_rate_cents_snapshot ??
      bucket.payRateCents;
    bucket.regularCents += Math.round((mins * rate) / 60);
  }

  // Sum bonuses
  for (const b of bonuses ?? []) {
    if (!b.employee_id) continue;
    // Hours-only buckets exist to pay a flipped person's employee-era
    // HOURS; their bonuses/PTO follow their current engagement.
    if (hoursOnly.has(b.employee_id)) continue;
    const bucket = buckets.get(b.employee_id);
    if (!bucket) continue;
    countedBonuses.push({ id: b.id, employeeId: b.employee_id });
    bucket.bonusCents += b.amount_cents ?? 0;
  }

  // Sum PTO
  for (const p of (ptoRequests ?? []) as Array<{
    id: string;
    employee_id: string;
    hours: number;
  }>) {
    if (hoursOnly.has(p.employee_id)) continue;
    const bucket = buckets.get(p.employee_id);
    if (!bucket) continue;
    countedPto.push({ id: p.id, employeeId: p.employee_id });
    const h = Number(p.hours) || 0;
    bucket.ptoHours += h;
    bucket.ptoCents += Math.round(h * bucket.payRateCents);
  }

  // Filter out employees with zero across the board
  const items = [...buckets.entries()]
    .map(([employeeId, b]) => ({
      employeeId,
      ...b,
      totalCents: b.regularCents + b.bonusCents + b.ptoCents,
    }))
    .filter(
      (i) => i.minutes > 0 || i.bonusCents > 0 || i.ptoCents > 0,
    );

  if (items.length === 0) {
    return { ok: false, error: "No hours, bonuses, or PTO found in this period." };
  }

  const runTotalCents = items.reduce((s, i) => s + i.totalCents, 0);

  // Create the run
  const { data: run, error: runErr } = await (supabase
    .from("payroll_runs")
    .insert({
      organization_id: membership.organization_id,
      period_start,
      period_end,
      status: "draft",
      total_cents: runTotalCents,
      created_by: membership.id,
    })
    .select("id")
    .single() as unknown as Promise<{
    data: { id: string } | null;
    error: { message: string } | null;
  }>);

  if (runErr || !run) {
    return { ok: false, error: runErr?.message ?? "Failed to create payroll run." };
  }

  // Insert items
  const itemsToInsert = items.map((i) => ({
    payroll_run_id: run.id,
    organization_id: membership.organization_id,
    employee_id: i.employeeId,
    employee_name: i.employeeName,
    hours_worked: Math.round((i.minutes / 60) * 100) / 100,
    regular_pay_cents: i.regularCents,
    bonus_cents: i.bonusCents,
    pto_hours: i.ptoHours,
    pto_pay_cents: i.ptoCents,
    total_cents: i.totalCents,
  }));

  const { error: itemsErr } = await (supabase
    .from("payroll_items")
    .insert(itemsToInsert) as unknown as Promise<{
    error: { message: string } | null;
  }>);

  if (itemsErr) {
    // Roll back the run
    await supabase.from("payroll_runs").delete().eq("id", run.id);
    return { ok: false, error: itemsErr.message };
  }

  // Stamp the consumed time entries + bonuses with this run so a later
  // overlapping run can't pay them again. Admin client, scoped strictly to
  // the ids we collected from this org's own query above.
  //
  // ONLY rows belonging to people who made it into `items`. The zero-value
  // filter above drops a person whose run total is $0 — e.g. approved PTO
  // priced at a pay rate that is still NULL — and stamping their rows here
  // would mark them paid-by-this-run while paying nothing, making them
  // permanently unpayable once the rate is fixed.
  const included = new Set(items.map((i) => i.employeeId));
  const stampEntryIds = countedEntries
    .filter((c) => included.has(c.employeeId))
    .map((c) => c.id);
  const stampBonusIds = countedBonuses
    .filter((c) => included.has(c.employeeId))
    .map((c) => c.id);
  const stampPtoIds = countedPto
    .filter((c) => included.has(c.employeeId))
    .map((c) => c.id);

  // CLAIM-guarded stamps: `.is("payroll_run_id", null)` makes each stamp
  // first-writer-wins. Two admins generating the same period concurrently
  // used to both read the same unstamped rows and both pay the full total
  // (last stamp silently won) — every employee paid twice. Now the loser
  // claims fewer rows than it priced, and a run whose items don't match
  // its claims must not exist: unwind it completely.
  const stampDb = createSupabaseAdminClient();
  const expectedClaims =
    stampEntryIds.length + stampBonusIds.length + stampPtoIds.length;
  let claims = 0;
  if (stampEntryIds.length > 0) {
    const { data: got } = (await stampDb
      .from("time_entries")
      .update({ payroll_run_id: run.id })
      .is("payroll_run_id", null)
      .in("id", stampEntryIds)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    claims += got?.length ?? 0;
  }
  if (stampBonusIds.length > 0) {
    const { data: got } = (await stampDb
      .from("bonuses")
      .update({ payroll_run_id: run.id })
      .is("payroll_run_id", null)
      .in("id", stampBonusIds)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    claims += got?.length ?? 0;
  }
  if (stampPtoIds.length > 0) {
    const { data: got } = (await stampDb
      .from("pto_requests")
      .update({ payroll_run_id: run.id } as never)
      .is("payroll_run_id" as never, null as never)
      .in("id", stampPtoIds)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    claims += got?.length ?? 0;
  }
  if (claims !== expectedClaims) {
    // Release whatever this run did claim, then remove the run (items
    // cascade). The concurrent winner's stamps are untouched — its guard
    // means ours never overwrote them.
    await (stampDb
      .from("time_entries")
      .update({ payroll_run_id: null })
      .eq("payroll_run_id", run.id) as unknown as Promise<unknown>);
    await (stampDb
      .from("bonuses")
      .update({ payroll_run_id: null })
      .eq("payroll_run_id", run.id) as unknown as Promise<unknown>);
    await (stampDb
      .from("pto_requests")
      .update({ payroll_run_id: null } as never)
      .eq("payroll_run_id" as never, run.id as never) as unknown as Promise<unknown>);
    await supabase.from("payroll_runs").delete().eq("id", run.id);
    return {
      ok: false,
      error:
        "Another payroll run consumed some of these hours at the same moment — check the runs list before trying again.",
    };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "bonus",
    entity_id: run.id,
    after: {
      period_start,
      period_end,
      total_cents: runTotalCents,
      employee_count: items.length,
    },
  });

  revalidatePath("/app/payroll", "page");
  return { ok: true, id: run.id };
}

export async function finalizePayrollRunAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  // Only a draft can be finalized (atomic guard — a replayed/forged POST
  // can't re-finalize or skip the draft stage).
  await (supabase
    .from("payroll_runs")
    .update({
      status: "finalized",
      finalized_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .eq("status", "draft") as unknown as Promise<unknown>);

  await logAuditEvent({
    membership,
    action: "status_change",
    entity: "bonus",
    entity_id: id,
    after: { status: "finalized" },
  });

  // Revalidate at "page" scope to avoid re-running the app layout's
  // many parallel nav-badge queries on every server action.
  revalidatePath("/app/payroll", "page");
  revalidatePath(`/app/payroll/${id}`, "page");
}

export async function markPayrollPaidAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  // Only a finalized run can be marked paid (atomic state-machine guard).
  await (supabase
    .from("payroll_runs")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .eq("status", "finalized") as unknown as Promise<unknown>);

  // Mark the bonuses consumed by this run as paid, so they reflect as paid
  // in the bonuses list and can't be separately marked paid again.
  await (supabase
    .from("bonuses")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .eq("payroll_run_id", id)
    .eq("organization_id", membership.organization_id) as unknown as Promise<unknown>);

  await logAuditEvent({
    membership,
    action: "mark_paid",
    entity: "bonus",
    entity_id: id,
  });

  // Fire-and-forget per-employee "you were paid" receipt.
  notifyPayrollPaid(id);

  // Revalidate at "page" scope to avoid re-running the app layout's
  // many parallel nav-badge queries on every server action.
  revalidatePath("/app/payroll", "page");
  revalidatePath(`/app/payroll/${id}`, "page");
}

export async function deletePayrollRunAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const confirmPhrase = String(formData.get("confirm") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  const { data: run } = await (supabase
    .from("payroll_runs")
    .select("status")
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle() as unknown as Promise<{
    data: { status: string } | null;
  }>);

  if (!run) return;

  // Draft runs can be deleted freely.
  // Finalized/paid runs require the admin to type "DELETE" to confirm —
  // this is a sensitive financial record and we don't want accidents.
  if (run.status !== "draft" && confirmPhrase !== "DELETE") return;

  await (supabase
    .from("payroll_runs")
    .delete()
    .eq("id", id)
    .eq("organization_id", membership.organization_id) as unknown as Promise<unknown>);

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "payroll_run",
    entity_id: id,
    before: { status: run.status },
  });

  revalidatePath("/app/payroll", "page");
  redirect("/app/payroll");
}

/**
 * Settle a cleaner's outstanding tips.
 *
 * Records that the money has left the business and reached the person — it
 * does NOT move any money itself. The tip was collected on a card into the
 * org's own Stripe balance, so the actual handover happens however this
 * business already pays people: in the next payroll run, in cash, on the spot.
 * This is the acknowledgement of that, so the same $20 isn't paid twice or,
 * worse, forgotten.
 *
 * Claim-then-act on paid_out_at: the update only matches rows still NULL, so
 * two owners clicking at once settle the same tips exactly once between them.
 */
export async function markTipsPaidAction(formData: FormData): Promise<void> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  const raw = String(formData.get("membership_id") ?? "").trim();
  const admin = createSupabaseAdminClient();

  let q = admin
    .from("invoice_tips" as never)
    .update({ paid_out_at: new Date().toISOString() } as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .is("paid_out_at" as never, null as never);

  // Empty means the unattributed bucket — those rows have a NULL membership,
  // and `.eq(col, "")` would match nothing at all rather than matching them.
  q = raw
    ? q.eq("membership_id" as never, raw as never)
    : q.is("membership_id" as never, null as never);

  const { data: settled } = (await q.select("id, amount_cents")) as unknown as {
    data: Array<{ id: string; amount_cents: number }> | null;
  };

  const rows = settled ?? [];
  if (rows.length === 0) return;

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: raw || membership.organization_id,
    after: {
      tips_marked_paid: rows.length,
      total_cents: rows.reduce((s, r) => s + r.amount_cents, 0),
      membership_id: raw || null,
    },
  });

  revalidatePath("/app/payroll", "page");
}

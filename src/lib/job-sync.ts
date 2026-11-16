import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAutomationEnabled } from "@/lib/automation-defaults";
import { logSystemAuditEvent } from "@/lib/audit";
import { describeTermsChange, type BookingTerms } from "@/lib/booking-status";
import { formatCurrencyCents, formatDurationMinutes } from "@/lib/format";
import {
  deriveJobState,
  describeJobState,
  type JobState,
  type JobStateCrewRow,
  type JobStateShift,
} from "@/lib/job-state";

/**
 * The one place that turns a job's computed state into its stored status.
 *
 * Every tap and click that can change what a job is — a clock-in, a
 * clock-out, a manager closing it, a timesheet edit, the nightly sweep —
 * calls syncJob afterwards. It loads the shifts and the roster, asks
 * deriveJobState what the job is now, and (in write mode) stores that,
 * logs it, and drafts the invoice on done. Nothing else is meant to write
 * bookings.status.
 *
 * Until 2026-11-14 this ran in shadow beside the old writers, recording
 * where it disagreed (audit action "state_check"; those rows remain as
 * history). It has been the writer since. The one other place a status is
 * set is a person saying so: closing a job (close-job.ts writes closed_at
 * and completed together, which is what the rules compute from closed_at),
 * the status dropdown, cancelling, and creating a visit as pending or
 * confirmed. Everything derived from shifts is decided here.
 */

export type JobSyncResult = {
  state: JobState;
  summary: string;
  /** Stored status before and after; equal when nothing changed. */
  before: string;
  after: string;
};

export type JobStateView = {
  state: JobState;
  summary: string;
  nameOf: (membershipId: string) => string;
  crew: Array<JobStateCrewRow & { name: string }>;
  shifts: Array<JobStateShift & { id: string; name: string }>;
  windowEndMs: number;
};

type BookingRow = {
  id: string;
  organization_id: string;
  status: string;
  scheduled_at: string;
  duration_minutes: number;
  total_cents: number | null;
  hourly_rate_cents: number | null;
  is_free: boolean | null;
  closed_at: string | null;
  divide_hours_evenly: boolean | null;
  /** Resolved: the row's flag or the org default. See teamMinutes. */
  divides_hours?: boolean;
};

async function load(bookingId: string) {
  const db = createSupabaseAdminClient();
  const { data: booking } = (await db
    .from("bookings" as never)
    .select(
      "id, organization_id, status, scheduled_at, duration_minutes, total_cents, hourly_rate_cents, is_free, closed_at, divide_hours_evenly" as never,
    )
    .eq("id" as never, bookingId as never)
    .maybeSingle()) as unknown as { data: BookingRow | null };
  if (!booking) return null;

  const [{ data: crewRows }, { data: shiftRows }, { data: org }] =
    await Promise.all([
      db
        .from("booking_assignees" as never)
        .select(
          "membership_id, split_start_offset_minutes, split_duration_minutes, completed_at, membership:memberships ( display_name, profile:profiles ( full_name ) )" as never,
        )
        .eq("booking_id" as never, bookingId as never) as unknown as Promise<{
        data: Array<
          JobStateCrewRow & {
            membership: {
              display_name: string | null;
              profile: { full_name: string | null } | null;
            } | null;
          }
        > | null;
      }>,
      db
        .from("time_entries")
        .select(
          "id, employee_id, clock_in_at, clock_out_at, auto_closed_at, employee:memberships!time_entries_employee_id_fkey ( display_name, profile:profiles ( full_name ) )",
        )
        .eq("booking_id", bookingId)
        .order("clock_in_at") as unknown as Promise<{
        data: Array<
          JobStateShift & {
            id: string;
            employee: {
              display_name: string | null;
              profile: { full_name: string | null } | null;
            } | null;
          }
        > | null;
      }>,
      db
        .from("organizations")
        .select("automation_settings, booking_auto_complete_hours, timezone")
        .eq("id", booking.organization_id)
        .maybeSingle() as unknown as Promise<{
        data: {
          automation_settings: Record<string, { enabled?: boolean } | undefined> | null;
          booking_auto_complete_hours: number | null;
          timezone: string | null;
        } | null;
      }>,
    ]);

  const autoOn = resolveAutomationEnabled(
    org?.automation_settings ?? null,
    "auto_complete_past_bookings",
  );
  const hours = org?.booking_auto_complete_hours;
  const autoCompleteAfterMinutes =
    autoOn && hours != null && hours >= 1 ? hours * 60 : null;
  // Same precedence as the field app and resolveTeamDivision: the row's own
  // flag, else the org default. On Svit every row says false and the org
  // default is on, so the row alone would get this wrong.
  booking.divides_hours =
    booking.divide_hours_evenly === true ||
    resolveAutomationEnabled(org?.automation_settings ?? null, "divide_crew_hours");

  const names = new Map<string, string>();
  const nm = (
    m: { display_name: string | null; profile: { full_name: string | null } | null } | null,
  ) => m?.display_name?.trim() || m?.profile?.full_name?.trim() || "";
  const crew = (crewRows ?? []).map((r) => {
    const name = nm(r.membership) || "Crew member";
    names.set(r.membership_id, name);
    return { ...r, name };
  });
  const shifts = (shiftRows ?? []).map((s) => {
    const name = nm(s.employee) || names.get(s.employee_id) || "Someone";
    if (!names.has(s.employee_id)) names.set(s.employee_id, name);
    return { ...s, name };
  });
  const nameOf = (id: string) => names.get(id) ?? "Someone";
  const tz = org?.timezone ?? "America/Edmonton";

  return { db, booking, crew, shifts, nameOf, tz, autoCompleteAfterMinutes };
}

function formatTimeIn(tz: string) {
  return (ms: number) => {
    const d = new Date(ms);
    const sameDay =
      d.toLocaleDateString("en-CA", { timeZone: tz }) ===
      new Date().toLocaleDateString("en-CA", { timeZone: tz });
    return d.toLocaleString("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      ...(sameDay ? {} : { month: "short", day: "numeric" }),
    });
  };
}

/** The computed state and everything the job page needs to show it. */
export async function loadJobState(
  bookingId: string,
  now = Date.now(),
): Promise<JobStateView | null> {
  const loaded = await load(bookingId);
  if (!loaded) return null;
  const { booking, crew, shifts, nameOf, tz, autoCompleteAfterMinutes } = loaded;
  const state = deriveJobState({ booking, crew, shifts, now, autoCompleteAfterMinutes });
  return {
    state,
    summary: describeJobState(state, {
      nameOf,
      formatTime: formatTimeIn(tz),
      crewSize: crew.length,
    }),
    nameOf,
    crew,
    shifts,
    windowEndMs: state.windowEndMs,
  };
}

export type JobTimelineEvent = {
  atMs: number;
  /** "Anastasiia clocked in", "Closed by Svitlana", "Invoice INV-0301 drafted". */
  text: string;
  tone: "neutral" | "good" | "warn";
};

/**
 * Everything that happened to a job, in order: the booking, each clock-in
 * and clock-out, every status change and who made it, refused clock-ins,
 * and the invoice. The answer to "why is this job still open?" without a
 * database query.
 */
export async function loadJobTimeline(
  bookingId: string,
  organizationId: string,
): Promise<JobTimelineEvent[]> {
  const db = createSupabaseAdminClient();
  const [view, { data: audit }, { data: invoices }, { data: booking }] =
    await Promise.all([
      loadJobState(bookingId),
      db
        .from("audit_log")
        .select("created_at, action, actor_id, before, after")
        .eq("organization_id", organizationId)
        .eq("entity", "booking")
        .eq("entity_id", bookingId)
        .in("action", ["status_change", "refused", "terms_change"])
        .order("created_at") as unknown as Promise<{
        data: Array<{
          created_at: string;
          action: string;
          actor_id: string | null;
          before: Record<string, unknown> | null;
          after: Record<string, unknown> | null;
        }> | null;
      }>,
      db
        .from("invoices")
        .select("number, status, created_at")
        .eq("booking_id", bookingId) as unknown as Promise<{
        data: Array<{ number: string | null; status: string; created_at: string }> | null;
      }>,
      db
        .from("bookings")
        .select("created_at, closed_at, closed_by")
        .eq("id", bookingId)
        .maybeSingle() as unknown as Promise<{
        data: { created_at: string; closed_at: string | null; closed_by: string | null } | null;
      }>,
    ]);
  if (!view || !booking) return [];

  // Actors outside the crew (the manager who closed it) need a name too.
  const actorIds = new Set<string>();
  for (const a of audit ?? []) if (a.actor_id) actorIds.add(a.actor_id);
  if (booking.closed_by) actorIds.add(booking.closed_by);
  const names = new Map<string, string>();
  if (actorIds.size > 0) {
    const { data: ms } = (await db
      .from("memberships")
      .select("id, display_name, profile:profiles ( full_name )")
      .in("id", [...actorIds])) as unknown as {
      data: Array<{
        id: string;
        display_name: string | null;
        profile: { full_name: string | null } | null;
      }> | null;
    };
    for (const m of ms ?? []) {
      names.set(m.id, m.display_name?.trim() || m.profile?.full_name?.trim() || "Someone");
    }
  }
  const who = (id: string | null) =>
    id ? (names.get(id) ?? view.nameOf(id)) : "Sollos";
  const ms = (iso: string) => new Date(iso).getTime();

  const events: JobTimelineEvent[] = [
    { atMs: ms(booking.created_at), text: "Booked", tone: "neutral" },
  ];
  for (const s of view.shifts) {
    events.push({ atMs: ms(s.clock_in_at), text: `${s.name} clocked in`, tone: "good" });
    if (s.clock_out_at) {
      const auto = (s as { auto_closed_at?: string | null }).auto_closed_at;
      events.push({
        atMs: ms(s.clock_out_at),
        text: auto
          ? `${s.name}'s shift was closed automatically`
          : `${s.name} clocked out`,
        tone: auto ? "warn" : "neutral",
      });
    }
  }
  for (const a of audit ?? []) {
    const after = a.after ?? {};
    if (a.action === "status_change") {
      const status = String(after.status ?? "");
      // The clock-in that set in_progress is already shown as a clock-in.
      if (status === "in_progress" && a.actor_id) continue;
      const label =
        status === "completed"
          ? a.actor_id
            ? `Closed by ${who(a.actor_id)}`
            : `Closed by Sollos (${String(after.reason ?? "automatic").replace(/_/g, " ")})`
          : status === "cancelled"
            ? `Cancelled by ${who(a.actor_id)}`
            : `Set to ${status.replace("_", " ")} by ${who(a.actor_id)}`;
      events.push({ atMs: ms(a.created_at), text: label, tone: "neutral" });
    } else if (a.action === "terms_change") {
      const text = describeTermsChange(
        (a.before ?? {}) as Partial<BookingTerms>,
        after as Partial<BookingTerms>,
        { hours: formatDurationMinutes, money: (c) => formatCurrencyCents(c) },
      );
      if (text) {
        events.push({ atMs: ms(a.created_at), text: `${text} by ${who(a.actor_id)}`, tone: "neutral" });
      }
    } else if (a.action === "refused") {
      const intent = after.intent === "complete" ? "finish" : "clock in";
      events.push({
        atMs: ms(a.created_at),
        text: `${who(a.actor_id)} couldn't ${intent}: ${String(after.reason ?? "").replace(/_/g, " ")}`,
        tone: "warn",
      });
    }
  }
  for (const inv of invoices ?? []) {
    events.push({
      atMs: ms(inv.created_at),
      text: `Invoice ${inv.number ?? ""} ${inv.status === "draft" ? "drafted" : inv.status}`.trim(),
      tone: "neutral",
    });
  }
  events.sort((a, b) => a.atMs - b.atMs);
  return events;
}

/**
 * Recompute one job and store the answer. Never throws: a job's status must
 * never be the reason a clock-in fails.
 *
 * `reason` names the event that triggered it ("clock_in", "manager_close",
 * "nightly_sweep"…) and lands in the audit row; `actorId` is the member whose
 * tap or click it follows, so the job's history says who, not just "Sollos".
 */
export async function syncJob(
  bookingId: string,
  reason: string,
  opts: { actorId?: string | null } = {},
): Promise<JobSyncResult | null> {
  try {
    const loaded = await load(bookingId);
    if (!loaded) return null;
    const { db, booking, crew, shifts, nameOf, tz, autoCompleteAfterMinutes } = loaded;
    const now = Date.now();
    const state = deriveJobState({ booking, crew, shifts, now, autoCompleteAfterMinutes });
    const summary = describeJobState(state, {
      nameOf,
      formatTime: formatTimeIn(tz),
      crewSize: crew.length,
    });
    const before = booking.status;

    if (state.status === before) {
      return { state, summary, before, after: before };
    }

    // Guard on the status we read so a human changing it in the same moment
    // wins — the next event recomputes anyway. The rules can reopen a
    // finished job (a late clock-in on a job nobody closed), but not out from
    // under an invoice: the money has moved on the strength of "completed".
    // Same guard as every human writer.
    if (before === "completed" && state.status !== "completed") {
      const { resolveBilledBookings } = await import("@/lib/billed-bookings");
      const inv = (await resolveBilledBookings(db, [bookingId])).get(bookingId);
      if (inv) {
        console.log(`[job-state] ${bookingId}: rules say ${state.status} but invoice ${inv.number ?? inv.id} bills it; left completed`);
        return { state, summary, before, after: before };
      }
    }

    const { data: written } = (await db
      .from("bookings")
      .update({ status: state.status } as never)
      .eq("id", bookingId)
      .eq("status", before as never)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    if (!written || written.length === 0) {
      return { state, summary, before, after: before };
    }
    await logSystemAuditEvent({
      organizationId: booking.organization_id,
      action: "status_change",
      entity: "booking",
      entity_id: bookingId,
      actorId: opts.actorId ?? null,
      after: {
        status: state.status,
        reason,
        phase: state.phase,
        summary,
      },
    });
    if (state.status === "completed") {
      const { autoInvoiceOnJobComplete } = await import("@/lib/automations");
      await autoInvoiceOnJobComplete(bookingId);
    }
    return { state, summary, before, after: state.status };
  } catch (err) {
    console.error("[job-state] sync failed:", bookingId, reason, err);
    return null;
  }
}

/**
 * The heartbeat: recompute every job that could change on its own.
 *
 * Taps and clicks call syncJob as they happen, but two transitions have no
 * tap — the window ending while a rostered person never came, and the
 * auto-complete grace running out on a job nobody tapped. Until this ran,
 * closesAtMs was a forecast with nothing to carry it out; the 2 AM sweep
 * closed those jobs by its own rule hours later. Every 30 minutes from the
 * shift-reminders cron.
 */
export async function syncLiveJobs(now = Date.now()): Promise<{
  considered: number;
  changed: number;
}> {
  const db = createSupabaseAdminClient();
  // Jobs that started in the last three days and haven't been closed. A
  // job scheduled later than now can't have a window that has ended.
  const since = new Date(now - 3 * 86_400_000).toISOString();
  const { data: rows, error } = (await db
    .from("bookings")
    .select("id")
    .in("status", ["confirmed", "en_route", "in_progress"])
    .is("closed_at", null)
    .gte("scheduled_at", since)
    .lte("scheduled_at", new Date(now).toISOString())
    .order("scheduled_at", { ascending: false })
    .limit(300)) as unknown as {
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(`job-state heartbeat query failed: ${error.message}`);
  let changed = 0;
  for (const r of rows ?? []) {
    const res = await syncJob(r.id, "heartbeat");
    if (res && res.after !== res.before) changed++;
  }
  return { considered: rows?.length ?? 0, changed };
}

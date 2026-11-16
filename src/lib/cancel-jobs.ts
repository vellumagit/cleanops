import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncJob } from "@/lib/job-sync";
import { resyncBookingCalendarsPaced } from "@/lib/booking-calendar-sync";

/**
 * The one place a job is cancelled.
 *
 * Until 2026-11-15 five places wrote `status: "cancelled"` themselves: the
 * office's status dropdown, ending a series, archiving a client, the office
 * approving a client's skip, and the client's own skip in the portal. Each
 * did a different subset of what a cancel owes: only two wrote a history
 * row, three took the visit off Google Calendar three different ways, and
 * one of them (ending a series) flipped rows it had not read. A fix to one
 * never reached the others.
 *
 * Every cancel now does the same five things, in this order:
 *
 *   1. One guarded write. Only rows still in a status the caller allows are
 *      touched, and only the rows the database says it changed are carried
 *      forward, so a job someone completed a moment ago is not cancelled and
 *      nothing below runs for a row that did not change.
 *   2. A history row per job: who, what it was before, and through which
 *      door (`via`).
 *   3. The rules hear about it (syncJob). Cancelled is terminal to them, so
 *      this is them agreeing, and it is what keeps Needs-you in step.
 *   4. The visit comes off every Google Calendar that mirrors it.
 *   5. The standard notices, when the caller asks for them: a push to the
 *      crew and the cancellation notice to the client. Callers with their
 *      own wording (a client's skip) send their own and pass `notices: "none"`.
 *
 * Steps 1 to 3 are the database and always finish before this returns.
 * Steps 4 and 5 talk to Google, phones and inboxes; with `defer` they run
 * after the response, so cancelling a long series does not hold the screen
 * for a minute while dozens of pushes go out.
 *
 * The edit form and the public API PATCH still write status themselves:
 * there it is one field of a larger save that must land in one statement.
 * They share the notices and the calendar resync, not the write.
 *
 * `closed_at` is cleared with the write: a job a manager closed and then
 * cancels is no longer "closed by" anyone.
 */

export type CancelJobsResult = {
  /** The jobs this call actually cancelled, with the status each had. */
  cancelled: Array<{ id: string; before: string; scheduled_at: string }>;
  error?: string;
};

export type CancelJobsOptions = {
  organizationId: string;
  bookingIds: string[];
  /** Only jobs in one of these statuses are cancelled. */
  fromStatuses: readonly string[];
  /** Which door: lands in the history row. */
  via:
    | "status_set"
    | "cancel_series"
    | "client_archived"
    | "client_skip_approved"
    | "client_skip";
  /** The reason handed to the rules' recompute. */
  syncReason: string;
  /** The member who did it; null for a client or the system. */
  actorId: string | null;
  /** Narrow the write further: the client the jobs must belong to. */
  clientId?: string;
  /**
   * Which visits come off Google Calendar. "upcoming" skips visits already
   * in the past: an old event is harmless, and walking years of history
   * through Google inside one request is how a bulk cancel times out.
   */
  calendars: "all" | "upcoming";
  /** Push the crew and send the client the standard cancellation notice. */
  notices: "none" | "crew" | "crew_and_client";
  /**
   * Run the calendar and notice work after the response instead of holding
   * it up. Only from a request (a server action or route); anywhere else it
   * runs straight away.
   */
  defer?: boolean;
};

const CHUNK = 200;

export async function cancelJobs(opts: CancelJobsOptions): Promise<CancelJobsResult> {
  const ids = [...new Set(opts.bookingIds.filter(Boolean))];
  if (ids.length === 0) return { cancelled: [] };
  const admin = createSupabaseAdminClient();

  // Read what each job is now: the history row needs the status it had.
  const current = new Map<string, { status: string; scheduled_at: string }>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    let q = admin
      .from("bookings")
      .select("id, status, scheduled_at")
      .eq("organization_id", opts.organizationId)
      .in("id", ids.slice(i, i + CHUNK))
      .in("status", opts.fromStatuses as never);
    if (opts.clientId) q = q.eq("client_id", opts.clientId);
    const { data, error } = (await q) as unknown as {
      data: Array<{ id: string; status: string; scheduled_at: string }> | null;
      error: { message: string } | null;
    };
    if (error) return { cancelled: [], error: error.message };
    for (const r of data ?? []) current.set(r.id, { status: r.status, scheduled_at: r.scheduled_at });
  }
  const due = [...current.keys()];
  if (due.length === 0) return { cancelled: [] };

  // The write, guarded on the same statuses again: a job that moved on
  // between the read and here is left alone, and `.select` says which rows
  // really changed.
  const changed: string[] = [];
  for (let i = 0; i < due.length; i += CHUNK) {
    let q = admin
      .from("bookings")
      .update({ status: "cancelled", closed_at: null, closed_by: null } as never)
      .eq("organization_id", opts.organizationId)
      .in("id", due.slice(i, i + CHUNK))
      .in("status", opts.fromStatuses as never);
    if (opts.clientId) q = q.eq("client_id", opts.clientId);
    const { data, error } = (await q.select("id")) as unknown as {
      data: Array<{ id: string }> | null;
      error: { message: string } | null;
    };
    if (error) {
      // Rows from earlier chunks are cancelled; finish their follow-up
      // rather than leave them half-done, and report the failure.
      await followUp(opts, changed, current);
      return { cancelled: describe(changed, current), error: error.message };
    }
    for (const r of data ?? []) changed.push(r.id);
  }

  await followUp(opts, changed, current);
  return { cancelled: describe(changed, current) };
}

function describe(
  changed: string[],
  current: Map<string, { status: string; scheduled_at: string }>,
): CancelJobsResult["cancelled"] {
  return changed.map((id) => ({
    id,
    before: current.get(id)?.status ?? "",
    scheduled_at: current.get(id)?.scheduled_at ?? "",
  }));
}

async function followUp(
  opts: CancelJobsOptions,
  changed: string[],
  current: Map<string, { status: string; scheduled_at: string }>,
): Promise<void> {
  if (changed.length === 0) return;
  const admin = createSupabaseAdminClient();

  // History. One insert for the lot; a failure is logged, never thrown: the
  // jobs are already cancelled and the rest of the follow-up still matters.
  try {
    const { error } = await admin.from("audit_log").insert(
      changed.map((id) => ({
        organization_id: opts.organizationId,
        actor_id: opts.actorId,
        action: "status_change",
        entity: "booking",
        entity_id: id,
        before: { status: current.get(id)?.status ?? null },
        after: { status: "cancelled", via: opts.via },
      })) as never,
    );
    if (error) console.error("[cancel-jobs] history rows not written:", error.message);
  } catch (err) {
    console.error("[cancel-jobs] history rows failed:", err);
  }

  for (const id of changed) await syncJob(id, opts.syncReason, { actorId: opts.actorId });

  const nowIso = new Date().toISOString();
  const upcoming = changed.filter((id) => (current.get(id)?.scheduled_at ?? "") >= nowIso);
  const offCalendar = opts.calendars === "all" ? changed : upcoming;
  // Notices are news about a visit that is not going to happen. A job that
  // already read completed happened (or was wrongly stamped done); telling
  // a client weeks later that it was cancelled would read as nonsense. And
  // with calendars "upcoming", nobody needs a push about a visit already in
  // the past.
  const toNotify =
    opts.notices === "none"
      ? []
      : changed.filter(
          (id) =>
            current.get(id)?.status !== "completed" &&
            (opts.calendars === "all" || upcoming.includes(id)),
        );
  if (offCalendar.length === 0 && toNotify.length === 0) return;

  const outsideWorld = async () => {
    if (toNotify.length > 0) {
      const { notifyBookingCancelledToEmployee, sendBookingCancelledToClient } = await import(
        "@/lib/automations"
      );
      // People first: a push that a job is off matters more than a calendar
      // entry disappearing a few seconds sooner.
      for (const id of toNotify) {
        await notifyBookingCancelledToEmployee(id).catch((e) =>
          console.error("[cancel-jobs] crew push failed:", id, e),
        );
        if (opts.notices === "crew_and_client") {
          await sendBookingCancelledToClient(id).catch((e) =>
            console.error("[cancel-jobs] client notice failed:", id, e),
          );
        }
      }
    }
    if (offCalendar.length > 0) await resyncBookingCalendarsPaced(offCalendar);
  };

  if (opts.defer) {
    try {
      const { after } = await import("next/server");
      after(() => outsideWorld().catch((e) => console.error("[cancel-jobs] deferred follow-up failed:", e)));
      return;
    } catch {
      // Not inside a request: nothing to defer behind. Do it now.
    }
  }
  await outsideWorld().catch((e) => console.error("[cancel-jobs] follow-up failed:", e));
}

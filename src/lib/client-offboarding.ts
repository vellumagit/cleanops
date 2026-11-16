import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelJobs } from "@/lib/cancel-jobs";

/**
 * Everything that must stop the moment a client is archived.
 *
 * Archiving used to be half a feature: clients.archived_at existed, every
 * list and picker and the billing cron already skipped it — but nothing
 * could SET it, and if something had, the client's future bookings would
 * have kept the schedule busy, their recurring series would have kept
 * minting new ones, and their portal login would have kept working.
 *
 * One sweep, same shape as member-offboarding: best-effort per step, a
 * failure in one category logged while the others still run.
 *
 * What it deliberately does NOT touch:
 *  - Invoices. An archived client can still owe money; their invoices stay
 *    visible and payable, and dashboard reminders about them still make
 *    sense. Only NEW billing stops (pickers + billing cron already refuse).
 *  - Completed history, estimates, contracts, documents — history is the
 *    point of archiving instead of deleting. (Open jobs from the last two
 *    weeks ARE cancelled; older stale ones are pre-existing drift and are
 *    left to the surfaces that already flag them.)
 *  - Any booking a live invoice bills. Money first, always.
 *  - The portal LINK (clients.profile_id). Lockout happens in client-auth
 *    (archived clients resolve to no client), so restoring the client
 *    restores their portal access without re-inviting.
 */

/**
 * How far back archiving reaches for still-open jobs. The confirm dialog's
 * count and the sweep itself MUST read the same window from here — when the
 * two drifted, the dialog promised to cancel a different set than the button
 * cancelled.
 */
export const ARCHIVE_CANCEL_LOOKBACK_DAYS = 14;

export function archiveCancelWindowStartIso(): string {
  return new Date(
    Date.now() - ARCHIVE_CANCEL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export type ClientArchiveSweepResult = {
  /** Open (pending/confirmed) bookings flipped to cancelled — upcoming ones
   *  plus the recent past, excluding any a live invoice already bills. */
  cancelledBookingIds: string[];
  /** Recurring BOOKING series paused (active=false) — no new bookings. */
  pausedSeriesIds: string[];
  /** Standing INVOICE series paused (active=false) — no new invoices. */
  pausedInvoiceSeriesIds: string[];
};

export async function sweepArchivedClient(
  admin: SupabaseClient,
  opts: { organizationId: string; clientId: string },
): Promise<ClientArchiveSweepResult> {
  const { organizationId, clientId } = opts;
  const result: ClientArchiveSweepResult = {
    cancelledBookingIds: [],
    pausedSeriesIds: [],
    pausedInvoiceSeriesIds: [],
  };

  // ── 1. Live bookings ─────────────────────────────────────────────────
  // pending/confirmed only: a job that's en_route or in_progress right now
  // is really happening — let it complete and get billed like any last job.
  //
  // THE DATE WINDOW is a recent-past lookback, not "everything" and not
  // "future only". Future-only (the first cut) left this morning's
  // never-happened 9 AM booking pending on an archived client forever —
  // nothing else cleans those up, since auto-complete deliberately never
  // touches pending. But unbounded is worse: a client of two years carries
  // a backlog of stale open jobs, and cancelling those would push the crew
  // a "you don't need to go" notice for each one, run an unbounded serial
  // sweep inside one server action, and irreversibly rewrite history that
  // archiving didn't create. Two weeks catches the live loose ends and
  // leaves old drift to the surfaces that already flag it.
  //
  // BILLED JOBS ARE NEVER TOUCHED. Cancelling a booking a live invoice
  // bills is refused everywhere else (bookings/actions.ts) — this sweep
  // uses the admin client, so it has to enforce that rule itself.
  const lookbackIso = archiveCancelWindowStartIso();
  //
  // Cancellation is more than a status: every other path to 'cancelled'
  // (edit form, status dropdown, series cancel) also deletes the Google
  // Calendar event, tears down the assignees' personal calendar copies,
  // and pushes the crew a notice — skip those and the cleaner drives to a
  // job that no longer exists. The CLIENT notice is deliberately NOT sent:
  // archiving is the org ending (or acknowledging the end of) the
  // relationship, and a burst of "your cleaning was cancelled" texts to
  // someone who just left is noise at best.
  try {
    // Read first, so billed jobs can be filtered out BEFORE anything is
    // written — the status flip is not reversible.
    const { data: candidates } = (await admin
      .from("bookings")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .gte("scheduled_at", lookbackIso)
      .in("status", ["pending", "confirmed"])) as unknown as {
      data: Array<{ id: string }> | null;
    };

    const { resolveBilledBookings } = await import("@/lib/billed-bookings");
    const billed = await resolveBilledBookings(
      admin,
      (candidates ?? []).map((b) => b.id),
    );
    const toCancel = (candidates ?? []).filter((b) => !billed.has(b.id));

    // Through the one cancel path. Calendars and the crew push only for
    // visits that have not happened yet: nobody needs a push about a job
    // from last week, and walking every historical row through Google
    // inside one server action is how this step timed out half-done.
    const res = await cancelJobs({
      organizationId,
      bookingIds: toCancel.map((b) => b.id),
      clientId,
      fromStatuses: ["pending", "confirmed"],
      via: "client_archived",
      syncReason: "client_archived",
      actorId: null,
      calendars: "upcoming",
      notices: "crew",
    });
    if (res.error) console.error("[client-archive] booking cancel failed part-way:", res.error);
    result.cancelledBookingIds = res.cancelled.map((b) => b.id);
  } catch (err) {
    console.error("[client-archive] booking cancel failed:", err);
  }

  // ── 2. Recurring booking series ──────────────────────────────────────
  // Paused, not deleted — the pattern (day, time, price) survives a
  // restore, but the generator only reads active=true so nothing new
  // appears while archived.
  try {
    const { data: paused } = (await admin
      .from("booking_series")
      .update({ active: false } as never)
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("active", true)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    result.pausedSeriesIds = (paused ?? []).map((s) => s.id);
  } catch (err) {
    console.error("[client-archive] series pause failed:", err);
  }

  // ── 3. Standing invoices ─────────────────────────────────────────────
  // The recurring-invoice generator selects active invoice_series with NO
  // archived-client filter — left alone, an archived client with auto-send
  // on would be drafted AND EMAILED a new invoice every cycle, forever.
  // Same pause-don't-delete rule as booking series.
  try {
    const { data: paused } = (await admin
      .from("invoice_series" as never)
      .update({ active: false } as never)
      .eq("organization_id" as never, organizationId as never)
      .eq("client_id" as never, clientId as never)
      .eq("active" as never, true as never)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    result.pausedInvoiceSeriesIds = (paused ?? []).map((s) => s.id);
  } catch (err) {
    console.error("[client-archive] invoice series pause failed:", err);
  }

  return result;
}

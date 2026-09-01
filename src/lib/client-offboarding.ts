import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

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
 *  - Past bookings, estimates, contracts, documents — history is the point
 *    of archiving instead of deleting.
 *  - The portal LINK (clients.profile_id). Lockout happens in client-auth
 *    (archived clients resolve to no client), so restoring the client
 *    restores their portal access without re-inviting.
 */

export type ClientArchiveSweepResult = {
  /** Future pending/confirmed bookings flipped to cancelled. */
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
  const nowIso = new Date().toISOString();
  const result: ClientArchiveSweepResult = {
    cancelledBookingIds: [],
    pausedSeriesIds: [],
    pausedInvoiceSeriesIds: [],
  };

  // ── 1. Future bookings ───────────────────────────────────────────────
  // pending/confirmed only: a job that's en_route or in_progress right now
  // is really happening — let it complete and get billed like any last job.
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
    const { data: cancelled } = (await admin
      .from("bookings")
      .update({ status: "cancelled" } as never)
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .gte("scheduled_at", nowIso)
      .in("status", ["pending", "confirmed"])
      .select(
        "id, scheduled_at, duration_minutes, service_type, address, notes, google_calendar_event_id, client:clients ( name )",
      )) as unknown as {
      data: Array<{
        id: string;
        scheduled_at: string;
        duration_minutes: number;
        service_type: string;
        address: string | null;
        notes: string | null;
        google_calendar_event_id: string | null;
        client: { name: string | null } | null;
      }> | null;
    };
    result.cancelledBookingIds = (cancelled ?? []).map((b) => b.id);

    const [
      { deleteCalendarEvent, syncMemberCalendarEvents },
      { notifyBookingCancelledToEmployee },
    ] = await Promise.all([
      import("@/lib/google-calendar"),
      import("@/lib/automations"),
    ]);
    for (const b of cancelled ?? []) {
      if (b.google_calendar_event_id) {
        await deleteCalendarEvent(
          organizationId,
          b.google_calendar_event_id,
        ).catch((e) =>
          console.error("[client-archive] gcal cleanup failed:", e),
        );
        await admin
          .from("bookings")
          .update({ google_calendar_event_id: null })
          .eq("id", b.id);
      }
      await syncMemberCalendarEvents(b.id, [], {
        id: b.id,
        scheduled_at: b.scheduled_at,
        duration_minutes: b.duration_minutes,
        service_type: b.service_type,
        address: b.address ?? null,
        notes: b.notes ?? null,
        client_name: b.client?.name ?? "",
      }).catch((e) =>
        console.error("[client-archive] member gcal cleanup failed:", e),
      );
      await notifyBookingCancelledToEmployee(b.id).catch((e) =>
        console.error("[client-archive] employee push failed:", e),
      );
    }
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

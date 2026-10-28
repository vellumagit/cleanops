import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createCalendarEvent,
  syncMemberCalendarEvents,
  updateCalendarEvent,
} from "@/lib/google-calendar";

/**
 * Push one booking's current row to every Google Calendar that mirrors it:
 * the org calendar (patch in place, or create when it has no event yet) and
 * each crew member's personal calendar.
 *
 * The edit form has always done this inline. The calendar drag — Svit's
 * busiest reschedule path — the API, the series-drift Restore button and the
 * nightly wall-clock re-derive did not, so a moved job sat at its OLD time on
 * every calendar until the 22:30 reconcile that night, and a same-day move
 * never caught up at all: the cleaner working off her phone's calendar drove
 * to the old slot while the app said otherwise. Call this after any write
 * that changes a booking's time, length or crew.
 *
 * Best-effort: a calendar that is unreachable must never fail the save. Run
 * it inside after() from a request so the response isn't held up.
 */
export async function resyncBookingCalendars(
  bookingId: string,
): Promise<{ org: "patched" | "created" | "none" | "failed"; members: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data: b } = (await admin
    .from("bookings")
    .select(
      `id, organization_id, status, archived_at, scheduled_at, duration_minutes,
       service_type, address, notes, assigned_to, google_calendar_event_id, splits,
       client:clients ( name ),
       assignee:memberships ( display_name, profile:profiles ( full_name ) )`,
    )
    .eq("id", bookingId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      status: string;
      archived_at: string | null;
      scheduled_at: string;
      duration_minutes: number;
      service_type: string;
      address: string | null;
      notes: string | null;
      assigned_to: string | null;
      google_calendar_event_id: string | null;
      splits: Array<{ duration_minutes?: number; assigned_to?: string }> | null;
      client: { name: string | null } | null;
      assignee: { display_name: string | null; profile: { full_name: string | null } | null } | null;
    } | null;
  };
  // Cancelled and archived jobs are removed from calendars by their own
  // paths; re-pushing one here would resurrect the event.
  if (!b || b.status === "cancelled" || b.archived_at) return { org: "none", members: false };

  const splits = Array.isArray(b.splits) ? b.splits : [];
  // Same duration the edit form and the nightly reconcile give the org
  // event: the sum of a split shift's segments, else the booking's own.
  const duration =
    splits.length > 0
      ? splits.reduce((s, x) => s + (Number(x.duration_minutes) || 0), 0)
      : b.duration_minutes;
  const splitCount = new Set(splits.map((s) => s.assigned_to).filter(Boolean)).size;
  const clientName = b.client?.name ?? undefined;
  const employeeName =
    b.assignee?.display_name?.trim() || b.assignee?.profile?.full_name?.trim() || undefined;

  let org: "patched" | "created" | "none" | "failed" = "none";
  try {
    if (b.google_calendar_event_id) {
      const ok = await updateCalendarEvent(b.organization_id, {
        id: b.id,
        google_calendar_event_id: b.google_calendar_event_id,
        scheduled_at: b.scheduled_at,
        duration_minutes: duration,
        service_type: b.service_type,
        address: b.address,
        notes: b.notes,
        client_name: clientName,
        employee_name: employeeName,
        split_count: splitCount,
      });
      org = ok ? "patched" : "failed";
    } else {
      const id = await createCalendarEvent(b.organization_id, {
        id: b.id,
        scheduled_at: b.scheduled_at,
        duration_minutes: duration,
        service_type: b.service_type,
        address: b.address,
        notes: b.notes,
        client_name: clientName,
        employee_name: employeeName,
        split_count: splitCount,
      });
      org = id ? "created" : "none";
    }
  } catch (err) {
    org = "failed";
    console.error("[gcal] resync org event failed:", b.id, err);
  }

  // Everyone on the job: the lead, the crew rows, and split-shift assignees.
  const { data: crewRows } = (await admin
    .from("booking_assignees")
    .select("membership_id")
    .eq("booking_id", b.id)) as unknown as { data: Array<{ membership_id: string }> | null };
  const assignees = new Set<string>();
  if (b.assigned_to) assignees.add(b.assigned_to);
  for (const r of crewRows ?? []) assignees.add(r.membership_id);
  for (const s of splits) if (s.assigned_to) assignees.add(s.assigned_to);

  let members = false;
  try {
    await syncMemberCalendarEvents(b.id, [...assignees], {
      id: b.id,
      scheduled_at: b.scheduled_at,
      duration_minutes: b.duration_minutes,
      service_type: b.service_type,
      address: b.address,
      notes: b.notes,
      client_name: clientName,
    });
    members = true;
  } catch (err) {
    console.error("[gcal/member] resync failed:", b.id, err);
  }
  return { org, members };
}

/**
 * Resync several bookings one after another at the pace the nightly
 * reconcile uses (~6 writes/sec), so a bulk move doesn't trip Google's
 * per-user write quota.
 */
export async function resyncBookingCalendarsPaced(bookingIds: string[]): Promise<void> {
  for (const id of bookingIds) {
    await resyncBookingCalendars(id).catch((err) =>
      console.error("[gcal] paced resync failed:", id, err),
    );
    await new Promise((r) => setTimeout(r, 170));
  }
}

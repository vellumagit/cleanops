import { toDatetimeLocal } from "@/lib/wall-clock";
import type { BookingFormDefaults } from "./booking-form";

/**
 * "Book again" and "Duplicate" are shortcuts into the new-booking form, not
 * bookings. They open the form with everything the source job knew — client,
 * crew, service, hours, price, address, notes — and the owner changes what
 * she needs and presses Create. Nothing exists until she does.
 *
 * Until 2026-11-06 they created a pending copy first (Book again dated it
 * the same weekday next week) and redirected to its edit page; an owner who
 * pressed it three times for three different days got three copies of next
 * Thursday, each already on the crew's phones.
 *
 * Book again leaves the date empty: a finished job's date is the one thing
 * that is certainly wrong. Duplicate keeps it, since duplicating an upcoming
 * job usually means "another one like this, around then".
 */
export type RebookSource = {
  client_id: string;
  assigned_to: string | null;
  scheduled_at: string;
  duration_minutes: number | null;
  service_type: string;
  service_type_id: string | null;
  total_cents: number | null;
  is_free: boolean | null;
  hourly_rate_cents: number | null;
  address: string | null;
  property_id: string | null;
  notes: string | null;
  splits: unknown;
  divide_hours_evenly: boolean | null;
};

export type RebookAssignee = { membership_id: string; is_primary: boolean | null };

export function rebookDefaults(
  source: RebookSource,
  assignees: RebookAssignee[],
  opts: { tz: string; keepDate: boolean },
): BookingFormDefaults {
  const crew = assignees
    .map((a) => a.membership_id)
    .filter((id) => id !== source.assigned_to);
  const splits = Array.isArray(source.splits)
    ? (source.splits as Array<{ assigned_to?: string; duration_minutes?: number; start_offset_minutes?: number }>)
        .filter((s) => s.assigned_to && s.duration_minutes)
        .map((s) => ({
          assigned_to: s.assigned_to as string,
          duration_minutes: s.duration_minutes as number,
          start_offset_minutes: s.start_offset_minutes,
        }))
    : [];
  return {
    client_id: source.client_id,
    assigned_to: source.assigned_to,
    additional_assignees: Array.from(new Set(crew)),
    scheduled_at_local: opts.keepDate ? toDatetimeLocal(source.scheduled_at, opts.tz) : undefined,
    duration_minutes: source.duration_minutes ?? undefined,
    service_type: source.service_type,
    service_type_id: source.service_type_id,
    total_dollars: source.total_cents != null ? (source.total_cents / 100).toFixed(2) : undefined,
    is_free: source.is_free ?? undefined,
    hourly_rate_cents: source.hourly_rate_cents ?? undefined,
    address: source.address,
    property_id: source.property_id,
    notes: source.notes,
    splits,
    divide_hours_evenly: source.divide_hours_evenly ?? undefined,
  };
}

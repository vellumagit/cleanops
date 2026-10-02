import type { ScheduleBooking } from "./data";

/**
 * Should this booking survive the scheduler's "show these cleaners" filter?
 *
 * The predicate used to read:
 *
 *     if (!b.assigned_to) return true;
 *     return visible.has(b.assigned_to);
 *
 * which tests the PRIMARY assignee and nobody else. Filtering the board down
 * to a secondary crew member therefore hid every job she was on, because those
 * bookings' assigned_to is someone else — Svitlana reported exactly this after
 * filtering by Uliana. Every other surface (cell mapping, crew ordering, the
 * phone agenda) already reads all_assignee_ids; this one predicate never got
 * updated when crew booking arrived.
 *
 * Third time this shape of bug has appeared — crew-hours division and the
 * completion guard both counted assigned_to when they meant the whole crew —
 * so it lives here with tests rather than inline in the shell.
 */

/** Everyone on the booking: crew when present, else the lone assignee. */
export function crewIdsOf(
  b: Pick<ScheduleBooking, "assigned_to" | "all_assignee_ids">,
): string[] {
  if (b.all_assignee_ids?.length) return b.all_assignee_ids;
  return b.assigned_to ? [b.assigned_to] : [];
}

export function bookingMatchesCrewFilter(
  b: Pick<ScheduleBooking, "assigned_to" | "all_assignee_ids" | "staffed">,
  visible: ReadonlySet<string>,
): boolean {
  // Unstaffed work is the unassigned tray's contents and has to survive the
  // filter, or narrowing to one cleaner empties the tray and the holes in the
  // week become invisible — the opposite of what filtering is for.
  //
  // Keyed on `staffed`, the shared rule (assignee OR crew OR a claimed bench
  // offer), not on `!assigned_to`. The old test let a crew-only booking bypass
  // the filter entirely, because its assigned_to is null even though real
  // people are on it.
  if (!b.staffed) return true;

  const crew = crewIdsOf(b);
  // Staffed with nobody to match on — a subcontractor-covered job. There is no
  // name to filter by, so hiding it would make it unreachable.
  if (crew.length === 0) return true;

  return crew.some((id) => visible.has(id));
}

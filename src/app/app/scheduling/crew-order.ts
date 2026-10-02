import type { ScheduleBooking, ScheduleEmployee } from "./data";

/**
 * Split the crew into "has work in this view" and "doesn't".
 *
 * Why this exists: the scheduler renders one lane per ACTIVE member, and
 * on a real org that is mostly empty space. Svit has 16 active members;
 * in a typical week only 4 of them have a single booking. At the week
 * grid's 110px row floor that is ~1,760px of lanes to scroll for four
 * lanes of content, and because data.ts sorts members alphabetically the
 * two cleaners who carry most of the work land mid-list and near-bottom.
 * The owner scrolled past empty lanes to reach the only people working.
 *
 * So: working lanes first, everyone else behind one collapsed row.
 *
 * `working` is sorted by how much work is in THIS view, descending —
 * the busiest cleaner is the first lane. That is view-local, so the
 * order can shift between weeks; the alternative is lifetime workload,
 * which would be stable but needs a query the grid doesn't make. Busiest-
 * first inside a single screen is worth more than cross-week stability.
 *
 * `idle` keeps the caller's incoming order, which is already alphabetical
 * from data.ts — a long list you scan by name, not by volume.
 */
export type CrewOrder = {
  working: ScheduleEmployee[];
  idle: ScheduleEmployee[];
  /** False when partitioning would add chrome without saving scroll —
   *  see MIN_IDLE_TO_PARTITION. Callers render one flat list instead. */
  partitioned: boolean;
};

/** Only the two fields that decide who is on a job. Narrower than
 *  ScheduleBooking on purpose: both grids pass their full bookings and
 *  tests pass two-field literals. */
export type CrewAssignment = Pick<
  ScheduleBooking,
  "assigned_to" | "all_assignee_ids"
>;

/**
 * Below this many idle lanes, a "N others" collapse costs more than it
 * saves: the owner gets a second heading and a disclosure to operate in
 * exchange for hiding one or two rows. Small crews stay flat.
 */
const MIN_IDLE_TO_PARTITION = 3;

/**
 * Every member who appears on at least one of these bookings.
 *
 * Reads `all_assignee_ids` (primary + additional crew from
 * booking_assignees) and falls back to `assigned_to`, mirroring how
 * week-grid builds its cellMap. Counting only `assigned_to` would file a
 * secondary crew member as idle while their lane visibly holds a job.
 */
function workloadByEmployee(bookings: CrewAssignment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const b of bookings) {
    const assignees = b.all_assignee_ids?.length
      ? b.all_assignee_ids
      : b.assigned_to
        ? [b.assigned_to]
        : [];
    for (const id of assignees) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

export function orderCrewByWorkload(
  employees: ScheduleEmployee[],
  bookings: CrewAssignment[],
): CrewOrder {
  const counts = workloadByEmployee(bookings);

  const working: ScheduleEmployee[] = [];
  const idle: ScheduleEmployee[] = [];
  for (const e of employees) {
    if ((counts.get(e.id) ?? 0) > 0) working.push(e);
    else idle.push(e);
  }

  working.sort((a, b) => {
    const diff = (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });

  // Nobody working (a genuinely empty week) would otherwise render as an
  // empty "Working" group plus a collapsed list holding the whole crew —
  // two headings and nothing to see. Fall back to the flat list.
  const partitioned = working.length > 0 && idle.length >= MIN_IDLE_TO_PARTITION;

  return { working, idle, partitioned };
}

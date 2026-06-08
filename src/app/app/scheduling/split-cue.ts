import type { ScheduleBooking } from "./data";

/**
 * One employee's place in a split-shift sequence, used to render a
 * linking cue on a per-employee grid card ("1 of 2 → then Ana"). The
 * grids can't draw the whole shift as one block (each segment lives in a
 * separate lane), so this cue is how a separated card still reads as part
 * of one shift.
 */
export type SplitCue = {
  /** 1-based position of this employee's segment among all segments. */
  index: number;
  /** Total segment count for the booking. */
  total: number;
  /** Name of the assignee handing off TO this employee (the prior
   *  segment), or null if this is the first segment. */
  prevName: string | null;
  /** Name of the assignee this employee hands off TO (the next segment),
   *  or null if this is the last segment. */
  nextName: string | null;
};

/**
 * Describe THIS employee's position in a split-shift booking. Returns
 * null when the booking isn't a split (fewer than 2 segments) or this
 * employee has no segment on it.
 */
export function computeSplitCue(
  booking: ScheduleBooking,
  employeeId: string,
  nameById: Map<string, string>,
): SplitCue | null {
  const segs = booking.assigneeSegments ?? {};
  const ordered = Object.entries(segs)
    .map(([membershipId, s]) => ({
      membershipId,
      start_offset_minutes: s.start_offset_minutes,
    }))
    .sort((a, b) => a.start_offset_minutes - b.start_offset_minutes);

  if (ordered.length < 2) return null;

  const idx = ordered.findIndex((s) => s.membershipId === employeeId);
  if (idx < 0) return null;

  const prev = ordered[idx - 1];
  const next = ordered[idx + 1];
  return {
    index: idx + 1,
    total: ordered.length,
    prevName: prev ? (nameById.get(prev.membershipId) ?? null) : null,
    nextName: next ? (nameById.get(next.membershipId) ?? null) : null,
  };
}

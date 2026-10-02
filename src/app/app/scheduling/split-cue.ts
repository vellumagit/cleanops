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
  /**
   * True when this employee's window OVERLAPS the neighbouring one, i.e.
   * they are on site together rather than handing over.
   *
   * Before 2026-10-02 segments were always laid end-to-end, so "→ then Ana"
   * was always accurate. Windows can now overlap, and calling that a hand-off
   * would tell the dispatcher the opposite of what is happening — the cue
   * says "with Ana" instead.
   */
  concurrent: boolean;
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
      duration_minutes: s.duration_minutes,
    }))
    .sort((a, b) => a.start_offset_minutes - b.start_offset_minutes);

  if (ordered.length < 2) return null;

  const idx = ordered.findIndex((s) => s.membershipId === employeeId);
  if (idx < 0) return null;

  const me = ordered[idx];
  const prev = ordered[idx - 1];
  const next = ordered[idx + 1];

  const myEnd = me.start_offset_minutes + me.duration_minutes;
  const concurrent =
    (next != null && next.start_offset_minutes < myEnd) ||
    (prev != null &&
      me.start_offset_minutes <
        prev.start_offset_minutes + prev.duration_minutes);

  return {
    index: idx + 1,
    total: ordered.length,
    prevName: prev ? (nameById.get(prev.membershipId) ?? null) : null,
    nextName: next ? (nameById.get(next.membershipId) ?? null) : null,
    concurrent,
  };
}

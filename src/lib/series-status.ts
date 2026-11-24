/**
 * The status a "this and all future visits" save carries to the later
 * visits in a series, or null to leave theirs alone.
 *
 * Svitlana confirms recurring clients two or three months ahead. To mark
 * the rest as not yet confirmed she opens the first visit past that, picks
 * Pending and "this and all future". The later visits stayed Confirmed: a
 * series save never carried status at all (2026-11-23).
 *
 * Only a CHANGE carries, and only between Pending and Confirmed:
 *  - unchanged: a crew or notes save from a confirmed visit must not wipe
 *    the Pending marks on the visits after it;
 *  - from or to anything else (completed, cancelled, on the way): those
 *    describe one visit's own day, never a series.
 */
export type SeriesStatus = "pending" | "confirmed";

const CARRIED = new Set<string>(["pending", "confirmed"]);

export function seriesStatusPatch(
  before: string | null | undefined,
  after: string | null | undefined,
): SeriesStatus | null {
  if (!before || !after || before === after) return null;
  if (!CARRIED.has(before) || !CARRIED.has(after)) return null;
  return after as SeriesStatus;
}

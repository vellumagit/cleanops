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

/**
 * Which rebuilt visits are Pending.
 *
 * A "this and all future" save that moves the series (another day, time or
 * frequency) deletes the later visits and writes new ones, and the function
 * that does it writes them Confirmed. Svitlana pencils visits in months
 * ahead as Pending; moving the series then turned every one of them back
 * to Confirmed without a word.
 *
 * `explicit` is what this save said for the later visits (seriesStatusPatch):
 * Pending makes them all Pending, Confirmed leaves them all Confirmed. With
 * no say, each new visit takes the status of the visit it replaces, in date
 * order: first new for first old, and so on. Where the new schedule has
 * more visits than the old, the extra ones follow the last old visit.
 */
export function rebuiltPendingIds(
  explicit: SeriesStatus | null,
  replacedStatuses: string[],
  rebuilt: Array<{ id: string; scheduled_at: string }>,
): string[] {
  const inOrder = [...rebuilt].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  if (explicit === "pending") return inOrder.map((v) => v.id);
  if (explicit === "confirmed" || replacedStatuses.length === 0) return [];
  const last = replacedStatuses[replacedStatuses.length - 1];
  return inOrder.filter((_, i) => (replacedStatuses[i] ?? last) === "pending").map((v) => v.id);
}

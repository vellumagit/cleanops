import { resolveSegmentWindows, type SegmentInput } from "./booking-segments";

/**
 * The whole crew a recurring series puts on every visit, stored on the series
 * itself so new visits can be generated with everyone on them.
 *
 * Until 2026-10-07 a series template held ONE cleaner — `assigned_to` — and
 * the extend cron built every new visit from it. A two-person recurring job
 * therefore became a one-person job the moment its series extended past what
 * had already been generated, and any per-cleaner time windows were dropped
 * with it. Nobody would see it happen: the visits already on the calendar
 * still had the full crew, so the shrinkage only appeared months out, one
 * visit at a time.
 *
 * Everyone on the crew is equal. Position in the array means nothing except
 * that the first member is mirrored into bookings.assigned_to for the code
 * that still reads it, while that column is phased out.
 */
export type SeriesCrewMember = {
  membership_id: string;
  /** Minutes after the visit's start. null = on site for the whole visit. */
  start_offset_minutes: number | null;
  /** How long this person is on site. null = the whole visit. */
  duration_minutes: number | null;
};

/**
 * Build a crew from what the booking form submitted.
 *
 * Mirrors syncBookingAssignees row for row, deliberately: the visits a save
 * writes and the template it stores have to describe the same people, or the
 * next extension produces a different crew from the one on the calendar —
 * the exact drift this replaces.
 *
 *   - With per-cleaner windows: everyone named in a window, in order, then any
 *     additional crew who aren't in a window (on site for the whole visit).
 *   - Without: the selected cleaner, then any additional crew.
 *
 * Duplicates are dropped, first mention wins.
 */
export function crewFromForm({
  primaryId,
  additionalIds,
  splits,
}: {
  primaryId: string | null;
  additionalIds: string[];
  splits: SegmentInput[];
}): SeriesCrewMember[] {
  const crew: SeriesCrewMember[] = [];
  const seen = new Set<string>();
  const add = (
    id: string | null | undefined,
    start: number | null,
    duration: number | null,
  ) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    crew.push({
      membership_id: id,
      start_offset_minutes: start,
      duration_minutes: duration,
    });
  };

  const live = splits.filter((s) => s.assigned_to);
  if (live.length > 0) {
    for (const seg of resolveSegmentWindows(splits)) {
      add(seg.assigned_to, seg.start_offset_minutes, seg.duration_minutes);
    }
    for (const id of additionalIds) add(id, null, null);
  } else {
    add(primaryId, null, null);
    for (const id of additionalIds) add(id, null, null);
  }
  return crew;
}

/**
 * Read a stored crew back. booking_series.crew is jsonb, so anything can be
 * in it — a hand edit, an older shape, garbage. Keep only well-formed members,
 * dedupe, and never throw: this runs inside the nightly cron, where one bad
 * row must not stop every other series from extending.
 */
export function parseSeriesCrew(raw: unknown): SeriesCrewMember[] {
  if (!Array.isArray(raw)) return [];
  const crew: SeriesCrewMember[] = [];
  const seen = new Set<string>();
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const id = (m as { membership_id?: unknown }).membership_id;
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    crew.push({
      membership_id: id,
      start_offset_minutes: num(
        (m as { start_offset_minutes?: unknown }).start_offset_minutes,
      ),
      duration_minutes: num((m as { duration_minutes?: unknown }).duration_minutes),
    });
  }
  return crew;
}

/**
 * The crew to put on a newly generated visit.
 *
 * The stored crew when there is one. Otherwise the legacy single cleaner, so a
 * series that predates the crew column extends exactly as it always did
 * instead of suddenly coming out unassigned.
 */
export function crewForGeneration(series: {
  crew?: unknown;
  assigned_to: string | null;
}): SeriesCrewMember[] {
  const stored = parseSeriesCrew(series.crew);
  if (stored.length > 0) return stored;
  return series.assigned_to
    ? [
        {
          membership_id: series.assigned_to,
          start_offset_minutes: null,
          duration_minutes: null,
        },
      ]
    : [];
}

/** True when at least one member has their own window, i.e. it's a split. */
export function crewHasWindows(crew: SeriesCrewMember[]): boolean {
  return crew.some(
    (m) => m.start_offset_minutes != null && m.duration_minutes != null,
  );
}

/**
 * The bookings.splits value for a generated visit — the same shape the booking
 * form saves — so opening a generated visit shows the per-cleaner times it
 * actually has. Empty when nobody has a window.
 */
export function splitsFromCrew(crew: SeriesCrewMember[]): Array<{
  assigned_to: string;
  start_offset_minutes: number;
  duration_minutes: number;
}> {
  if (!crewHasWindows(crew)) return [];
  return crew
    .filter((m) => m.start_offset_minutes != null && m.duration_minutes != null)
    .map((m) => ({
      assigned_to: m.membership_id,
      start_offset_minutes: m.start_offset_minutes as number,
      duration_minutes: m.duration_minutes as number,
    }));
}

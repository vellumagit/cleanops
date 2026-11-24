/**
 * Visits of a series that someone changed by hand, and what a "this and all
 * future" save does about them.
 *
 * A series save used to put every later visit back in line: the series'
 * crew on all of them, and (when the day, time or frequency changed) every
 * later visit deleted and written again from the pattern. A visit dragged
 * to another day, or given its own cleaner for one week, was undone by the
 * next series save, silently. Svitlana fixes visits one at a time (Olha has
 * another client every second Thursday), so each fix lasted only until the
 * series was next saved.
 *
 * What counts as changed by hand is recorded on the visit, never guessed
 * from "differs from the series" (most of her series were staffed visit by
 * visit, so every visit differs):
 *   time_set_by_hand_at   a person moved this visit (drag, edit, client move)
 *   crew_set_by_hand_at   a person set this visit's crew (migration 20261124040000)
 *
 * The rule:
 *   - A save that does not touch what was changed keeps it without asking.
 *     Changing the price must not swap a visit's cleaner.
 *   - A save that WOULD override it asks first: keep those visits, or
 *     change them too. Keeping is not always right either: move a whole
 *     series to Wednesdays and the visit nudged by half an hour would stay
 *     on Thursday.
 *
 * Pure. The save (bookings/actions.ts) reads the visits and writes through
 * update_booking_series_keeping_hand_set.
 */

export type LaterVisit = {
  id: string;
  scheduled_at: string;
  time_set_by_hand_at: string | null;
  crew_set_by_hand_at: string | null;
};

/** A visit this save would override, as the question names it. */
export type HandSetVisit = {
  id: string;
  scheduledAt: string;
  /** Moved by hand, and this save changes the schedule. */
  moved: boolean;
  /** Its own crew, and this save changes the crew. */
  ownCrew: boolean;
};

export type HandSetAnswer = "keep" | "replace";

/** What to keep on one visit while the series is saved. */
export type KeepEntry = { id: string; scheduledAt: string; time: boolean; crew: boolean };

/**
 * Which later visits this save would override (`ask`), and which keep their
 * own crew without a word because the save is not about crew (`quietCrew`).
 */
export function handSetAtRisk(
  later: LaterVisit[],
  save: { scheduleChanges: boolean; crewChanges: boolean },
): { ask: HandSetVisit[]; quietCrew: string[] } {
  const ask: HandSetVisit[] = [];
  const quietCrew: string[] = [];
  for (const v of [...later].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))) {
    const moved = !!v.time_set_by_hand_at && save.scheduleChanges;
    const ownCrew = !!v.crew_set_by_hand_at && save.crewChanges;
    if (moved || ownCrew) ask.push({ id: v.id, scheduledAt: v.scheduled_at, moved, ownCrew });
    if (v.crew_set_by_hand_at && !save.crewChanges) quietCrew.push(v.id);
  }
  return { ask, quietCrew };
}

/**
 * What an answer agrees to: exactly these visits and what would change on
 * each. Posted back with the answer; a save whose list has changed since
 * (another visit moved meanwhile, a different edit) is asked again.
 */
export function handSetKey(ask: HandSetVisit[]): string {
  return ask
    .map((v) => `${v.id}:${v.moved ? "t" : ""}${v.ownCrew ? "c" : ""}`)
    .sort()
    .join(",");
}

/** "keep|<key>" or "replace|<key>" → the answer, when the key still matches. */
export function readHandSetAnswer(posted: string, ask: HandSetVisit[]): HandSetAnswer | null {
  const cut = posted.indexOf("|");
  if (cut < 0) return null;
  const answer = posted.slice(0, cut);
  if (answer !== "keep" && answer !== "replace") return null;
  return posted.slice(cut + 1) === handSetKey(ask) ? answer : null;
}

/** The visits to keep, and what on each, for this answer. */
export function keepEntries(
  later: LaterVisit[],
  save: { scheduleChanges: boolean; crewChanges: boolean },
  answer: HandSetAnswer | null,
): KeepEntry[] {
  const keep = answer === "keep";
  const out: KeepEntry[] = [];
  for (const v of [...later].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))) {
    const time = !!v.time_set_by_hand_at && save.scheduleChanges && keep;
    const crew = !!v.crew_set_by_hand_at && (!save.crewChanges || keep);
    if (time || crew) out.push({ id: v.id, scheduledAt: v.scheduled_at, time, crew });
  }
  return out;
}

const HOUR = 3_600_000;
const ms = (iso: string) => new Date(iso).getTime();

/** The usual gap between the new schedule's visits; a week when it can't be told. */
function usualGap(occurrences: string[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < occurrences.length; i++) gaps.push(ms(occurrences[i]) - ms(occurrences[i - 1]));
  if (gaps.length === 0) return 7 * 24 * HOUR;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * A rebuild (the schedule itself is changing): which of the new schedule's
 * visits each kept visit stands in for, so it is not written twice.
 *
 * By place in line first: the third later visit stands in for the third new
 * one, as long as they are close (within a usual gap, and never more than
 * ten days: a visit moved from Thursday to Friday is still the third).
 * Otherwise the nearest new visit, within half a gap and never more than
 * four days. A visit that keeps its time and matches
 * nothing simply stays, as an extra. A visit that keeps only its crew moves
 * to its slot (`moveTo`); if the new schedule has no slot for it, it is not
 * kept: the rebuild replaces it like the rest (`dropped`).
 *
 * `laterInOrder`: every later visit the rebuild would replace, kept or not,
 * in date order. `occurrences`: the new schedule's visits, in date order.
 */
export function planRebuild(
  entries: KeepEntry[],
  laterInOrder: Array<{ id: string; scheduled_at: string }>,
  occurrences: string[],
): {
  occurrences: string[];
  keep: Array<{ id: string; time: boolean; crew: boolean; moveTo: string | null }>;
  dropped: string[];
} {
  const left = [...occurrences].sort((a, b) => a.localeCompare(b));
  const inOrder = [...occurrences].sort((a, b) => a.localeCompare(b));
  const gap = usualGap(inOrder);
  // Fixed ceilings as well: with two visits months apart "a usual gap" is
  // months, and a visit would stand in for one it has nothing to do with.
  const byPlaceWithin = Math.min(gap, 10 * 24 * HOUR);
  const nearestWithin = Math.min(gap / 2, 4 * 24 * HOUR);
  const place = new Map(
    [...laterInOrder].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).map((v, i) => [v.id, i]),
  );
  const keep: Array<{ id: string; time: boolean; crew: boolean; moveTo: string | null }> = [];
  const dropped: string[] = [];

  for (const e of [...entries].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
    const at = ms(e.scheduledAt);
    let match: string | null = null;
    const byPlace = inOrder[place.get(e.id) ?? -1];
    if (byPlace && left.includes(byPlace) && Math.abs(ms(byPlace) - at) <= byPlaceWithin) {
      match = byPlace;
    } else {
      let best: string | null = null;
      for (const o of left) {
        if (best === null || Math.abs(ms(o) - at) < Math.abs(ms(best) - at)) best = o;
      }
      if (best !== null && Math.abs(ms(best) - at) <= nearestWithin) match = best;
    }

    if (e.time) {
      if (match) left.splice(left.indexOf(match), 1);
      keep.push({ id: e.id, time: true, crew: e.crew, moveTo: null });
    } else if (match) {
      left.splice(left.indexOf(match), 1);
      keep.push({ id: e.id, time: false, crew: e.crew, moveTo: match });
    } else {
      dropped.push(e.id);
    }
  }

  // Never two visits of one series at the same instant.
  const taken = new Set(keep.filter((k) => k.time).map((k) => ms(entries.find((e) => e.id === k.id)!.scheduledAt)));
  return { occurrences: left.filter((o) => !taken.has(ms(o))), keep, dropped };
}

const day = (iso: string, tz: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });

const LISTED = 6;

function listed(visits: Array<{ scheduledAt: string; note?: string }>, tz: string): string {
  const shown = visits.slice(0, LISTED).map((v) => `${day(v.scheduledAt, tz)}${v.note ? ` (${v.note})` : ""}`);
  const more = visits.length > LISTED ? `, and ${visits.length - LISTED} more` : "";
  return `${shown.join("; ")}${more}`;
}

/** The question a save comes back with, before it has changed anything. */
export function handSetQuestion(ask: HandSetVisit[], tz: string): string {
  const n = ask.length;
  const what = (v: HandSetVisit) =>
    v.moved && v.ownCrew ? "moved, with its own crew" : v.moved ? "moved by hand" : "its own crew";
  const names = listed(
    ask.map((v) => ({ scheduledAt: v.scheduledAt, note: what(v) })),
    tz,
  );
  return n === 1
    ? `One later visit was changed by hand: ${names}. This save would put it back in line with the series. Nothing was saved yet. Keep that visit as it is, or change it too?`
    : `${n} later visits were changed by hand: ${names}. This save would put them back in line with the series. Nothing was saved yet. Keep those visits as they are, or change them too?`;
}

/** After a save that kept some: which ones, so they can be opened. */
export function keptSentence(kept: Array<{ scheduledAt: string }>, tz: string): string | null {
  if (kept.length === 0) return null;
  const sorted = [...kept].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  return kept.length === 1
    ? `One visit you had changed by hand was left as it is: ${listed(sorted, tz)}. Open it to change it.`
    : `${kept.length} visits you had changed by hand were left as they are: ${listed(sorted, tz)}. Open one to change it.`;
}

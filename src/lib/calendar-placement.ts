import { zonedParts } from "@/lib/wall-clock";

/**
 * Where a visit sits on a day-by-hour grid, in the company's time zone.
 *
 * A visit that runs past midnight is two blocks, not one: the part before
 * midnight on the day it starts, and the rest at the top of the next day.
 * Drawn as one block from its start time it ran off the bottom of the grid
 * into blank space, and the next day showed nothing at all.
 */
export type DayPart = {
  /** The day this block is drawn on, YYYY-MM-DD in the company's zone. */
  ymd: string;
  hour: number;
  minute: number;
  /** How long the block is on this day. */
  minutes: number;
  /** "whole": all on one day. "start": continues tomorrow. "end": began yesterday. */
  part: "whole" | "start" | "end";
};

const DAY = 24 * 60;

export function placeAcrossDays(start: Date, end: Date, tz: string): DayPart[] {
  const s = zonedParts(start, tz);
  const total = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  const startMin = s.hour * 60 + s.minute;
  const untilMidnight = DAY - startMin;
  // Ending exactly at midnight is still one day's block.
  if (total <= untilMidnight) {
    return [{ ymd: s.ymd, hour: s.hour, minute: s.minute, minutes: total, part: "whole" }];
  }
  const e = zonedParts(end, tz);
  const endMin = e.hour * 60 + e.minute;
  const parts: DayPart[] = [{ ymd: s.ymd, hour: s.hour, minute: s.minute, minutes: untilMidnight, part: "start" }];
  // The day it ends on, from the clock rather than by adding 24 hours, so a
  // night the clocks change still lands on the right date. A visit longer
  // than a day shows its first and last day; the days between are not drawn.
  if (endMin > 0 && e.ymd !== s.ymd) {
    parts.push({ ymd: e.ymd, hour: 0, minute: 0, minutes: endMin, part: "end" });
  }
  return parts;
}

/** Minutes of this visit that fall on its starting day (for a grid that draws one day). */
export function minutesBeforeMidnight(startMinuteOfDay: number, durationMinutes: number): number {
  return Math.min(durationMinutes, DAY - startMinuteOfDay);
}

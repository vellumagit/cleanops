/**
 * The small rules behind a cleaner's weekly hours, shared by the page that
 * edits them (src/app/field/availability) and the action that saves them.
 * Pure, so they are tested without a browser or a database.
 */

/** Monday first: this is a work week, and that is how a cleaner reads one. */
export const WEEK_DAYS = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
] as const;

export const DEFAULT_START = "09:00";
export const DEFAULT_END = "17:00";

/**
 * "09:00" or "09:00:00" → "09:00". Null for anything that is not a time of
 * day.
 *
 * The columns are text holding "HH:MM" (migration 20260422030000, with a
 * check constraint), so that is what the page loads and sends. The seconds
 * form is accepted because some browsers' time inputs report it, and a
 * value this function would refuse must be refused out loud, never skipped.
 */
export function toHHMM(value: string | null | undefined): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec((value ?? "").trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

/** "13:30" → "1:30 PM". The raw value back if it is not a time. */
export function timeLabel(value: string | null | undefined): string {
  const t = toHHMM(value);
  if (!t) return value ?? "";
  const [h, m] = t.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Why a start and end can't be saved, in words for the person, or null. */
export function hoursError(start: string, end: string): string | null {
  const s = toHHMM(start);
  const e = toHHMM(end);
  if (!s || !e) return "Pick a start and an end time.";
  if (s >= e) return "The end has to be after the start.";
  return null;
}

export type DayHours = { start: string; end: string };

/**
 * Two blocks on one day that overlap, or null. A split shift is two blocks
 * with a gap; two that overlap is a slip of the thumb, and on the office's
 * schedule it reads as one muddled block.
 */
export function overlapError(blocks: DayHours[]): string | null {
  const sorted = blocks
    .map((b) => ({ start: toHHMM(b.start), end: toHHMM(b.end) }))
    .filter((b): b is { start: string; end: string } => !!b.start && !!b.end)
    .sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) return "These two times overlap.";
  }
  return null;
}

/** The weekdays' hours a "same hours Monday to Friday" tap copies from. */
export function weekdayTemplate(byDay: Record<number, DayHours[]>): DayHours[] {
  for (const day of [1, 2, 3, 4, 5]) {
    const blocks = byDay[day] ?? [];
    if (blocks.length > 0) return blocks.map((b) => ({ ...b }));
  }
  return [{ start: DEFAULT_START, end: DEFAULT_END }];
}

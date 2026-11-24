/**
 * "Can this person take a visit at this time?": the rules, without the
 * database, so they are tested on their own. The lookups that feed them are
 * in src/app/app/bookings/crew-availability.ts.
 *
 * The booking form listed every active person, whatever the day. The office
 * picked from memory, and found out about time off, another job or a day
 * someone doesn't work when the save was refused, or when the cleaner
 * declined. Now the picker shows who is free and tucks the rest away with
 * the reason.
 */
import { timeLabel, toHHMM } from "@/lib/availability-week";

export type Hours = { start: string; end: string };

export type UnavailableKind = "off" | "busy" | "hours";

export type Unavailable = { kind: UnavailableKind; reason: string };

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const toMinutes = (hhmm: string): number | null => {
  const t = toHHMM(hhmm);
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Blocks as minutes, sorted, with touching or overlapping ones joined: a
 *  split shift of 8 to 12 and 12 to 4 is one stretch of work. */
function joined(blocks: Hours[]): Array<{ s: number; e: number }> {
  const spans = blocks
    .map((b) => ({ s: toMinutes(b.start), e: toMinutes(b.end) }))
    .filter((b): b is { s: number; e: number } => b.s != null && b.e != null && b.s < b.e)
    .sort((a, b) => a.s - b.s);
  const out: Array<{ s: number; e: number }> = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && span.s <= last.e) last.e = Math.max(last.e, span.e);
    else out.push({ ...span });
  }
  return out;
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * Why a visit falls outside the hours someone said they work, or null when
 * it fits (or they never said).
 *
 * - `custom`: hours given for that one date. They replace the weekly hours.
 * - `weekly`: their weekly hours, by day of week (0 = Sunday).
 * - Someone with no weekly hours at all has never filled them in; that is
 *   "unknown", not "never works", so nothing is held against them.
 * - A visit that runs past midnight is judged on the part that falls on the
 *   day it starts.
 */
export function outsideHoursReason(input: {
  dayOfWeek: number;
  /** Minutes after local midnight the visit starts, and how long it runs. */
  startMinutes: number;
  durationMinutes: number;
  weekly: Record<number, Hours[]>;
  custom: Hours[] | null;
}): string | null {
  const start = input.startMinutes;
  const end = Math.min(24 * 60, start + Math.max(1, input.durationMinutes));
  const dayName = DAY_NAMES[input.dayOfWeek] ?? "that day";

  let blocks: Hours[];
  let that: string;
  if (input.custom && input.custom.length > 0) {
    blocks = input.custom;
    that = "that day";
  } else {
    const hasAny = Object.values(input.weekly).some((list) => list.length > 0);
    if (!hasAny) return null;
    blocks = input.weekly[input.dayOfWeek] ?? [];
    if (blocks.length === 0) return `Doesn't work ${dayName}s`;
    that = `on ${dayName}s`;
  }

  const spans = joined(blocks);
  if (spans.length === 0) return null;
  if (spans.some((b) => start >= b.s && end <= b.e)) return null;
  const listed = spans.map((b) => `${timeLabel(hhmm(b.s))} to ${timeLabel(hhmm(b.e))}`).join(" and ");
  return `Works ${listed} ${that}`;
}

/** Finished beats time off beats another job beats working hours: the
 *  first two are a firm no, the last is the softest. One reason per person.
 *  `finished` is their last working day (YYYY-MM-DD) when the visit falls
 *  after it: the save would be refused (migration 20261124010000). */
export function pickReason(found: {
  off: boolean;
  busy: string | null;
  hours: string | null;
  finished?: string | null;
}): Unavailable | null {
  if (found.finished) {
    const day = new Date(`${found.finished}T12:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return { kind: "off", reason: `Last working day was ${day}` };
  }
  if (found.off) return { kind: "off", reason: "Off that day" };
  if (found.busy) return { kind: "busy", reason: found.busy };
  if (found.hours) return { kind: "hours", reason: found.hours };
  return null;
}

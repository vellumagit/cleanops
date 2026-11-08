import { zonedDayStartUtc, zonedMidnightUtc } from "@/lib/wall-clock";

/** UTC bounds for a calendar day in the organization's timezone. */
export function orgLocalDayUtcRange(
  dateYmd: string,
  tz: string,
): { start: Date; end: Date } {
  const start = zonedMidnightUtc(dateYmd, tz);
  return { start, end: zonedDayStartUtc(start, tz, 1) };
}

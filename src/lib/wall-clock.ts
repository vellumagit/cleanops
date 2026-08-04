/**
 * Wall-clock ↔ UTC conversion for org-local scheduling, without a tz
 * library. Used by invoice auto-send ("go out at 5 PM the day after the
 * job") and the morning review digest ("yesterday" in the org's timezone).
 *
 * Technique: Intl.DateTimeFormat can render any UTC instant as a wall-clock
 * reading in a target IANA zone. Re-encoding that reading as if it were UTC
 * and diffing against the instant yields the zone's UTC offset at that
 * moment — DST included. One refinement pass handles reads taken across a
 * transition boundary.
 */

/** UTC offset of `tz` at `instant`, in milliseconds (UTC+X → positive). */
function tzOffsetMs(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Some runtimes render midnight as "24".
    parts.hour === "24" ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/** The UTC instant when `tz`'s wall clock reads y-m-d h:00:00. */
function utcForWallClock(
  y: number,
  m: number,
  d: number,
  hour: number,
  tz: string,
): Date {
  const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
  let utc = guess - tzOffsetMs(new Date(guess), tz);
  // Refine once: if the first guess landed on the far side of a DST
  // transition, the offset read was stale by an hour.
  utc = guess - tzOffsetMs(new Date(utc), tz);
  return new Date(utc);
}

/** Calendar date (y/m/d) that `tz`'s wall clock shows at `instant`. */
function zonedDateParts(
  instant: Date,
  tz: string,
): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = dtf.format(instant).split("-").map(Number);
  return { y, m, d };
}

/**
 * The UTC instant of `hour`:00 local time on the calendar day AFTER the one
 * `from` falls on in `tz`. A job completed at 11:58 PM and one completed at
 * 6 AM the same day both land on the same "next day at 5 PM" send slot.
 */
export function nextDayAtHourUtc(from: Date, tz: string, hour: number): Date {
  const { y, m, d } = zonedDateParts(from, tz);
  // Date.UTC normalizes overflow (Jan 32 → Feb 1), so d+1 is safe across
  // month/year boundaries.
  return utcForWallClock(y, m, d + 1, hour, tz);
}

/**
 * UTC [start, end) of the calendar day `dayOffset` days from the one `from`
 * falls on in `tz`. dayOffset -1 = "yesterday", 0 = "today".
 */
export function zonedDayBoundsUtc(
  from: Date,
  tz: string,
  dayOffset: number,
): { start: Date; end: Date } {
  const { y, m, d } = zonedDateParts(from, tz);
  return {
    start: utcForWallClock(y, m, d + dayOffset, 0, tz),
    end: utcForWallClock(y, m, d + dayOffset + 1, 0, tz),
  };
}

/** "17" → "5:00 PM" for settings copy and digest emails. */
export function formatHourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * "2026-08-04" — the calendar date `tz`'s wall clock shows at `instant`.
 *
 * The day-bucketing primitive. Grouping a list by day, deciding what "today"
 * means, building a heading key: all of it must go through this, because
 * `new Date(iso).toLocaleDateString(...)` without a timeZone renders in the
 * SERVER's zone, which on Vercel is UTC. After 18:00 in Edmonton that is
 * already tomorrow, so an evening job files itself under the next day's
 * heading while the card beneath it prints today's time.
 */
export function zonedYmd(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The UTC instant when `tz`'s wall clock reads `dateYmd` at 00:00. */
export function zonedMidnightUtc(dateYmd: string, tz: string): Date {
  const [y, m, d] = dateYmd.split("-").map(Number);
  return utcForWallClock(y, m, d, 0, tz);
}

/**
 * UTC instant of Monday 00:00 local, for the week containing `from`.
 *
 * Replaces the round-trip idiom `new Date(d.toLocaleString("en-US", { timeZone }))`,
 * which renders the org's wall clock to a US-format string and then re-parses
 * it as SERVER-local. Every getDay/setDate/setHours after that runs in the
 * wrong zone, so "Monday 00:00" resolved to Sunday 18:00 in Edmonton — and a
 * Sunday-evening shift landed in the previous pay week.
 */
export function startOfWeekUtc(from: Date, tz: string): Date {
  const { y, m, d } = zonedDateParts(from, tz);
  // Date.UTC normalizes overflow in both directions, so d - dow is safe
  // across month and year boundaries.
  const mondayOffset = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return utcForWallClock(y, m, d - mondayOffset, 0, tz);
}

/** UTC instant of 00:00 local, `days` from the day `from` falls on in `tz`. */
export function zonedDayStartUtc(from: Date, tz: string, days = 0): Date {
  const { y, m, d } = zonedDateParts(from, tz);
  return utcForWallClock(y, m, d + days, 0, tz);
}

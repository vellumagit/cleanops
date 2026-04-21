/**
 * Recurrence rule helpers for booking series.
 *
 * Given a series definition (pattern, start date, custom days, time),
 * generates the next N occurrence dates as ISO timestamps.
 */

import {
  addDays,
  addWeeks,
  addMonths,
  getDay,
  isBefore,
  isAfter,
  startOfDay,
  startOfMonth,
  lastDayOfMonth,
  parseISO,
} from "date-fns";
import { localInputToUtcIso } from "@/lib/validators/common";

export type RecurrencePattern =
  | "weekly"
  | "bi_weekly"
  | "tri_weekly"
  | "quad_weekly"
  | "monthly"
  | "custom_weekly"
  | "monthly_nth";

/**
 * Ordered options list used by the booking form. Kept here so every UI
 * that picks a pattern stays in sync with the enum and with the
 * human-readable explanations.
 */
export const RECURRENCE_OPTIONS: Array<{
  value: RecurrencePattern;
  label: string;
  description: string;
}> = [
  {
    value: "weekly",
    label: "Weekly",
    description: "Every 7 days on the same weekday.",
  },
  {
    value: "bi_weekly",
    label: "Every 2 weeks",
    description: "Every 14 days — alternating weeks.",
  },
  {
    value: "tri_weekly",
    label: "Every 3 weeks",
    description: "Every 21 days.",
  },
  {
    value: "quad_weekly",
    label: "Every 4 weeks",
    description:
      "Every 28 days — a pure 4-week cycle, 13 visits per year. Different from Monthly, which follows the calendar (12/year, drifting 1–3 days).",
  },
  {
    value: "monthly",
    label: "Monthly (same date)",
    description:
      "Same day-of-month every month — e.g. the 15th. 12 visits per year. Shifts forward by a day or two around months with fewer than 31 days.",
  },
  {
    value: "monthly_nth",
    label: "Monthly (Nth weekday)",
    description:
      'E.g. "the 2nd Tuesday of every month." Pick which occurrence (1st–4th or Last) and which weekday.',
  },
  {
    value: "custom_weekly",
    label: "Custom weekly",
    description:
      "Multiple specific weekdays. Useful for offices cleaned Monday + Thursday, or 3x-per-week schedules.",
  },
];

export type SeriesRule = {
  pattern: RecurrencePattern;
  /** 0=Sun … 6=Sat. Only used for custom_weekly. */
  custom_days: number[] | null;
  /** HH:MM in 24-hour format */
  start_time: string;
  /** First occurrence date (YYYY-MM-DD) */
  starts_at: string;
  /** Optional end date (YYYY-MM-DD). Null = indefinite. */
  ends_at: string | null;
  /** How many instances to generate ahead */
  generate_ahead: number;
  /** For monthly_nth: 1..4 = Nth, 5 = last */
  monthly_nth?: number | null;
  /** For monthly_nth: 0=Sun .. 6=Sat */
  monthly_dow?: number | null;
  /**
   * One-off dates (YYYY-MM-DD) to skip when generating. Any occurrence
   * whose date matches one of these is silently dropped. Used for
   * holidays / client-requested pauses for a single occurrence.
   */
  skip_dates?: string[] | null;
  /**
   * IANA timezone string (e.g. "America/Edmonton"). Drives how
   * `start_time` is applied to each occurrence date. Defaults to
   * DEFAULT_TZ when omitted — callers with org context should always
   * pass the org's timezone for DST and multi-region correctness.
   */
  tz?: string;
};

/** True if the date (in YYYY-MM-DD format) appears in the skip list. */
function isSkipped(d: Date, skipDates: string[] | null | undefined): boolean {
  if (!skipDates || skipDates.length === 0) return false;
  const key =
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0");
  return skipDates.includes(key);
}

/**
 * Return the date of the Nth occurrence of `dow` (0=Sun..6=Sat) in the
 * given month. If nth=5 ("last"), find the last matching weekday of the
 * month. Returns null if the requested occurrence doesn't exist
 * (e.g. "5th Wednesday" in a month that only has 4 Wednesdays).
 */
export function nthWeekdayOfMonth(
  year: number,
  month: number, // 0-based (0=Jan)
  nth: number,
  dow: number,
): Date | null {
  if (nth < 1 || nth > 5 || dow < 0 || dow > 6) return null;

  const monthStart = startOfMonth(new Date(year, month, 1));

  if (nth === 5) {
    // "Last" — walk backwards from end of month to find the last matching dow.
    const end = lastDayOfMonth(monthStart);
    for (let i = 0; i < 7; i++) {
      const d = addDays(end, -i);
      if (getDay(d) === dow) return d;
    }
    return null;
  }

  // Nth (1..4): find first matching dow, then add (nth-1) weeks.
  const firstDow = getDay(monthStart);
  const offset = (dow - firstDow + 7) % 7;
  const target = addDays(monthStart, offset + (nth - 1) * 7);
  // Bail if we rolled past the month (e.g. "5th Monday" masquerading as 4th).
  if (target.getMonth() !== month) return null;
  return target;
}

/**
 * Apply HH:MM time to a date in the given timezone and return a proper
 * UTC Date. Uses localInputToUtcIso so recurring bookings get the right
 * wall-clock time regardless of server timezone.
 */
function applyTime(date: Date, time: string, tz: string | undefined): Date {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const dtLocal = `${y}-${mo}-${d}T${time}`;
  return new Date(localInputToUtcIso(dtLocal, tz));
}

/**
 * Generate the next N occurrence dates starting from `after` (exclusive).
 * If `after` is null, starts from the series start date (inclusive).
 *
 * Returns ISO timestamp strings.
 */
export function generateOccurrences(
  rule: SeriesRule,
  count: number,
  after: Date | null = null,
): string[] {
  const results: string[] = [];
  const endDate = rule.ends_at ? parseISO(rule.ends_at) : null;
  const startDate = parseISO(rule.starts_at);

  if (rule.pattern === "custom_weekly") {
    return generateCustomWeekly(rule, count, after);
  }

  if (rule.pattern === "monthly_nth") {
    return generateMonthlyNth(rule, count, after);
  }

  // For standard patterns: weekly/bi_weekly/tri_weekly/monthly
  // The recurrence is anchored to the start date's day of week (or day of month)
  let cursor = after ? new Date(after) : new Date(startDate);

  // If we have an "after" date, advance to the next occurrence
  if (after) {
    cursor = advanceToNext(cursor, rule.pattern, startDate);
  } else {
    // Start from the start date itself
    cursor = new Date(startDate);
  }

  while (results.length < count) {
    // Apply the time
    const occurrence = applyTime(cursor, rule.start_time, rule.tz);

    // Check bounds
    if (endDate && isAfter(startOfDay(cursor), endDate)) break;

    // Only include dates on or after the start
    if (!isBefore(startOfDay(cursor), startOfDay(startDate))) {
      // Only include dates after the "after" cursor, and not in skip list
      if (
        (!after || isAfter(occurrence, after)) &&
        !isSkipped(cursor, rule.skip_dates)
      ) {
        results.push(occurrence.toISOString());
      }
    }

    // Advance cursor
    cursor = advanceToNext(cursor, rule.pattern, startDate);
  }

  return results;
}

function advanceToNext(
  current: Date,
  pattern: RecurrencePattern,
  _anchor: Date,
): Date {
  switch (pattern) {
    case "weekly":
      return addWeeks(current, 1);
    case "bi_weekly":
      return addWeeks(current, 2);
    case "tri_weekly":
      return addWeeks(current, 3);
    case "quad_weekly":
      return addWeeks(current, 4);
    case "monthly":
      return addMonths(current, 1);
    default:
      return addWeeks(current, 1);
  }
}

/**
 * Monthly Nth: generates occurrences on the Nth specific weekday of each
 * month. E.g., the 2nd Tuesday of every month.
 */
function generateMonthlyNth(
  rule: SeriesRule,
  count: number,
  after: Date | null,
): string[] {
  const results: string[] = [];
  const nth = rule.monthly_nth ?? null;
  const dow = rule.monthly_dow ?? null;
  if (nth == null || dow == null) return results;

  const startDate = parseISO(rule.starts_at);
  const endDate = rule.ends_at ? parseISO(rule.ends_at) : null;

  // Walk month-by-month from the series start.
  let cursor = startOfMonth(startDate);
  const maxMonths = 120; // 10-year safety cap
  let iterations = 0;

  while (results.length < count && iterations < maxMonths) {
    iterations++;
    const candidate = nthWeekdayOfMonth(
      cursor.getFullYear(),
      cursor.getMonth(),
      nth,
      dow,
    );

    if (candidate) {
      const occurrence = applyTime(candidate, rule.start_time, rule.tz);

      if (endDate && isAfter(startOfDay(candidate), endDate)) break;

      if (!isBefore(startOfDay(candidate), startOfDay(startDate))) {
        if (
          (!after || isAfter(occurrence, after)) &&
          !isSkipped(candidate, rule.skip_dates)
        ) {
          results.push(occurrence.toISOString());
        }
      }
    }

    cursor = addMonths(cursor, 1);
  }

  return results;
}

/**
 * Custom weekly: generates occurrences on specific days of the week.
 * E.g., every Monday and Thursday.
 */
function generateCustomWeekly(
  rule: SeriesRule,
  count: number,
  after: Date | null,
): string[] {
  const results: string[] = [];
  const days = (rule.custom_days ?? []).sort((a, b) => a - b);
  if (days.length === 0) return results;

  const endDate = rule.ends_at ? parseISO(rule.ends_at) : null;
  const startDate = parseISO(rule.starts_at);

  // Start scanning from the start date (or the day after "after")
  let cursor = after ? addDays(after, 1) : new Date(startDate);

  // Safety: don't generate more than 365 days out
  const maxIterations = 365;
  let iterations = 0;

  while (results.length < count && iterations < maxIterations) {
    iterations++;
    const dayOfWeek = getDay(cursor); // 0=Sun … 6=Sat

    if (days.includes(dayOfWeek)) {
      const occurrence = applyTime(cursor, rule.start_time, rule.tz);

      if (!isBefore(startOfDay(cursor), startOfDay(startDate))) {
        if (endDate && isAfter(startOfDay(cursor), endDate)) break;
        if (
          (!after || isAfter(occurrence, after)) &&
          !isSkipped(cursor, rule.skip_dates)
        ) {
          results.push(occurrence.toISOString());
        }
      }
    }

    cursor = addDays(cursor, 1);
  }

  return results;
}

/**
 * Human-readable description of a recurrence pattern.
 */
export function describeRecurrence(
  pattern: RecurrencePattern,
  customDays: number[] | null,
  startTime: string,
  monthlyNth: number | null = null,
  monthlyDow: number | null = null,
): string {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const longDayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const time12 = formatTime12(startTime);

  switch (pattern) {
    case "weekly":
      return `Every week at ${time12}`;
    case "bi_weekly":
      return `Every 2 weeks at ${time12}`;
    case "tri_weekly":
      return `Every 3 weeks at ${time12}`;
    case "quad_weekly":
      return `Every 4 weeks at ${time12}`;
    case "monthly":
      return `Monthly at ${time12}`;
    case "custom_weekly": {
      const names = (customDays ?? [])
        .sort((a, b) => a - b)
        .map((d) => dayNames[d])
        .join(", ");
      return `Every ${names} at ${time12}`;
    }
    case "monthly_nth": {
      const ordinals = ["", "1st", "2nd", "3rd", "4th", "Last"];
      const ord = monthlyNth ? ordinals[monthlyNth] : "?";
      const day = monthlyDow != null ? longDayNames[monthlyDow] : "?";
      return `${ord} ${day} of every month at ${time12}`;
    }
  }
}

function formatTime12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const hour = h ?? 0;
  const minute = m ?? 0;
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

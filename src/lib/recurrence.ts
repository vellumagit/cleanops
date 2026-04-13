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
  parseISO,
} from "date-fns";
import { localInputToUtcIso } from "@/lib/validators/common";

export type RecurrencePattern =
  | "weekly"
  | "bi_weekly"
  | "tri_weekly"
  | "monthly"
  | "custom_weekly";

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
};

/**
 * Apply HH:MM time to a date in the org's timezone and return a proper
 * UTC Date. Uses localInputToUtcIso so recurring bookings get the right
 * wall-clock time regardless of server timezone.
 */
function applyTime(date: Date, time: string): Date {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  // Build a datetime-local string and convert via org timezone
  const dtLocal = `${y}-${mo}-${d}T${time}`;
  return new Date(localInputToUtcIso(dtLocal));
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
    const occurrence = applyTime(cursor, rule.start_time);

    // Check bounds
    if (endDate && isAfter(startOfDay(cursor), endDate)) break;

    // Only include dates on or after the start
    if (!isBefore(startOfDay(cursor), startOfDay(startDate))) {
      // Only include dates after the "after" cursor
      if (!after || isAfter(occurrence, after)) {
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
    case "monthly":
      return addMonths(current, 1);
    default:
      return addWeeks(current, 1);
  }
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
      const occurrence = applyTime(cursor, rule.start_time);

      if (!isBefore(startOfDay(cursor), startOfDay(startDate))) {
        if (endDate && isAfter(startOfDay(cursor), endDate)) break;
        if (!after || isAfter(occurrence, after)) {
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
): string {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const time12 = formatTime12(startTime);

  switch (pattern) {
    case "weekly":
      return `Every week at ${time12}`;
    case "bi_weekly":
      return `Every 2 weeks at ${time12}`;
    case "tri_weekly":
      return `Every 3 weeks at ${time12}`;
    case "monthly":
      return `Monthly at ${time12}`;
    case "custom_weekly": {
      const names = (customDays ?? [])
        .sort((a, b) => a - b)
        .map((d) => dayNames[d])
        .join(", ");
      return `Every ${names} at ${time12}`;
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

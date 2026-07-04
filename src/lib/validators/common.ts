import { z } from "zod";

import { DEFAULT_TZ } from "@/lib/format";

/**
 * Shared zod helpers used across CRUD form validators.
 */

/** Trim and treat empty string as undefined. */
export const trimmed = z
  .string()
  .max(2000, "Text must be 2000 characters or fewer")
  .transform((s) => s.trim())
  .transform((s) => (s.length === 0 ? undefined : s));

/** Optional trimmed string — coerces "" → undefined. */
export const optionalText = trimmed.optional();

/** Required non-empty trimmed string. */
export function requiredText(label: string, max = 200) {
  return z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, `${label} is required`)
    .refine((s) => s.length <= max, `${label} must be ${max} characters or fewer`);
}

/**
 * Parse a dollar amount typed in a form into integer cents.
 * Accepts "12", "12.5", "12.50", "$12.50", "1,200.99". Returns null on bad input.
 */
export function parseDollarsToCents(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = input.toString().replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Schema for a positive cents value, parsed from a dollar string in a form. */
export const dollarStringToCents = z
  .string()
  .transform((s, ctx) => {
    const cents = parseDollarsToCents(s);
    if (cents == null) {
      ctx.addIssue({ code: "custom", message: "Enter a valid dollar amount" });
      return z.NEVER;
    }
    return cents;
  });

/** Optional dollar → cents (returns undefined when blank). */
export const optionalDollarStringToCents = z
  .string()
  .transform((s, ctx) => {
    if (!s || s.trim() === "") return undefined;
    const cents = parseDollarsToCents(s);
    if (cents == null) {
      ctx.addIssue({ code: "custom", message: "Enter a valid dollar amount" });
      return z.NEVER;
    }
    return cents;
  });

/** Optional ISO date string from <input type="date">. */
export const optionalDate = z
  .string()
  .transform((s) => (s && s.trim() !== "" ? s : undefined))
  .optional();

/**
 * Convert a Postgres ISO timestamp (UTC) into the value format expected by
 * <input type="datetime-local"> (YYYY-MM-DDTHH:mm) in the **org timezone**.
 *
 * This ensures the form shows the same wall-clock time the user intended,
 * regardless of whether the server runs in UTC (Vercel) or local dev.
 */
export function toDatetimeLocal(
  iso: string | null | undefined,
  tz: string = DEFAULT_TZ,
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Format in the org's timezone so the form shows wall-clock time
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * Convert a datetime-local string (wall-clock in org timezone) to a proper
 * UTC ISO string. This is the inverse of `toDatetimeLocal`.
 *
 * `<input type="datetime-local">` produces strings like "2026-04-13T14:00".
 * On Vercel (UTC server), `new Date("2026-04-13T14:00")` parses this as UTC,
 * but the user meant 2:00 PM in their org's timezone. This function computes
 * the correct UTC offset and produces the right ISO string.
 *
 * Pass `tz` to use a specific org's timezone; defaults to DEFAULT_TZ.
 */
export function localInputToUtcIso(
  datetimeLocal: string,
  tz: string = DEFAULT_TZ,
): string {
  const d = new Date(datetimeLocal);
  if (Number.isNaN(d.getTime())) {
    // Unparseable input — return it unchanged so callers' own Number.isNaN
    // guards catch it. (Previously this returned d.toISOString(), which throws
    // RangeError on an Invalid Date and 500'd the manual time-entry actions.)
    return datetimeLocal;
  }

  // Treat the wall-clock string AS IF it were UTC to get a stable anchor
  // instant, then subtract the org tz's offset AT that instant.
  const naive = new Date(datetimeLocal + "Z"); // force UTC parse
  const offsetMs = tzOffsetMsAt(naive, tz);
  return new Date(naive.getTime() - offsetMs).toISOString();
}

/**
 * Milliseconds that `tz` is ahead of UTC at the given instant (negative behind
 * UTC). Computed deterministically from Intl parts + Date.UTC — NOT by parsing
 * a formatted string with `new Date()`, which interprets it in the SERVER's
 * timezone and corrupted the result on any non-UTC Node process (dev / seed /
 * non-UTC hosts). DST-correct because Intl uses the actual rules for `date`.
 */
function tzOffsetMsAt(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  // Some engines emit hour "24" for local midnight — normalize to 0.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    hour,
    map.minute,
    map.second,
  );
  return asUtc - date.getTime();
}

/** Convert cents to a plain dollar string suitable for an Input field. */
export function centsToDollarString(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

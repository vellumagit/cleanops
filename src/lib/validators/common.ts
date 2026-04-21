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
  // Parse the components from the input string
  const d = new Date(datetimeLocal);
  if (Number.isNaN(d.getTime())) return d.toISOString(); // fallback

  // The input was parsed as if it were local/UTC. We need to find what UTC
  // instant corresponds to this wall-clock time in the org's timezone.
  //
  // Strategy: render this UTC instant in the org tz to see what wall-clock
  // it maps to, compute the offset between the two, and subtract it. For
  // DST correctness we format the *target* date, not "now".
  const naive = new Date(datetimeLocal + "Z"); // force UTC parse
  const utcMs = naive.getTime();

  const inTz = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(naive),
  );
  // The offset is: what the tz clock shows minus the actual UTC
  const offsetMs = inTz.getTime() - utcMs;
  // Subtract the offset to go from wall-clock → UTC
  return new Date(utcMs - offsetMs).toISOString();
}

/** Convert cents to a plain dollar string suitable for an Input field. */
export function centsToDollarString(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

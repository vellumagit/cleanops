import { z } from "zod";

/**
 * Shared zod helpers used across CRUD form validators.
 */

/** Trim and treat empty string as undefined. */
export const trimmed = z
  .string()
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
 * Convert a Postgres ISO timestamp into the value format expected by
 * <input type="datetime-local"> (YYYY-MM-DDTHH:mm).
 */
export function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert cents to a plain dollar string suitable for an Input field. */
export function centsToDollarString(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

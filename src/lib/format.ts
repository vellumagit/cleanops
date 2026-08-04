/**
 * Shared display formatters used across the ops console list pages.
 *
 * Keep these pure and dependency-free so they can be called from server
 * components, client components, and the seed script alike.
 *
 * TIMEZONE NOTE: All dates in the database are stored as UTC ISO strings, so
 * every render needs a timezone to be meaningful. `tz` is REQUIRED on the date
 * formatters — omitting it used to fall back to America/New_York, silently, and
 * two Svit cleaners who clocked in at 3:00 PM Edmonton showed up as 5:00 PM on
 * the timesheet. A wrong render that no one is told about is worse than a
 * compile error, so this is a compile error now.
 *
 * Get it from `getOrgTimezone(organizationId)` in a server component (it is
 * React-cache()'d, so repeat calls in one request are free), or thread it down
 * as a prop to a client component. When there is genuinely no single org in
 * scope — the seed script, marketing pages, cross-org admin — pass
 * FALLBACK_TZ and mean it.
 */

/**
 * Last-resort timezone for the few surfaces with no organization in scope.
 *
 * Deliberately NOT named DEFAULT_TZ and deliberately not a default parameter
 * value: it should be typed out at a call site by someone who has decided
 * there is no org to ask, which is rare. If you are reaching for it inside
 * /app or /field, you want getOrgTimezone instead.
 */
export const FALLBACK_TZ =
  (typeof process !== "undefined"
    ? process.env?.NEXT_PUBLIC_DEFAULT_TIMEZONE
    : undefined) ?? "America/Edmonton";

export type CurrencyCode = "CAD" | "USD";

/**
 * Format an integer cents value as currency, e.g. 12500 → "CA$125.00".
 * Defaults to CAD because our first paying customer is Canadian. Callers
 * that know their org's currency should pass it explicitly.
 */
export function formatCurrencyCents(
  cents: number | null | undefined,
  currency: CurrencyCode = "CAD",
): string {
  if (cents == null) return "—";
  // Use narrowSymbol so the output is unambiguous ("CA$" vs "$", "US$" vs "$")
  // when CAD and USD can both appear in the same UI.
  return new Intl.NumberFormat(currency === "CAD" ? "en-CA" : "en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).format(cents / 100);
}

/**
 * Format an ISO timestamp as a short date, e.g. "Apr 7, 2026".
 * Pass `tz` to use an org-specific timezone; defaults to DEFAULT_TZ.
 */
export function formatDate(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  // Date-only strings ("2026-04-13") are UTC midnight — applying a timezone
  // offset rolls them back by a day. Append noon UTC so the date stays stable
  // across all timezones from UTC-12 to UTC+14.
  const safeIso = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
  const d = new Date(safeIso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  });
}

/**
 * Format an ISO timestamp as a date + time, e.g. "Apr 7, 2026 · 9:30 AM".
 */
export function formatDateTime(
  iso: string | null | undefined,
  tz: string,
): string {
  if (!iso) return "—";
  // Date-only strings shouldn't reach here, but handle them gracefully.
  const safeIso = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
  const d = new Date(safeIso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  })} · ${d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  })}`;
}

/** Format a duration in minutes as e.g. "1h 30m" or "45m". */
export function formatDurationMinutes(
  minutes: number | null | undefined,
): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Title-case a snake_case enum, e.g. "deep_clean" → "Deep clean". */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return "—";
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

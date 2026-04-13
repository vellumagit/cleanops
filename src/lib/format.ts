/**
 * Shared display formatters used across the ops console list pages.
 *
 * Keep these pure and dependency-free so they can be called from server
 * components, client components, and the seed script alike.
 *
 * TIMEZONE NOTE: All dates in the database are stored as UTC ISO strings.
 * Display functions format them in the app-wide default timezone so that
 * server-rendered HTML (UTC on Vercel) and client-rendered output (browser
 * local tz) show the same time. When org-level timezone support is added,
 * replace DEFAULT_TZ with the org's preference.
 */

/**
 * App-wide display timezone. Override with NEXT_PUBLIC_DEFAULT_TIMEZONE
 * in .env.local (e.g. "America/Chicago", "Europe/London").
 * Falls back to America/New_York — most Sollos 3 early customers are US-East.
 */
export const DEFAULT_TZ =
  (typeof process !== "undefined"
    ? process.env?.NEXT_PUBLIC_DEFAULT_TIMEZONE
    : undefined) ?? "America/New_York";

/** Format an integer cents value as USD currency, e.g. 12500 → "$125.00". */
export function formatCurrencyCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** Format an ISO timestamp as a short date, e.g. "Apr 7, 2026". */
export function formatDate(iso: string | null | undefined): string {
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
    timeZone: DEFAULT_TZ,
  });
}

/** Format an ISO timestamp as a date + time, e.g. "Apr 7, 2026 · 9:30 AM". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Date-only strings shouldn't reach here, but handle them gracefully.
  const safeIso = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
  const d = new Date(safeIso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: DEFAULT_TZ,
  })} · ${d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DEFAULT_TZ,
  })}`;
}

/** Format a duration in minutes as e.g. "1h 30m" or "45m". */
export function formatDurationMinutes(minutes: number | null | undefined): string {
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

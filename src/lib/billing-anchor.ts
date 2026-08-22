/**
 * Anchored billing periods — "bill me from the 15th to the 15th".
 *
 * The billing engine's original model hardcoded the calendar: monthly meant
 * the 1st, "biweekly" actually meant semimonthly on the 1st and 15th, and
 * those two days were baked into the cron schedule, the labels, and the
 * idempotency keys. Svitlana's ask is the obvious thing the model couldn't
 * say: a client whose month runs 20th → 20th, or a true two-week cycle
 * starting on a date she picks.
 *
 * Pure calendar arithmetic — no database, no timezone conversion. Callers
 * hand in "today" as an org-local YYYY-MM-DD (zonedYmd), so a period
 * boundary is the org's midnight, not the server's. All internal Date math
 * runs at UTC NOON deliberately: noon is immune to the DST edge where a
 * midnight-based Date can land in the previous day.
 *
 * TWO ANCHOR SHAPES, because the cadences genuinely differ:
 *   monthly   anchors to a DAY OF MONTH (1–28). Capped at 28 on purpose —
 *             it makes "the 31st in February" unrepresentable instead of
 *             clamped, which is one less rule anyone has to remember.
 *   biweekly  anchors to a DATE, and means it: exact 14-day cycles from
 *             that date, forever. Not "twice a month".
 *
 * KEYS ARE PREFIXED anchor-*: — never the legacy formats. Legacy biweekly
 * keys are `biweekly:<period END>`; anchored keys use the period START. A
 * client billed 1st–14th Aug the old way holds key `biweekly:2026-08-15` —
 * exactly what an anchored period STARTING Aug 15 would produce under the
 * legacy format, and the dedupe would silently swallow that client's first
 * anchored invoice. The prefix makes collision impossible by construction.
 */

export type AnchoredPeriod = {
  /** First day of the period, inclusive, org-local YYYY-MM-DD. */
  startYmd: string;
  /** Day after the period, exclusive, org-local YYYY-MM-DD. */
  endYmdExclusive: string;
  /** Idempotency key for invoices.billing_period_key. */
  key: string;
  /** Human label for the invoice line, e.g. "Jul 15 – Aug 14, 2026". */
  label: string;
};

export const MIN_ANCHOR_DAY = 1;
export const MAX_ANCHOR_DAY = 28;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Noon-UTC Date for a YYYY-MM-DD — DST-proof day arithmetic. */
function atNoon(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const d = atNoon(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return toYmd(d);
}

/** Whole days from a to b (b - a). */
function diffDays(aYmd: string, bYmd: string): number {
  return Math.round(
    (atNoon(bYmd).getTime() - atNoon(aYmd).getTime()) / 86_400_000,
  );
}

/** "Jul 15 – Aug 14, 2026" — inclusive last day, matching the legacy tone. */
function periodLabel(startYmd: string, endYmdExclusive: string): string {
  const start = atNoon(startYmd);
  const lastDay = atNoon(addDays(endYmdExclusive, -1));
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
      ...(withYear ? { year: "numeric" } : {}),
    });
  return `${fmt(start, false)} – ${fmt(lastDay, true)}`;
}

export function isValidAnchorDay(raw: unknown): boolean {
  const n = Number(raw);
  return (
    Number.isInteger(n) && n >= MIN_ANCHOR_DAY && n <= MAX_ANCHOR_DAY
  );
}

/**
 * The monthly period that ENDS today, if today is this client's billing day.
 *
 * Fires exactly when day-of-month(today) === anchorDay: the period billed is
 * [anchorDay of the previous month, today). Any other day returns null —
 * the caller runs daily and simply asks.
 *
 * Because anchorDay ≤ 28, "anchorDay of the previous month" always exists;
 * February needs no special case, which is the entire reason for the cap.
 */
export function monthlyAnchorPeriodEnding(
  todayYmd: string,
  anchorDay: number,
): AnchoredPeriod | null {
  if (!YMD.test(todayYmd) || !isValidAnchorDay(anchorDay)) return null;
  const [y, m, d] = todayYmd.split("-").map(Number);
  if (d !== anchorDay) return null;

  const prev = new Date(Date.UTC(y, m - 2, anchorDay, 12));
  const startYmd = toYmd(prev);
  return {
    startYmd,
    endYmdExclusive: todayYmd,
    key: `anchor-monthly:${startYmd}`,
    label: periodLabel(startYmd, todayYmd),
  };
}

/**
 * The 14-day period that ENDS today, if today lands on the client's cycle.
 *
 * Fires when (today − anchor) is a positive multiple of 14. The anchor day
 * itself returns null: the first bill goes out after the first FULL cycle,
 * not on the day the cycle starts. An anchor in the future is simply not
 * due yet.
 */
export function biweeklyAnchorPeriodEnding(
  todayYmd: string,
  anchorYmd: string,
): AnchoredPeriod | null {
  if (!YMD.test(todayYmd) || !YMD.test(anchorYmd)) return null;
  const diff = diffDays(anchorYmd, todayYmd);
  if (diff <= 0 || diff % 14 !== 0) return null;

  const startYmd = addDays(todayYmd, -14);
  return {
    startYmd,
    endYmdExclusive: todayYmd,
    key: `anchor-biweekly:${startYmd}`,
    label: periodLabel(startYmd, todayYmd),
  };
}

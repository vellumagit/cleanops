/**
 * Pay period calendar math. Pure YMD-string arithmetic — no timezones in
 * here on purpose: the caller resolves "today" in the org's timezone once,
 * and everything below is calendar dates.
 *
 * The one question this answers: given the org's schedule, what period
 * should the Payroll page suggest running next?
 *
 *   - The most recently COMPLETED period (you pay after a period ends) —
 *     unless a run already covers it, in which case the CURRENT, still
 *     in-progress period (so the page can say "ends Sep 15").
 */

export type PaySchedule = "semimonthly" | "biweekly" | "weekly" | "monthly";

export type PayPeriod = {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
  /** false = the period's end is still ahead of today */
  complete: boolean;
};

export const PAY_SCHEDULE_LABELS: Record<PaySchedule, string> = {
  semimonthly: "Semi-monthly (1–15 & 16–end)",
  biweekly: "Every 2 weeks",
  weekly: "Weekly",
  monthly: "Monthly (calendar month)",
};

function toUtc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}
function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(ymd: string, n: number): string {
  const d = toUtc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return toYmd(d);
}
function monthEnd(year: number, month0: number): string {
  // Day 0 of the next month = last day of this one.
  return toYmd(new Date(Date.UTC(year, month0 + 1, 0)));
}

/** The period CONTAINING the given day. Exported for Timesheets, which
 * browses the same calendar payroll pays on. */
export function periodContaining(
  schedule: PaySchedule,
  anchor: string | null,
  ymd: string,
): { start: string; end: string } {
  const d = toUtc(ymd);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();

  if (schedule === "semimonthly") {
    return day <= 15
      ? { start: toYmd(new Date(Date.UTC(y, m, 1))), end: toYmd(new Date(Date.UTC(y, m, 15))) }
      : { start: toYmd(new Date(Date.UTC(y, m, 16))), end: monthEnd(y, m) };
  }
  if (schedule === "monthly") {
    return { start: toYmd(new Date(Date.UTC(y, m, 1))), end: monthEnd(y, m) };
  }

  // weekly / biweekly: exact cycles counted from the anchor. A missing
  // anchor degrades to "a period started 0 days ago" so the math still
  // holds; the UI requires an anchor when picking these schedules.
  const len = schedule === "weekly" ? 7 : 14;
  const anchorYmd = anchor ?? ymd;
  const diffDays = Math.floor(
    (toUtc(ymd).getTime() - toUtc(anchorYmd).getTime()) / 86_400_000,
  );
  // Cycle index can be negative when today precedes the anchor — floor
  // handles both directions correctly.
  const k = Math.floor(diffDays / len);
  const start = addDays(anchorYmd, k * len);
  return { start, end: addDays(start, len - 1) };
}

/**
 * The period the Payroll page should suggest.
 *
 * @param lastCoveredEnd  period_end of the latest existing run (any status),
 *                        or null when no run exists yet.
 */
export function suggestedPayPeriod(
  schedule: PaySchedule,
  anchor: string | null,
  today: string,
  lastCoveredEnd: string | null,
): PayPeriod {
  const current = periodContaining(schedule, anchor, today);
  const previous = periodContaining(
    schedule,
    anchor,
    addDays(current.start, -1),
  );

  // The previous (completed) period wins unless a run already reaches its
  // end — then the only thing left to suggest is the one in progress.
  if (!lastCoveredEnd || lastCoveredEnd < previous.end) {
    return { ...previous, complete: true };
  }
  return { ...current, complete: current.end < today };
}

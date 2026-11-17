/**
 * When a recurring invoice bills next.
 *
 * One place for the arithmetic, shared by the nightly job (one step forward
 * after each invoice) and by Resume (as many steps as it takes to be in the
 * future again).
 */

export type InvoiceCadence = "weekly" | "biweekly" | "monthly" | "quarterly";

/**
 * The run after `current`. Month steps aim for the series' ANCHOR day and
 * are clamped to the target month's last day: a naive month add on Jan 31
 * lands on "Feb 31" = Mar 3, and clamping from the last run instead of the
 * anchor turned the 31st into the 28th for good after February.
 */
export function nextInvoiceRun(current: Date, cadence: string, anchorDay: number): Date {
  const addMonths = (months: number): Date => {
    const y = current.getUTCFullYear();
    const m = current.getUTCMonth() + months;
    const lastDayOfTarget = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(
      Date.UTC(
        y,
        m,
        Math.min(anchorDay, lastDayOfTarget),
        current.getUTCHours(),
        current.getUTCMinutes(),
        current.getUTCSeconds(),
      ),
    );
  };
  const next = new Date(current);
  switch (cadence) {
    case "weekly":
      next.setUTCDate(current.getUTCDate() + 7);
      return next;
    case "biweekly":
      next.setUTCDate(current.getUTCDate() + 14);
      return next;
    case "monthly":
      return addMonths(1);
    case "quarterly":
      return addMonths(3);
    default:
      return next;
  }
}

/**
 * The first scheduled run at or after `now`, stepping forward from
 * `current` on the series' own rhythm. Returns `current` unchanged when it
 * is already in the future (or the cadence is unknown).
 */
export function firstInvoiceRunFrom(current: Date, cadence: string, anchorDay: number, now: Date): Date {
  let run = current;
  // 2,000 weekly steps is 38 years; a guard, not a limit anyone meets.
  for (let i = 0; i < 2000 && run.getTime() < now.getTime(); i++) {
    const next = nextInvoiceRun(run, cadence, anchorDay);
    if (next.getTime() <= run.getTime()) break;
    run = next;
  }
  return run;
}

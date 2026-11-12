/**
 * Invoice balance math — the single source of truth for "how much has been
 * collected" and "how much is still owed", NET of refunds. A refunded payment
 * reduces the collected total, so a refunded (or partially-refunded) invoice
 * correctly shows an outstanding balance and its pay link reopens.
 *
 * Pure + dependency-free (no server-only) so it's shared across the checkout
 * builders, the public pay action, and every balance display. Previously each
 * site computed `sum(amount_cents - refunded_cents)` inline and could drift.
 */
export type PaymentAmount = {
  amount_cents: number | null;
  refunded_cents?: number | null;
};

/** Total actually collected, net of refunds. */
export function netPaidCents(
  payments: readonly PaymentAmount[] | null | undefined,
): number {
  return (payments ?? []).reduce(
    (sum, p) => sum + (p.amount_cents ?? 0) - (p.refunded_cents ?? 0),
    0,
  );
}

/**
 * PostgREST `or` filter for invoices the office should count as overdue:
 * `overdue`, plus part-paid ones that were sent and are past their due date.
 * A part-paid invoice is chased like an overdue one (sendOverdueReminders)
 * but keeps its partially_paid status, so a plain status check misses it.
 * Unsent drafts that took a deposit are partially_paid too and are neither
 * chased nor counted. The reminder, the weekly digest and the dashboard all
 * use this, so they agree.
 */
export function owedPastDueFilter(todayYmd: string): string {
  return `status.eq.overdue,and(status.eq.partially_paid,sent_at.not.is.null,due_date.lt.${todayYmd})`;
}

/**
 * PostgREST `or` filter for invoices the client has been sent and still owes
 * on: sent, overdue, or part-paid once sent. A draft that took a deposit is
 * partially_paid too, but the client has never seen it, so it is not an
 * outstanding invoice.
 */
export const OPEN_INVOICE_FILTER =
  "status.in.(sent,overdue),and(status.eq.partially_paid,sent_at.not.is.null)";

/**
 * Smallest balance worth chasing on a part-paid invoice, in cents: a client
 * who paid all but a rounding difference is not sent a weekly reminder for
 * $0.37.
 */
export const MIN_CHASED_BALANCE_CENTS = 100;

/** Remaining balance owed on an invoice, clamped to >= 0. */
export function outstandingBalanceCents(
  amountCents: number,
  payments: readonly PaymentAmount[] | null | undefined,
): number {
  return Math.max(0, amountCents - netPaidCents(payments));
}

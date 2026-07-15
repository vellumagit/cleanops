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

/** Remaining balance owed on an invoice, clamped to >= 0. */
export function outstandingBalanceCents(
  amountCents: number,
  payments: readonly PaymentAmount[] | null | undefined,
): number {
  return Math.max(0, amountCents - netPaidCents(payments));
}

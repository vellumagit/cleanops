/**
 * Invoice tax helpers.
 *
 * Tax rates live in basis points (bps) — 500 = 5.00%, 1300 = 13.00%.
 * Using integers everywhere avoids floating-point drift when we
 * round-trip through form inputs (text "5" → 500 bps → "5.00"). The
 * DB column is `invoices.tax_rate_bps int` and `organizations.default_
 * tax_rate_bps int`.
 */

export type TaxInput = {
  /** Rate in basis points, or null/undefined to skip tax entirely. */
  rateBps?: number | null;
};

export type TaxBreakdown = {
  /** The subtotal the tax was applied to, in cents. */
  subtotalCents: number;
  /** Rate in basis points (500 = 5%), or null when no tax. */
  rateBps: number | null;
  /** Tax portion in cents, or null when no tax. */
  taxAmountCents: number | null;
  /** subtotal + tax, the grand total stored as invoices.amount_cents. */
  totalCents: number;
};

/**
 * Compute tax on a subtotal.
 *
 * Rounds to the nearest cent (banker-style isn't standard on invoices —
 * most jurisdictions accept Math.round). When rateBps is null/0, returns
 * a no-tax breakdown (taxAmountCents = null so downstream code can
 * distinguish "no tax configured" from "0 tax applied").
 */
export function computeTax(
  subtotalCents: number,
  { rateBps }: TaxInput,
): TaxBreakdown {
  if (!rateBps || rateBps <= 0) {
    return {
      subtotalCents,
      rateBps: null,
      taxAmountCents: null,
      totalCents: subtotalCents,
    };
  }
  // subtotal * (rateBps / 10000), rounded to whole cents.
  const taxAmountCents = Math.round((subtotalCents * rateBps) / 10000);
  return {
    subtotalCents,
    rateBps,
    taxAmountCents,
    totalCents: subtotalCents + taxAmountCents,
  };
}

/**
 * Format a basis-point rate for display. 500 → "5%", 1250 → "12.5%".
 * Always trims trailing zeros so "5.00%" becomes "5%".
 */
export function formatTaxRate(rateBps: number | null | undefined): string {
  if (!rateBps) return "";
  const pct = rateBps / 100;
  // Strip trailing zeros after the decimal point.
  const s = pct.toFixed(2).replace(/\.?0+$/, "");
  return `${s}%`;
}

/**
 * Parse a user-entered rate (e.g. "5" or "12.5") into basis points.
 * Empty string or bad input → null (no tax).
 */
export function parseTaxRate(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  // Cap at 99.99% to match DB constraint.
  const bps = Math.round(n * 100);
  if (bps < 0) return null;
  if (bps > 9999) return 9999;
  return bps;
}

/**
 * Reading a percentage off a Sage tax rate.
 *
 * Split out of sage.ts (which is server-only) so the parsing can be tested
 * directly — it is subtle enough to have already cost us a live debugging
 * session:
 *
 *   - Sage sends percentages as STRINGS ("5.0"), not numbers. A `typeof x ===
 *     "number"` guard silently rejects every rate.
 *   - They only appear when the request asks for `attributes=all`; the plain
 *     list view returns just id/displayed_as, so there is nothing to compare.
 *   - Rates carry a dated `percentages[]` history, because jurisdictions
 *     change their tax. The right figure is the one effective on the invoice's
 *     own date, not necessarily the scalar.
 */

export type SageTaxRate = {
  id: string;
  displayed_as?: string | null;
  percentage?: string | number | null;
  percentages?: Array<{
    percentage?: string | number | null;
    from_date?: string | null;
    to_date?: string | null;
  }> | null;
};

/**
 * A Sage rate's percentage on `onDate` (YYYY-MM-DD), as a number — or null
 * when Sage gave us nothing parseable.
 */
export function sageRatePercent(
  rate: SageTaxRate,
  onDate: string,
): number | null {
  const dated = (rate.percentages ?? []).find(
    (p) =>
      (!p.from_date || p.from_date <= onDate) &&
      (!p.to_date || p.to_date >= onDate),
  );
  const raw = dated?.percentage ?? rate.percentage;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

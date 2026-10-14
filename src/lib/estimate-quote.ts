/**
 * Svit's website calculator posts its quote as ranges:
 * priceInitialLow/High (first clean) and priceRecurringLow/High (visits
 * after), plus estInitMins / estRecurMins. See api/estimate-request.
 */

/** Whole dollars from the calculator, or null when absent / not positive. */
function dollars(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function rangeText(lo: number | null, hi: number | null): string | null {
  if (lo && hi && lo !== hi) return `$${Math.min(lo, hi)}–$${Math.max(lo, hi)}`;
  const one = hi ?? lo;
  return one ? `$${one}` : null;
}

/**
 * The website calculator's quote, read whole: both ranges, the one total an
 * estimate can hold, and the time it worked out.
 */
export function quoteRange(body: Record<string, unknown>) {
  const initLow = dollars(body.priceInitialLow);
  const initHigh = dollars(body.priceInitialHigh);
  const recurLow = dollars(body.priceRecurringLow);
  const recurHigh = dollars(body.priceRecurringHigh);
  const initial = rangeText(initLow, initHigh);
  const recurring = rangeText(recurLow, recurHigh);
  // An estimate holds one total. Keep the top of the first-clean range — the
  // number the client has already seen as the most it could cost — and say
  // so, so it's never mistaken for the recurring price or the low end.
  const top = initHigh ?? initLow;
  const mins = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? `~${(n / 60).toFixed(n % 60 ? 1 : 0)}h` : null;
  };
  const initTime = mins(body.estInitMins);
  const recurTime = mins(body.estRecurMins);
  return {
    initial,
    recurring,
    totalCents: top ? Math.round(top * 100) : 0,
    summary:
      initial || recurring
        ? `Website quote — first clean: ${initial ?? "?"}${recurring ? `, then ${recurring} per visit` : ""}`
        : null,
    totalNote: top
      ? `Estimate total set to $${top} (top of the first-clean range) — adjust before sending.`
      : null,
    timeNote:
      initTime || recurTime
        ? `Calculator time: first clean ${initTime ?? "?"}${recurTime ? `, recurring ${recurTime}` : ""}`
        : null,
  };
}

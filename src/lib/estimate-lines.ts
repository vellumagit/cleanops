/**
 * The lines on an estimate: what is being quoted, piece by piece.
 *
 * The estimate's total is the sum of its lines when it has any. An estimate
 * with no lines keeps a typed total, which is every estimate made before
 * lines existed and every one that arrives from the website or the API.
 */

export type EstimateLine = {
  label: string;
  quantity: number;
  unit_price_cents: number;
  sort_order: number;
};

export const MAX_ESTIMATE_LINES = 50;

const toNumber = (v: unknown) => Number(String(v ?? "").replace(/[$,\s]/g, ""));

/** What one line comes to. */
export function estimateLineCents(line: Pick<EstimateLine, "quantity" | "unit_price_cents">): number {
  return Math.round(line.quantity * line.unit_price_cents);
}

export function estimateLinesTotalCents(lines: ReadonlyArray<Pick<EstimateLine, "quantity" | "unit_price_cents">>): number {
  return lines.reduce((sum, l) => sum + estimateLineCents(l), 0);
}

/**
 * Read the form's rows. A row left completely blank is ignored, so the empty
 * row the form always shows is not an error. A row with a description and no
 * price, or a price and no description, is refused by name.
 */
export function parseEstimateLines(raw: unknown): { lines: EstimateLine[]; error?: string } {
  if (raw == null || raw === "") return { lines: [] };
  let rows: unknown;
  try {
    rows = JSON.parse(String(raw));
  } catch {
    return { lines: [], error: "The line items couldn't be read. Reload the page and try again." };
  }
  if (!Array.isArray(rows)) return { lines: [], error: "The line items couldn't be read. Reload the page and try again." };

  const lines: EstimateLine[] = [];
  for (const row of rows) {
    const r = (row ?? {}) as Record<string, unknown>;
    const label = String(r.label ?? "").trim();
    const priceText = String(r.unit_price_dollars ?? "").trim();
    const qtyText = String(r.quantity ?? "").trim();
    if (!label && !priceText) continue;
    const n = lines.length + 1;
    if (!label) return { lines: [], error: `Line ${n} has a price but no description.` };
    if (label.length > 300) return { lines: [], error: `Line ${n}'s description is too long (300 characters at most).` };
    if (!priceText) return { lines: [], error: `"${label}" has no price. Type one, or 0 if it is included.` };
    const price = toNumber(priceText);
    if (!Number.isFinite(price) || price < 0) return { lines: [], error: `"${label}" has a price that isn't a number.` };
    const qty = qtyText === "" ? 1 : toNumber(qtyText);
    if (!Number.isFinite(qty) || qty < 0) return { lines: [], error: `"${label}" has a quantity that isn't a number.` };
    if (price > 1_000_000 || qty > 100_000) return { lines: [], error: `"${label}" is too large.` };
    lines.push({
      label,
      quantity: Math.round(qty * 100) / 100,
      unit_price_cents: Math.round(price * 100),
      sort_order: lines.length,
    });
    if (lines.length > MAX_ESTIMATE_LINES) {
      return { lines: [], error: `An estimate can have ${MAX_ESTIMATE_LINES} lines at most.` };
    }
  }
  return { lines };
}

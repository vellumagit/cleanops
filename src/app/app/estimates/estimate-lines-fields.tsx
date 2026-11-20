"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrencyCents } from "@/lib/format";
import { priceRangeLabel } from "@/lib/estimate-lines";
import { cn } from "@/lib/utils";

/**
 * The estimate's lines, as fields inside the one estimate form. Posts
 * `line_items_json`, and `total_cents`: the sum of the lines when there are
 * any, or the typed total when there are none.
 *
 * With `allowRange`, a tick turns every price into a pair: a low and a high
 * end. It then also posts `price_range=on`, each line's high price, and
 * (with no lines) `total_high_cents`. A line whose high end is left empty
 * is a fixed price inside a ranged estimate.
 */

export type ExistingEstimateLine = {
  label: string;
  quantity: number;
  unit_price_cents: number;
  unit_price_high_cents?: number | null;
  sort_order: number;
};

type Row = { key: string; label: string; quantity: string; price: string; priceHigh: string };

const blank = (): Row => ({ key: crypto.randomUUID(), label: "", quantity: "1", price: "", priceHigh: "" });
const num = (s: string) => Number(s.replace(/[$,\s]/g, "")) || 0;

export function EstimateLinesFields({
  existing,
  totalDollars,
  currency,
  error,
  intro = "One row for each thing you are quoting. The client sees these rows and the total on the estimate and its PDF.",
  totalName = "total_cents",
  totalWord = "Total",
  taxRateBps = null,
  taxLabel = "Tax",
  allowRange = false,
  totalHighDollars = "",
}: {
  existing: ExistingEstimateLine[];
  /** The saved total, for an estimate that has no lines. */
  totalDollars: string;
  currency: "CAD" | "USD";
  error?: string;
  /** The line under "Line items". */
  intro?: string;
  /** The field the sum (or the typed amount) is posted as, in dollars. */
  totalName?: string;
  /** What the sum is called: "Total", or "Amount before tax". */
  totalWord?: string;
  /** When set, the tax and the total with tax are shown under the sum. */
  taxRateBps?: number | null;
  taxLabel?: string;
  /** Offer the "price range" tick (estimates only). */
  allowRange?: boolean;
  /** The saved top of the range, for an estimate that has no lines. */
  totalHighDollars?: string;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    existing.length === 0
      ? [blank()]
      : [...existing]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((l) => ({
            key: crypto.randomUUID(),
            label: l.label,
            quantity: String(l.quantity),
            price: (l.unit_price_cents / 100).toFixed(2),
            priceHigh:
              l.unit_price_high_cents != null && l.unit_price_high_cents > l.unit_price_cents
                ? (l.unit_price_high_cents / 100).toFixed(2)
                : "",
          })),
  );
  const [typedTotal, setTypedTotal] = useState(totalDollars);
  const [typedHigh, setTypedHigh] = useState(totalHighDollars);
  // Ticked to start with when the saved estimate already has a range.
  const [range, setRange] = useState(
    () =>
      allowRange &&
      (totalHighDollars.trim() !== "" ||
        existing.some((l) => l.unit_price_high_cents != null && l.unit_price_high_cents > l.unit_price_cents)),
  );
  const qtyOf = (r: Row) => (r.quantity.trim() === "" ? 1 : num(r.quantity));
  const lowOf = (r: Row) => Math.round(qtyOf(r) * Math.round(num(r.price) * 100));
  /** The line at its high price; its one price when no high end is typed. */
  const highOf = (r: Row) =>
    range && r.priceHigh.trim() !== "" ? Math.round(qtyOf(r) * Math.round(num(r.priceHigh) * 100)) : lowOf(r);

  const filled = rows.filter((r) => r.label.trim() !== "" || r.price.trim() !== "");
  const hasLines = filled.length > 0;
  const linesCents = filled.reduce(
    (sum, r) => sum + Math.round((r.quantity.trim() === "" ? 1 : num(r.quantity)) * Math.round(num(r.price) * 100)),
    0,
  );

  const linesHighCents = filled.reduce((sum, r) => sum + highOf(r), 0);
  const beforeTaxCents = hasLines ? linesCents : Math.round(num(typedTotal) * 100);
  const grid = range
    ? "sm:grid sm:grid-cols-[minmax(0,1fr)_60px_92px_92px_104px_32px]"
    : "sm:grid sm:grid-cols-[minmax(0,1fr)_72px_110px_96px_32px]";
  const taxCents = taxRateBps && taxRateBps > 0 ? Math.round((beforeTaxCents * taxRateBps) / 10000) : null;

  const update = (key: string, field: "label" | "quantity" | "price" | "priceHigh", value: string) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const remove = (key: string) =>
    setRows((prev) => {
      const next = prev.filter((r) => r.key !== key);
      return next.length ? next : [blank()];
    });

  return (
    <div className="space-y-3">
      <input
        type="hidden"
        name="line_items_json"
        value={JSON.stringify(
          rows.map((r) => ({
            label: r.label,
            quantity: r.quantity,
            unit_price_dollars: r.price,
            unit_price_high_dollars: range ? r.priceHigh : "",
          })),
        )}
      />
      {range && <input type="hidden" name="price_range" value="on" />}

      <div>
        <p className="text-sm font-medium">Line items</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{intro}</p>
      </div>

      {allowRange && (
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={range}
            onChange={(e) => setRange(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-input"
          />
          <span>
            <span className="block text-sm font-medium">Give a price range</span>
            <span className="block text-xs text-muted-foreground">
              For a quote like &ldquo;between $300 and $400&rdquo;. Type the low and the high price; the client
              sees the range. Leave a line&rsquo;s high price empty if that line is a fixed price.
            </span>
          </span>
        </label>
      )}

      <div className="space-y-2">
        <div className={cn("hidden gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground", grid)}>
          <span>Description</span>
          <span>Qty</span>
          <span>{range ? "Price from" : "Price each"}</span>
          {range && <span>Price to</span>}
          <span className="text-right">Amount</span>
          <span />
        </div>
        {rows.map((r, i) => {
          const amount = lowOf(r);
          return (
            <div
              key={r.key}
              className={cn("flex flex-col gap-2 rounded-md border border-border p-3 sm:items-center sm:border-0 sm:p-0", grid)}
            >
              <Input
                placeholder="e.g. Deep clean, 3 bedrooms"
                value={r.label}
                onChange={(e) => update(r.key, "label", e.target.value)}
                aria-label={`Line ${i + 1} description`}
                maxLength={300}
                className="min-w-0"
              />
              <Input
                placeholder="1"
                value={r.quantity}
                onChange={(e) => update(r.key, "quantity", e.target.value)}
                inputMode="decimal"
                aria-label={`Line ${i + 1} quantity`}
                className="tabular-nums"
              />
              <Input
                placeholder="0.00"
                value={r.price}
                onChange={(e) => update(r.key, "price", e.target.value)}
                inputMode="decimal"
                aria-label={range ? `Line ${i + 1} price from` : `Line ${i + 1} price each`}
                className="tabular-nums"
              />
              {range && (
                <Input
                  placeholder="same"
                  value={r.priceHigh}
                  onChange={(e) => update(r.key, "priceHigh", e.target.value)}
                  inputMode="decimal"
                  aria-label={`Line ${i + 1} price to`}
                  aria-invalid={r.priceHigh.trim() !== "" && num(r.priceHigh) < num(r.price)}
                  className="tabular-nums"
                />
              )}
              <span
                className={cn(
                  "text-right font-mono tabular-nums text-muted-foreground",
                  range ? "text-xs leading-tight" : "text-sm",
                )}
              >
                {r.price.trim() === "" ? "" : priceRangeLabel(amount, highOf(r), currency)}
              </span>
              <button
                type="button"
                onClick={() => remove(r.key)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Remove line ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => setRows((p) => [...p, blank()])}>
          <Plus className="h-4 w-4" />
          Add line item
        </Button>

        {hasLines ? (
          <div className="text-right">
            <input type="hidden" name={totalName} value={(linesCents / 100).toFixed(2)} />
            <span className="text-xs text-muted-foreground">{totalWord} ({currency}): </span>
            <span className="font-mono text-base font-semibold tabular-nums" data-testid="estimate-total">
              {priceRangeLabel(linesCents, range ? linesHighCents : null, currency)}
            </span>
          </div>
        ) : (
          <label className="block text-right">
            <span className="block text-xs text-muted-foreground">
              {totalWord} ({currency}), if you aren&rsquo;t listing lines
            </span>
            <Input
              id={totalName}
              name={totalName}
              inputMode="decimal"
              required
              value={typedTotal}
              onChange={(e) => setTypedTotal(e.target.value)}
              className="mt-1 w-36 text-right tabular-nums"
              aria-invalid={Boolean(error)}
            />
            {range && (
              <>
                <span className="mt-2 block text-xs text-muted-foreground">up to</span>
                <Input
                  name="total_high_cents"
                  inputMode="decimal"
                  value={typedHigh}
                  onChange={(e) => setTypedHigh(e.target.value)}
                  aria-label="High end of the range"
                  className="mt-1 w-36 text-right tabular-nums"
                />
              </>
            )}
          </label>
        )}
      </div>
      {taxCents != null && (
        <div className="space-y-0.5 text-right text-sm" data-testid="lines-tax">
          <p className="text-muted-foreground">
            {taxLabel || "Tax"}:{" "}
            <span className="font-mono tabular-nums">{formatCurrencyCents(taxCents, currency)}</span>
          </p>
          <p className="font-semibold">
            Each invoice:{" "}
            <span className="font-mono tabular-nums" data-testid="lines-total-with-tax">
              {formatCurrencyCents(beforeTaxCents + taxCents, currency)}
            </span>
          </p>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

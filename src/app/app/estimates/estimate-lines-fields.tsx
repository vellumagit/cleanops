"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrencyCents } from "@/lib/format";

/**
 * The estimate's lines, as fields inside the one estimate form. Posts
 * `line_items_json`, and `total_cents`: the sum of the lines when there are
 * any, or the typed total when there are none.
 */

export type ExistingEstimateLine = {
  label: string;
  quantity: number;
  unit_price_cents: number;
  sort_order: number;
};

type Row = { key: string; label: string; quantity: string; price: string };

const blank = (): Row => ({ key: crypto.randomUUID(), label: "", quantity: "1", price: "" });
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
          })),
  );
  const [typedTotal, setTypedTotal] = useState(totalDollars);

  const filled = rows.filter((r) => r.label.trim() !== "" || r.price.trim() !== "");
  const hasLines = filled.length > 0;
  const linesCents = filled.reduce(
    (sum, r) => sum + Math.round((r.quantity.trim() === "" ? 1 : num(r.quantity)) * Math.round(num(r.price) * 100)),
    0,
  );

  const beforeTaxCents = hasLines ? linesCents : Math.round(num(typedTotal) * 100);
  const taxCents = taxRateBps && taxRateBps > 0 ? Math.round((beforeTaxCents * taxRateBps) / 10000) : null;

  const update = (key: string, field: "label" | "quantity" | "price", value: string) =>
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
          rows.map((r) => ({ label: r.label, quantity: r.quantity, unit_price_dollars: r.price })),
        )}
      />

      <div>
        <p className="text-sm font-medium">Line items</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{intro}</p>
      </div>

      <div className="space-y-2">
        <div className="hidden gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_72px_110px_96px_32px]">
          <span>Description</span>
          <span>Qty</span>
          <span>Price each</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        {rows.map((r, i) => {
          const amount = Math.round((r.quantity.trim() === "" ? 1 : num(r.quantity)) * Math.round(num(r.price) * 100));
          return (
            <div
              key={r.key}
              className="flex flex-col gap-2 rounded-md border border-border p-3 sm:grid sm:grid-cols-[minmax(0,1fr)_72px_110px_96px_32px] sm:items-center sm:border-0 sm:p-0"
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
                aria-label={`Line ${i + 1} price each`}
                className="tabular-nums"
              />
              <span className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                {r.price.trim() === "" ? "" : formatCurrencyCents(amount, currency)}
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
              {formatCurrencyCents(linesCents, currency)}
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

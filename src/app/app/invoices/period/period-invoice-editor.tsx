"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { formatCurrencyCents, type CurrencyCode } from "@/lib/format";
import { computeTax, formatTaxRate, parseTaxRate } from "@/lib/invoice-tax";
import {
  createPeriodInvoiceAction,
  type PeriodInvoiceState,
} from "../actions";

export type InitialLine = {
  label: string;
  quantity: string;
  unitPriceDollars: string;
  bookingId: string | null;
};

type Line = InitialLine & { key: string };

const empty: PeriodInvoiceState = {};

function lineCents(l: Line): number {
  const qty = Number(l.quantity) || 0;
  const price = Number(l.unitPriceDollars.replace(/[$,\s]/g, "")) || 0;
  return Math.round(qty * price * 100);
}

export function PeriodInvoiceEditor({
  clientId,
  initialLines,
  currency = "CAD",
}: {
  clientId: string;
  initialLines: InitialLine[];
  currency?: CurrencyCode;
}) {
  const [state, formAction] = useActionState(createPeriodInvoiceAction, empty);

  const [lines, setLines] = useState<Line[]>(() =>
    initialLines.map((l) => ({ ...l, key: crypto.randomUUID() })),
  );
  const [dueDate, setDueDate] = useState("");
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [rateText, setRateText] = useState("");
  const [labelText, setLabelText] = useState("");

  function addLine() {
    setLines((p) => [
      ...p,
      {
        key: crypto.randomUUID(),
        label: "",
        quantity: "1",
        unitPriceDollars: "",
        bookingId: null,
      },
    ]);
  }
  function removeLine(key: string) {
    setLines((p) => p.filter((l) => l.key !== key));
  }
  function update(key: string, field: keyof InitialLine, value: string) {
    setLines((p) =>
      p.map((l) => (l.key === key ? { ...l, [field]: value } : l)),
    );
  }

  const subtotalCents = lines.reduce((s, l) => s + lineCents(l), 0);
  const rateBps = taxEnabled ? parseTaxRate(rateText) : null;
  const tax = computeTax(subtotalCents, { rateBps });

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.errors?._form} />

      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="due_date" value={dueDate} />
      <input
        type="hidden"
        name="tax_rate_percent"
        value={taxEnabled ? rateText : ""}
      />
      <input type="hidden" name="tax_label" value={taxEnabled ? labelText : ""} />
      <input
        type="hidden"
        name="line_items_json"
        value={JSON.stringify(
          lines.map((l) => ({
            label: l.label,
            quantity: l.quantity,
            unit_price_dollars: l.unitPriceDollars,
            booking_id: l.bookingId,
          })),
        )}
      />

      {/* Line items */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="hidden grid-cols-[1fr_5rem_7rem_6rem_2rem] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
          <span>Description</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Unit ({currency})</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        <div className="divide-y divide-border">
          {lines.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No lines. Click “Add line” to start.
            </p>
          ) : (
            lines.map((l) => (
              <div
                key={l.key}
                className="grid grid-cols-1 gap-2 px-3 py-2 sm:grid-cols-[1fr_5rem_7rem_6rem_2rem] sm:items-center"
              >
                <Input
                  value={l.label}
                  onChange={(e) => update(l.key, "label", e.target.value)}
                  placeholder="Standard clean — Jun 3"
                />
                <Input
                  value={l.quantity}
                  onChange={(e) => update(l.key, "quantity", e.target.value)}
                  inputMode="decimal"
                  className="text-right tabular-nums"
                />
                <Input
                  value={l.unitPriceDollars}
                  onChange={(e) =>
                    update(l.key, "unitPriceDollars", e.target.value)
                  }
                  inputMode="decimal"
                  placeholder="0.00"
                  className="text-right tabular-nums"
                />
                <span className="text-right text-sm font-medium tabular-nums">
                  {formatCurrencyCents(lineCents(l), currency)}
                </span>
                <button
                  type="button"
                  onClick={() => removeLine(l.key)}
                  className="flex h-8 w-8 items-center justify-center justify-self-end rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <Button type="button" variant="outline" size="sm" onClick={addLine}>
        <Plus className="h-4 w-4" />
        Add line
      </Button>

      {/* Tax */}
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={taxEnabled}
            onChange={(e) => setTaxEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Add tax
        </label>
        {taxEnabled && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Rate (%)</span>
              <Input
                value={rateText}
                onChange={(e) => setRateText(e.target.value)}
                inputMode="decimal"
                placeholder="13"
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">
                Label (optional)
              </span>
              <Input
                value={labelText}
                onChange={(e) => setLabelText(e.target.value)}
                placeholder="HST"
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer: due date + totals + submit */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-t border-border pt-4">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Due date</span>
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="text-right text-sm">
          <div className="text-muted-foreground">
            Subtotal:{" "}
            <span className="font-mono tabular-nums">
              {formatCurrencyCents(subtotalCents, currency)}
            </span>
          </div>
          {tax.rateBps && tax.taxAmountCents !== null && (
            <div className="text-muted-foreground">
              {(labelText.trim() || "Tax")} {formatTaxRate(tax.rateBps)}:{" "}
              <span className="font-mono tabular-nums">
                {formatCurrencyCents(tax.taxAmountCents, currency)}
              </span>
            </div>
          )}
          <div className="mt-0.5 text-base font-semibold">
            Total:{" "}
            <span className="font-mono tabular-nums">
              {formatCurrencyCents(tax.totalCents, currency)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Creating…">
          <FileText className="h-4 w-4" />
          Create draft invoice
        </SubmitButton>
      </div>
    </form>
  );
}

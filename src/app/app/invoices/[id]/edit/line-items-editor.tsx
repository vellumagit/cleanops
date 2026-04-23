"use client";

import { useActionState, useCallback, useId, useState } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { formatCurrencyCents } from "@/lib/format";
import {
  saveLineItemsAction,
  type LineItemsFormState,
} from "./line-items-actions";

type LineItem = {
  /** Temp client-side key. DB id is passed as `dbId` if the row existed. */
  key: string;
  dbId: string | null;
  label: string;
  quantity: string;
  unitPriceDollars: string;
};

const empty: LineItemsFormState = {};

function newBlank(): LineItem {
  return {
    key: crypto.randomUUID(),
    dbId: null,
    label: "",
    quantity: "1",
    unitPriceDollars: "",
  };
}

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export type ExistingLineItem = {
  id: string;
  label: string;
  quantity: number;
  unit_price_cents: number;
  sort_order: number;
};

export function LineItemsEditor({
  invoiceId,
  existing,
}: {
  invoiceId: string;
  existing: ExistingLineItem[];
}) {
  const prefix = useId();
  const boundAction = saveLineItemsAction.bind(null, invoiceId);
  const [state, formAction] = useActionState(boundAction, empty);

  const [items, setItems] = useState<LineItem[]>(() => {
    if (existing.length === 0) return [newBlank()];
    return existing
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((e) => ({
        key: crypto.randomUUID(),
        dbId: e.id,
        label: e.label,
        quantity: String(e.quantity),
        unitPriceDollars: centsToDollars(e.unit_price_cents),
      }));
  });

  const addRow = useCallback(() => {
    setItems((prev) => [...prev, newBlank()]);
  }, []);

  const removeRow = useCallback((key: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.key !== key);
      return next.length === 0 ? [newBlank()] : next;
    });
  }, []);

  const updateRow = useCallback(
    (key: string, field: keyof LineItem, value: string) => {
      setItems((prev) =>
        prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)),
      );
    },
    [],
  );

  // Compute running total for display
  const totalCents = items.reduce((sum, item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPriceDollars.replace(/[$,\s]/g, "")) || 0;
    return sum + Math.round(qty * price * 100);
  }, 0);

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.errors?._form} />

      {/* Hidden JSON payload — the action reads this */}
      <input type="hidden" name="line_items_json" value={JSON.stringify(
        items.map((item, idx) => ({
          db_id: item.dbId,
          label: item.label,
          quantity: item.quantity,
          unit_price_dollars: item.unitPriceDollars,
          sort_order: idx,
        })),
      )} />

      <div className="space-y-2">
        {/* Header */}
        <div className="hidden gap-2 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[1fr_80px_110px_32px]">
          <span>Description</span>
          <span>Qty</span>
          <span>Unit price</span>
          <span />
        </div>

        {items.map((item, _idx) => (
          <div
            key={item.key}
            className="group flex flex-col gap-2 rounded-md border border-border bg-background p-3 sm:grid sm:grid-cols-[1fr_80px_110px_32px] sm:items-center sm:border-0 sm:bg-transparent sm:p-0 sm:px-2"
          >
            <div className="flex items-center gap-2">
              <GripVertical className="hidden h-4 w-4 shrink-0 text-muted-foreground/40 sm:block" />
              <Input
                placeholder="Description"
                value={item.label}
                onChange={(e) => updateRow(item.key, "label", e.target.value)}
                className="min-w-0"
                required
              />
            </div>
            <Input
              placeholder="1"
              value={item.quantity}
              onChange={(e) => updateRow(item.key, "quantity", e.target.value)}
              inputMode="decimal"
              className="tabular-nums"
              required
            />
            <Input
              placeholder="0.00"
              value={item.unitPriceDollars}
              onChange={(e) =>
                updateRow(item.key, "unitPriceDollars", e.target.value)
              }
              inputMode="decimal"
              className="tabular-nums"
              required
            />
            <button
              type="button"
              onClick={() => removeRow(item.key)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Remove row"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          onClick={addRow}
          variant="outline"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          Add line item
        </Button>
        <div className="text-right">
          <span className="text-xs text-muted-foreground">Total: </span>
          <span className="font-mono text-sm font-semibold tabular-nums">
            {formatCurrencyCents(totalCents)}
          </span>
        </div>
      </div>

      <div className="flex justify-end border-t border-border pt-4">
        <SubmitButton pendingLabel="Saving…">Save line items</SubmitButton>
      </div>
    </form>
  );
}

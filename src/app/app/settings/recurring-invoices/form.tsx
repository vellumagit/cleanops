"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";
import {
  createRecurringInvoiceAction,
  updateRecurringInvoiceAction,
  type RecurringInvoiceState,
} from "./actions";

export type RecurringInvoiceFormDefaults = {
  client_id: string;
  name: string;
  cadence: "weekly" | "biweekly" | "monthly" | "quarterly";
  amount_dollars: string;
  due_days: number;
  next_run_at: string; // yyyy-mm-dd
  notes: string;
  line_items: string; // JSON string
};

type Props = {
  clients: Array<{ id: string; name: string }>;
  mode: "new" | "edit";
  /** Required in edit mode */
  id?: string;
  defaults?: RecurringInvoiceFormDefaults;
};

export function RecurringInvoiceForm({ clients, mode, id, defaults }: Props) {
  const boundAction =
    mode === "edit" && id
      ? updateRecurringInvoiceAction.bind(null, id)
      : createRecurringInvoiceAction;

  const [state, formAction] = useActionState<RecurringInvoiceState, FormData>(
    boundAction,
    {},
  );

  const v = state.values ?? {};

  // Default start for new series = tomorrow.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultStart = defaults?.next_run_at ?? tomorrow.toISOString().slice(0, 10);

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          placeholder="e.g. Monthly retainer — Acme Corp"
          defaultValue={v.name ?? defaults?.name ?? ""}
          className="mt-1"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Internal label for this schedule. Not shown on the invoice itself.
        </p>
        {state.errors?.name && (
          <p className="mt-1 text-xs text-red-700">{state.errors.name}</p>
        )}
      </div>

      <div>
        <Label htmlFor="client_id">Client</Label>
        <select
          id="client_id"
          name="client_id"
          required
          defaultValue={v.client_id ?? defaults?.client_id ?? ""}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Select a client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {state.errors?.client_id && (
          <p className="mt-1 text-xs text-red-700">{state.errors.client_id}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="cadence">Cadence</Label>
          <select
            id="cadence"
            name="cadence"
            defaultValue={v.cadence ?? defaults?.cadence ?? "monthly"}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </div>

        <div>
          <Label htmlFor="amount_dollars">Amount</Label>
          <Input
            id="amount_dollars"
            name="amount_dollars"
            type="number"
            step="0.01"
            min="0"
            required
            placeholder="500.00"
            defaultValue={v.amount_dollars ?? defaults?.amount_dollars ?? ""}
            className="mt-1"
          />
          {state.errors?.amount_cents && (
            <p className="mt-1 text-xs text-red-700">
              {state.errors.amount_cents}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="next_run_at">
            {mode === "edit" ? "Next invoice date" : "First invoice date"}
          </Label>
          <Input
            id="next_run_at"
            name="next_run_at"
            type="date"
            required
            defaultValue={v.next_run_at ?? defaultStart}
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {mode === "edit"
              ? "Changing this shifts when the next invoice will be generated. The cadence still applies from here."
              : "The cron will generate the first invoice on (or just after) this date."}
          </p>
          {state.errors?.next_run_at && (
            <p className="mt-1 text-xs text-red-700">
              {state.errors.next_run_at}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="due_days">Net (days until due)</Label>
          <Input
            id="due_days"
            name="due_days"
            type="number"
            min="0"
            max="180"
            defaultValue={
              v.due_days ?? (defaults?.due_days ?? 14).toString()
            }
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="notes">Notes (optional)</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={v.notes ?? defaults?.notes ?? ""}
          placeholder="Notes that will appear on every generated invoice."
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <div>
        <Label htmlFor="line_items">Line items (JSON, optional)</Label>
        <textarea
          id="line_items"
          name="line_items"
          rows={4}
          defaultValue={v.line_items ?? defaults?.line_items ?? ""}
          placeholder='[{"description":"Office cleaning retainer","quantity":1,"unit_cents":50000}]'
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          If omitted, the invoice will have no line items — just the total amount. Leave blank if you prefer to add line items manually on each generated invoice.
        </p>
        {state.errors?.line_items && (
          <p className="mt-1 text-xs text-red-700">
            {state.errors.line_items}
          </p>
        )}
      </div>

      {state.errors?._form && (
        <p className="text-xs text-red-700">{state.errors._form}</p>
      )}

      <SubmitButton pendingLabel={mode === "edit" ? "Saving…" : "Creating…"}>
        {mode === "edit" ? "Save changes" : "Create series"}
      </SubmitButton>
    </form>
  );
}

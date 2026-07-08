"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  saveInvoiceAutoSendAction,
  type InvoicingFormState,
} from "./actions";

const empty: InvoicingFormState = {};

export type InvoicingFormProps = {
  enabled: boolean;
  delayHours: number;
  consolidated: boolean;
};

const DELAY_OPTIONS = [
  { value: 0, label: "As soon as possible" },
  { value: 12, label: "12 hours" },
  { value: 24, label: "24 hours" },
  { value: 48, label: "48 hours" },
  { value: 72, label: "72 hours" },
];

export function InvoicingForm(props: InvoicingFormProps) {
  const [state, formAction] = useActionState(saveInvoiceAutoSendAction, empty);

  return (
    <form action={formAction} className="max-w-lg space-y-6">
      <FormError message={state.errors?._form} />

      {state.success && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Saved.
        </div>
      )}

      {/* Master toggle */}
      <label className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={props.enabled}
          className="mt-0.5 h-4 w-4"
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium">
            Auto-send invoices after a review window
          </span>
          <span className="text-xs text-muted-foreground">
            A draft is created when a job completes (or on the billing date for
            biweekly/monthly clients). If you don&apos;t change or hold it, it
            sends itself after the delay below. Off by default.
          </span>
        </span>
      </label>

      {/* Delay */}
      <FormField
        label="Review window"
        htmlFor="delay_hours"
        error={state.errors?.delay}
        hint="How long a fresh draft waits before it auto-sends. Edit it any time during the window — whatever it says when the timer is up is what ships. Sends run once a day, so the actual send is at the next daily pass after the window elapses."
      >
        <select
          id="delay_hours"
          name="delay_hours"
          defaultValue={String(props.delayHours)}
          className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
        >
          {DELAY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </FormField>

      {/* Consolidated */}
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="consolidated"
          defaultChecked={props.consolidated}
          className="mt-0.5 h-4 w-4"
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium">
            Also auto-send biweekly / monthly invoices
          </span>
          <span className="text-xs text-muted-foreground">
            Consolidated invoices generated on the 1st / 15th for retainer and
            biweekly clients. Turn this off to keep those for manual review while
            still auto-sending per-job invoices.
          </span>
        </span>
      </label>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </form>
  );
}

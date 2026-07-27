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
  sendHour: number;
  consolidated: boolean;
};

// Every hour of the day — most owners pick a business-hours slot; the
// morning digest (early AM) fires before any of them.
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`,
}));

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
            Auto-send invoices the day after the job
          </span>
          <span className="text-xs text-muted-foreground">
            A draft is created when a job completes (or on the billing date for
            biweekly/monthly clients). If you don&apos;t change or hold it, it
            emails itself at the time below on the next day. Off by default.
          </span>
        </span>
      </label>

      {/* Send time */}
      <FormField
        label="Send time"
        htmlFor="send_hour"
        error={state.errors?.hour}
        hint="Local time, the day after the job. Edit or hold any draft before then — whatever it says at send time is what ships. Tip: turn on the “Morning invoice review” digest in Settings → Automations to get the day's outgoing invoices in your inbox each morning, hours before they go."
      >
        <select
          id="send_hour"
          name="send_hour"
          defaultValue={String(props.sendHour)}
          className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
        >
          {HOUR_OPTIONS.map((o) => (
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

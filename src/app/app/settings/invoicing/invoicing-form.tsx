"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
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

  // CONTROLLED, deliberately. These were uncontrolled (defaultValue /
  // defaultChecked), which React only applies on first mount — so after
  // useActionState re-rendered the form on save, the inputs snapped back to
  // the values the page was originally rendered with. Saving 10:00 AM
  // stored 10 correctly but redisplayed 5:00 PM, which reads exactly like
  // "my setting didn't save".
  const [enabled, setEnabled] = useState(props.enabled);
  const [sendHour, setSendHour] = useState(String(props.sendHour));
  const [consolidated, setConsolidated] = useState(props.consolidated);

  // Re-seed from the server whenever the SAVED values change — React's
  // adjust-state-during-render pattern. useState only seeds on mount, so
  // without this a form still mounted after a save keeps showing whatever
  // it had, which reads as "my change was ignored". Doing it here rather
  // than with a `key` on the parent keeps this component mounted, so the
  // "Saved." confirmation from useActionState survives.
  const savedSignature = `${props.enabled}|${props.sendHour}|${props.consolidated}`;
  const [seenSignature, setSeenSignature] = useState(savedSignature);
  if (savedSignature !== seenSignature) {
    setSeenSignature(savedSignature);
    setEnabled(props.enabled);
    setSendHour(String(props.sendHour));
    setConsolidated(props.consolidated);
  }

  return (
    <form action={formAction} className="max-w-lg space-y-6">
      <FormError message={state.errors?._form} />

      {state.success && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Saved.
        </div>
      )}

      {state.success && state.queued && state.queued.count > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-200">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {state.queued.count} draft invoice
            {state.queued.count === 1 ? "" : "s"} from the last 7 days{" "}
            {state.queued.count === 1 ? "is" : "are"} now queued — going out{" "}
            {new Date(state.queued.sendAtIso).toLocaleString("en-US", {
              weekday: "long",
              hour: "numeric",
              minute: "2-digit",
            })}
            . Review them on the Invoices page; hold any you don&apos;t want
            sent.
          </span>
        </div>
      )}

      {/* Master toggle */}
      <label className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium">
            Auto-send invoices the day after the job
          </span>
          <span className="text-xs text-muted-foreground">
            A draft is created when a job completes (or on the billing date for
            biweekly/monthly clients). If you don&apos;t change or hold it, it
            sends itself at the time below on the next day — by email, or as a
            text with the payment link for clients set to text. Off by default.
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
          value={sendHour}
          onChange={(e) => setSendHour(e.target.value)}
          className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
        >
          {HOUR_OPTIONS.map((o) => (
            // value as an explicit STRING — the state is a string, and a
            // number/string mismatch leaves the select matching no option,
            // which renders as the first entry (12:00 AM) and submits it.
            <option key={o.value} value={String(o.value)}>
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
          checked={consolidated}
          onChange={(e) => setConsolidated(e.target.checked)}
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

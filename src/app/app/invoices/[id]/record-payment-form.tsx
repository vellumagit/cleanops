"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  recordInvoicePaymentAction,
  type InvoicePaymentFormState,
} from "../actions";
import {
  PAYMENT_METHODS,
  humanizePaymentMethod,
} from "@/lib/validators/invoice-payment";
import { centsToDollarString } from "@/lib/validators/common";

const empty: InvoicePaymentFormState = {};

type Props = {
  invoiceId: string;
  balanceCents: number;
};

/**
 * Compact inline form for recording a manual payment against an invoice.
 *
 * Pre-fills the amount with the remaining balance and the date with
 * today, so the happy path is "click Record" after the admin sees the
 * money land in their bank.
 */
export function RecordPaymentForm({ invoiceId, balanceCents }: Props) {
  const [tipDollars, setTipDollars] = useState("");
  // The form posts cents; the box takes dollars. Anything unparseable is no
  // tip rather than an error — refusing a payment over a typo in an optional
  // field would be absurd.
  const tipCents = (() => {
    const n = Number(tipDollars.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  })();

  const boundAction = recordInvoicePaymentAction.bind(null, invoiceId);
  const [state, formAction] = useActionState(boundAction, empty);

  const today = new Date().toISOString().slice(0, 10);
  const defaultAmount = centsToDollarString(balanceCents);

  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state.errors?._form} />

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          label="Amount"
          htmlFor="amount_dollars"
          required
          error={state.errors?.amount_dollars}
        >
          <Input
            id="amount_dollars"
            name="amount_dollars"
            type="text"
            inputMode="decimal"
            defaultValue={defaultAmount}
            required
          />
        </FormField>

        <FormField
          label="Method"
          htmlFor="method"
          required
          error={state.errors?.method}
        >
          <FormSelect
            id="method"
            name="method"
            defaultValue="bank_transfer"
            required
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {humanizePaymentMethod(m)}
              </option>
            ))}
          </FormSelect>
        </FormField>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          label="Received on"
          htmlFor="received_at"
          required
          error={state.errors?.received_at}
        >
          <Input
            id="received_at"
            name="received_at"
            type="date"
            defaultValue={today}
            required
          />
        </FormField>

        <FormField
          label="Reference"
          htmlFor="reference"
          error={state.errors?.reference}
          hint="Check #, confirmation, last 4, etc"
        >
          <Input
            id="reference"
            name="reference"
            type="text"
            placeholder="Optional"
          />
        </FormField>
      </div>

      {/* ── Tip that came with the payment ────────────────────────────────
          Kept out of the amount above ON PURPOSE. The amount is what the
          INVOICE was paid; a tip is money on top of it. Folding them together
          would show the invoice overpaid and drive the balance negative —
          the same trap the card path had to be built around.

          The custody question is the one that matters. A tip the business
          received is owed onward and shows in "Tips to pass on". Cash handed
          straight to the cleaner is already settled, and recording it as
          outstanding would invent a debt and invite paying it twice. */}
      <details className="rounded-lg border border-border bg-muted/20 p-3">
        <summary className="cursor-pointer text-xs font-medium">
          Did they add a tip?
        </summary>
        <div className="mt-3 space-y-3">
          <FormField label="Tip amount" htmlFor="tip_dollars">
            <Input
              id="tip_dollars"
              name="tip_dollars"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={tipDollars}
              onChange={(e) => setTipDollars(e.target.value)}
            />
          </FormField>
          <input type="hidden" name="tip_cents" value={tipCents} />

          <fieldset className="space-y-1.5">
            <legend className="text-[11px] font-medium text-muted-foreground">
              Who has the money?
            </legend>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="radio"
                name="tip_custody"
                value="held"
                defaultChecked
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">We received it</span>
                <span className="block text-muted-foreground">
                  Came in with the payment. Shows under Payroll as owed to the
                  cleaner until you pass it on.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs">
              <input type="radio" name="tip_custody" value="direct" className="mt-0.5" />
              <span>
                <span className="font-medium">Paid straight to the cleaner</span>
                <span className="block text-muted-foreground">
                  Cash in hand. Recorded for their totals, never as money you
                  owe.
                </span>
              </span>
            </label>
          </fieldset>
        </div>
      </details>

      <FormField
        label="Notes"
        htmlFor="notes"
        error={state.errors?.notes}
      >
        <Textarea
          id="notes"
          name="notes"
          rows={2}
          placeholder="Optional — internal notes only"
        />
      </FormField>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Recording…">Record payment</SubmitButton>
      </div>
    </form>
  );
}

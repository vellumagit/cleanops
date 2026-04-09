"use client";

import { useActionState } from "react";
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

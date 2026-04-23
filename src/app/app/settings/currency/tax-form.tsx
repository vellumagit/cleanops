"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { saveTaxDefaultsAction, type TaxDefaultsFormState } from "./actions";

const empty: TaxDefaultsFormState = {};

/**
 * Form for the org's default tax rate + label. These pre-fill new
 * invoices so owners in tax jurisdictions don't have to retype
 * "GST 5%" on every single invoice. Existing invoices are NOT
 * rewritten when this changes — each invoice stores its own rate.
 */
export function TaxForm({
  currentRatePercent,
  currentLabel,
}: {
  currentRatePercent: string;
  currentLabel: string;
}) {
  const [state, formAction] = useActionState(saveTaxDefaultsAction, empty);

  return (
    <form action={formAction} className="space-y-5 max-w-lg">
      <FormError message={state.errors?._form} />

      {state.success && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Default tax saved. New invoices will pre-fill with these values.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Tax label"
          htmlFor="tax_label"
          error={state.errors?.tax_label}
          hint="What clients see on the invoice — GST, HST, VAT, etc."
        >
          <Input
            id="tax_label"
            name="tax_label"
            placeholder="GST"
            defaultValue={currentLabel}
          />
        </FormField>

        <FormField
          label="Rate (%)"
          htmlFor="tax_rate"
          error={state.errors?.tax_rate}
          hint="e.g. 5 for 5%, leave blank for no default tax."
        >
          <Input
            id="tax_rate"
            name="tax_rate"
            inputMode="decimal"
            placeholder="5"
            defaultValue={currentRatePercent}
          />
        </FormField>
      </div>

      <p className="text-xs text-muted-foreground">
        Each invoice saves its own rate at creation time, so changing this
        default never retroactively edits an old invoice. Every invoice can
        also override this default individually in the edit form.
      </p>

      <div className="flex items-center justify-end">
        <SubmitButton pendingLabel="Saving…">Save tax defaults</SubmitButton>
      </div>
    </form>
  );
}

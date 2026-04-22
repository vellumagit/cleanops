"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { SetupReturnField } from "@/components/setup-return-field";
import {
  savePaymentInstructionsAction,
  type PaymentMethodsFormState,
} from "./actions";

const empty: PaymentMethodsFormState = {};

export function PaymentMethodsForm({
  defaultInstructions,
}: {
  defaultInstructions: string;
}) {
  const [state, formAction] = useActionState(
    savePaymentInstructionsAction,
    empty,
  );

  useEffect(() => {
    if (state.values && !state.errors) {
      toast.success("Payment instructions saved");
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <SetupReturnField />
      <FormError message={state.errors?._form} />

      <FormField
        label="Default instructions"
        htmlFor="instructions"
        error={state.errors?.instructions}
        hint="Shown to clients on every public invoice page. You can override per-invoice later."
      >
        <Textarea
          id="instructions"
          name="instructions"
          rows={10}
          defaultValue={defaultInstructions}
          placeholder={`Zelle: payments@yourcompany.com\nVenmo: @yourhandle\n\nOr mail a check to:\nYour Company LLC\n123 Main St, City, ST 00000`}
        />
      </FormField>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">Save instructions</SubmitButton>
      </div>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { PauseCircle } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { FormError } from "@/components/form-field";
import { holdInvoiceAutoSendAction, type SendInvoiceState } from "../actions";

const EMPTY: SendInvoiceState = {};

/**
 * "Hold" button on a draft invoice that's scheduled to auto-send. Cancels the
 * timer so the owner can review/edit indefinitely and send on their own terms.
 */
export function HoldAutoSendButton({ invoiceId }: { invoiceId: string }) {
  const [state, action] = useActionState<SendInvoiceState, FormData>(
    holdInvoiceAutoSendAction,
    EMPTY,
  );

  return (
    <div className="flex flex-col gap-2">
      <form action={action}>
        <input type="hidden" name="id" value={invoiceId} />
        <SubmitButton variant="outline" size="sm" pendingLabel="Holding…">
          <PauseCircle className="h-4 w-4" />
          Hold auto-send
        </SubmitButton>
      </form>
      {state.error && <FormError message={state.error} />}
    </div>
  );
}

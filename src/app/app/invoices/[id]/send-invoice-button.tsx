"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { FormError } from "@/components/form-field";
import { sendInvoiceAction, type SendInvoiceState } from "../actions";

const EMPTY: SendInvoiceState = {};

/**
 * "Mark as sent" button with inline error surfacing.
 *
 * Before: the form action was wired directly and swallowed delivery
 * failures — owners reported "I sent a test invoice and nothing
 * arrived", because the status flip succeeded while Resend silently
 * returned false. Now the action returns `{ error }` and we render
 * it right below the button, so the owner sees exactly why the email
 * didn't go out (Resend not configured, sender not verified, etc.).
 */
export function SendInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [state, action] = useActionState<SendInvoiceState, FormData>(
    sendInvoiceAction,
    EMPTY,
  );

  return (
    <div className="flex flex-col gap-2">
      <form action={action}>
        <input type="hidden" name="id" value={invoiceId} />
        <SubmitButton variant="default" size="sm" pendingLabel="Sending…">
          <Send className="h-4 w-4" />
          Mark as sent
        </SubmitButton>
      </form>
      {state.error && <FormError message={state.error} />}
    </div>
  );
}

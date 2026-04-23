"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { FormError } from "@/components/form-field";
import { resendInvoiceEmailAction, type SendInvoiceState } from "../actions";

const EMPTY: SendInvoiceState = {};

/**
 * "Resend email" button — shown on invoices that have already been
 * marked sent. Calls resendInvoiceEmailAction which re-runs the full
 * delivery path (same gates, same Resend call) without touching
 * status or sent_at, then surfaces the exact result inline so the
 * owner can actually see what's happening when deliveries misbehave.
 */
export function ResendInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [state, action] = useActionState<SendInvoiceState, FormData>(
    resendInvoiceEmailAction,
    EMPTY,
  );

  return (
    <div className="flex flex-col gap-2">
      <form action={action}>
        <input type="hidden" name="id" value={invoiceId} />
        <SubmitButton variant="outline" size="sm" pendingLabel="Resending…">
          <Send className="h-4 w-4" />
          Resend email
        </SubmitButton>
      </form>
      {state.error && <FormError message={state.error} />}
      {state.ok && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          Email accepted by Resend
          {state.messageId ? ` (id: ${state.messageId})` : ""}. If it doesn&rsquo;t arrive in a minute, check spam / Promotions — and search for that id in your Resend dashboard to see delivery status.
        </p>
      )}
    </div>
  );
}

"use client";

import { useActionState, useEffect, useState } from "react";
import { Send, AlertTriangle } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { FormError } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { resendInvoiceEmailAction, type SendInvoiceState } from "../actions";

const EMPTY: SendInvoiceState = {};

/**
 * "Send invoice again" button with a two-stage confirm. First click
 * arms the warning; second click actually fires the resend. Clients
 * get a duplicate invoice in their inbox otherwise, which looks sloppy
 * — better one extra tap for the owner than an "oops" the client
 * notices.
 *
 * Available on invoices that are past the draft stage; hits
 * resendInvoiceEmailAction which re-runs the full delivery path
 * (same gates, same Resend call) without touching status or sent_at.
 * Errors surface inline so the owner can see exactly what happened
 * when deliveries misbehave (RESEND_API_KEY missing, Resend refused,
 * etc.).
 */
export function ResendInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [state, action] = useActionState<SendInvoiceState, FormData>(
    resendInvoiceEmailAction,
    EMPTY,
  );
  const [confirming, setConfirming] = useState(false);

  // Drop the warning once the send completes successfully or errors —
  // either way the armed state is stale.
  useEffect(() => {
    if (state.ok || state.error) setConfirming(false);
  }, [state.ok, state.error]);

  if (!confirming) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirming(true)}
        >
          <Send className="h-4 w-4" />
          Send invoice again
        </Button>
        {state.error && <FormError message={state.error} />}
        {state.ok && (
          <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
            Email accepted by Resend
            {state.messageId ? ` (id: ${state.messageId})` : ""}. If it
            doesn&rsquo;t arrive in a minute, check spam / Promotions — and
            search for that id in your Resend dashboard to see delivery
            status.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="flex-1 text-xs">
            <p className="font-medium text-amber-800 dark:text-amber-300">
              Are you sure?
            </p>
            <p className="mt-0.5 text-amber-700/80 dark:text-amber-400/80">
              This will deliver another copy of the invoice email to the
              client. Use this only if the first one never arrived or
              needs a nudge.
            </p>
          </div>
        </div>
        <form action={action} className="mt-3 flex items-center gap-2">
          <input type="hidden" name="id" value={invoiceId} />
          <SubmitButton variant="default" size="sm" pendingLabel="Sending…">
            <Send className="h-4 w-4" />
            Yes, send again
          </SubmitButton>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </form>
      </div>
    </div>
  );
}

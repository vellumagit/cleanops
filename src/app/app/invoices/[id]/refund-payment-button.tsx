"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Undo2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/submit-button";
import {
  refundStripePaymentAction,
  type RefundPaymentState,
} from "../actions";

const empty: RefundPaymentState = {};

/**
 * Refund a card payment without leaving Sollos.
 *
 * Exists because the alternative is nothing: these charges live on the
 * platform's Stripe account, so the business owner has no dashboard of their
 * own to refund from. Partial amounts stay within the invoice portion; the
 * tip only moves on a full refund — the split-arithmetic reason lives in
 * stripe-refunds.ts.
 */
export function RefundPaymentButton({
  paymentId,
  invoiceId,
  remainingCents,
  remainingLabel,
}: {
  paymentId: string;
  invoiceId: string;
  /** Invoice portion still refundable, in cents. */
  remainingCents: number;
  /** The same, formatted server-side ("$140.00"). */
  remainingLabel: string;
}) {
  const [state, formAction] = useActionState(refundStripePaymentAction, empty);
  const [full, setFull] = useState(false);
  const [amount, setAmount] = useState((remainingCents / 100).toFixed(2));

  if (state.ok) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Refund issued — the ledger updates as Stripe confirms it, usually
        within seconds. The client sees the money in 5–10 business days.
      </p>
    );
  }

  return (
    <details className="mt-1">
      <summary className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
        <Undo2 className="h-3 w-3" />
        Refund…
      </summary>
      <form
        action={formAction}
        className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-3"
      >
        <input type="hidden" name="payment_id" value={paymentId} />
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <input type="hidden" name="mode" value={full ? "full" : "partial"} />

        {state.error && (
          <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Input
            name="amount_dollars"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={full}
            className="h-8 w-28 text-xs"
          />
          <span className="text-[11px] text-muted-foreground">
            of {remainingLabel} refundable
          </span>
        </div>

        <label className="flex items-start gap-2 text-[11px]">
          <input
            type="checkbox"
            checked={full}
            onChange={(e) => setFull(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Refund everything on this charge</span>
            <span className="block text-muted-foreground">
              Includes any tip the client added — it comes off{" "}
              <span className="font-medium">Tips to pass on</span> too, unless
              it was already paid out.
            </span>
          </span>
        </label>

        <p className="text-[11px] text-muted-foreground">
          The money comes back out of your Stripe balance — the same place the
          payment landed. This can&rsquo;t be undone.
        </p>

        <SubmitButton pendingLabel="Refunding…">Issue refund</SubmitButton>
      </form>
    </details>
  );
}

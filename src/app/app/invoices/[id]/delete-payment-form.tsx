"use client";

import { X } from "lucide-react";
import { deleteInvoicePaymentAction } from "../actions";

export function DeletePaymentForm({
  paymentId,
  invoiceId,
}: {
  paymentId: string;
  invoiceId: string;
}) {
  return (
    <form
      action={deleteInvoicePaymentAction}
      onSubmit={(e) => {
        if (!window.confirm("Remove this payment row? The invoice total will recompute.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="payment_id" value={paymentId} />
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <button
        type="submit"
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Remove payment"
      >
        <X className="h-4 w-4" />
      </button>
    </form>
  );
}

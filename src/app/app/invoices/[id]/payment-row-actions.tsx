"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSelect } from "@/components/form-field";
import {
  deleteInvoicePaymentAction,
  updateInvoicePaymentAction,
} from "../actions";
import {
  PAYMENT_METHODS,
  humanizePaymentMethod,
} from "@/lib/validators/invoice-payment";

type Payment = {
  id: string;
  invoice_id: string;
  amount_cents: number;
  method: string;
  reference: string | null;
  notes: string | null;
  received_at: string;
};

/**
 * Edit + delete controls for a single manually-recorded invoice payment.
 * Wraps the existing delete with an edit dialog that reuses the payment
 * schema. Processor payments (Stripe etc.) skip the edit — refund flow
 * is the only safe path for those.
 */
export function PaymentRowActions({ payment }: { payment: Payment }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [amount, setAmount] = useState(
    (payment.amount_cents / 100).toFixed(2),
  );
  const [method, setMethod] = useState(payment.method);
  const [reference, setReference] = useState(payment.reference ?? "");
  const [receivedAt, setReceivedAt] = useState(
    payment.received_at.slice(0, 10),
  );
  const [notes, setNotes] = useState(payment.notes ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("payment_id", payment.id);
    fd.set("invoice_id", payment.invoice_id);
    fd.set("amount_dollars", amount);
    fd.set("method", method);
    fd.set("reference", reference);
    fd.set("received_at", receivedAt);
    fd.set("notes", notes);
    startTransition(async () => {
      const res = await updateInvoicePaymentAction(fd);
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      toast.success("Payment updated");
      setEditOpen(false);
      router.refresh();
    });
  }

  function handleDelete() {
    if (
      !window.confirm(
        "Remove this payment row? The invoice total will recompute.",
      )
    )
      return;
    const fd = new FormData();
    fd.set("payment_id", payment.id);
    fd.set("invoice_id", payment.invoice_id);
    startTransition(async () => {
      try {
        await deleteInvoicePaymentAction(fd);
        toast.success("Payment deleted");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setEditOpen(true)}
        aria-label="Edit payment"
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={handleDelete}
        aria-label="Remove payment"
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit payment</DialogTitle>
            <DialogDescription>
              Fix the amount, date, method, or reference. The invoice total
              will recompute automatically.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4">
            {formError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {formError}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pp_amount">Amount ($)</Label>
                <Input
                  id="pp_amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pp_method">Method</Label>
                <FormSelect
                  id="pp_method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  required
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {humanizePaymentMethod(m)}
                    </option>
                  ))}
                </FormSelect>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pp_received">Received on</Label>
                <Input
                  id="pp_received"
                  type="date"
                  value={receivedAt}
                  onChange={(e) => setReceivedAt(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pp_reference">Reference</Label>
                <Input
                  id="pp_reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Check #, confirmation, last 4"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pp_notes">Notes</Label>
              <Textarea
                id="pp_notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

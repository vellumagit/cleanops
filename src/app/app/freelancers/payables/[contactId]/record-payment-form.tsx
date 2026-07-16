"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField, FormSelect } from "@/components/form-field";
import { recordPayoutAction } from "../actions";

const METHODS = ["E-transfer", "Cash", "Cheque", "Other"] as const;

function today(): string {
  // Local wall-clock date in yyyy-mm-dd for the <input type="date"> default.
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffset).toISOString().slice(0, 10);
}

/** Dialog form for recording a payment made to a subcontractor. */
export function RecordPaymentForm({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("contact_id", contactId);
    startTransition(async () => {
      const res = await recordPayoutAction(fd);
      if (res.ok) {
        toast.success("Payment recorded");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="default" size="sm" />}>
        <Banknote className="h-3.5 w-3.5" />
        Record payment
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <FormField label="Amount" htmlFor="amount" required>
            <Input
              id="amount"
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              inputMode="decimal"
              placeholder="0.00"
              required
            />
          </FormField>
          <FormField label="Paid on" htmlFor="paid_on">
            <Input
              id="paid_on"
              name="paid_on"
              type="date"
              defaultValue={today()}
            />
          </FormField>
          <FormField label="Method" htmlFor="method">
            <FormSelect id="method" name="method" defaultValue="E-transfer">
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </FormSelect>
          </FormField>
          <FormField
            label="Reference"
            htmlFor="reference"
            hint="Cheque number, e-transfer confirmation, etc."
          >
            <Input id="reference" name="reference" type="text" />
          </FormField>
          <FormField label="Notes" htmlFor="notes">
            <Input id="notes" name="notes" type="text" />
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Receipt } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { FormError } from "@/components/form-field";
import { buttonVariants } from "@/components/ui/button";
import {
  generateInvoiceFromBookingAction,
  type GenerateInvoiceState,
} from "../actions";

const EMPTY: GenerateInvoiceState = {};

/**
 * "Generate invoice now" — manual escalation of the auto-invoice
 * automation. Use when completing a job didn't produce a draft invoice
 * for any reason (migration not run, automation disabled, silent bug).
 * Errors render inline so the owner can actually see what's failing
 * instead of guessing.
 */
export function GenerateInvoiceButton({
  bookingId,
  totalCents,
}: {
  bookingId: string;
  /** The booking's price — a zero here means the draft will open at $0. */
  totalCents: number;
}) {
  const [state, action] = useActionState<GenerateInvoiceState, FormData>(
    generateInvoiceFromBookingAction,
    EMPTY,
  );

  return (
    <div className="flex flex-col gap-2">
      <form action={action}>
        <input type="hidden" name="booking_id" value={bookingId} />
        <SubmitButton variant="outline" size="sm" pendingLabel="Generating…">
          <Receipt className="h-4 w-4" />
          Generate invoice
        </SubmitButton>
      </form>
      {totalCents === 0 && !state.ok && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          This job has no price, so the invoice will start at $0. Set the
          price on the booking first (Edit), or fill in the amount on the
          draft after generating.
        </p>
      )}
      {state.error && <FormError message={state.error} />}
      {state.ok && state.invoiceId && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          Draft invoice {state.invoiceNumber ?? ""} created.{" "}
          <Link
            href={`/app/invoices/${state.invoiceId}`}
            className={buttonVariants({ variant: "link", size: "sm" })}
          >
            Open invoice →
          </Link>
        </div>
      )}
    </div>
  );
}

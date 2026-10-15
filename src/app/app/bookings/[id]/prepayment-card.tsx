"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { formatCurrencyCents } from "@/lib/format";
import {
  PAYMENT_METHODS,
  humanizePaymentMethod,
} from "@/lib/validators/invoice-payment";
import {
  recordBookingPrepaymentAction,
  removeBookingPrepaymentAction,
  type PrepaymentState,
} from "../prepayment-actions";

export type PrepaymentRow = {
  id: string;
  amount_cents: number;
  method: (typeof PAYMENT_METHODS)[number];
  reference: string | null;
  received_label: string;
  applied_invoice: { id: string; number: string | null } | null;
};

/**
 * "Sylvia paid yesterday for today's clean." Records money that arrived
 * before the job's invoice exists; it moves onto the invoice by itself when
 * the invoice is made (or now, if it already is). Owner/admin only — the
 * page only renders this for them.
 */
export function PrepaymentCard({
  bookingId,
  canRecord,
  defaultCents,
  todayYmd,
  rows,
}: {
  bookingId: string;
  /** False on a cancelled job: its prepayments still show, but nothing new
   *  is recorded against it. */
  canRecord: boolean;
  /** The job's price, to prefill the amount. */
  defaultCents: number;
  /** Today in the org's timezone, YYYY-MM-DD. */
  todayYmd: string;
  rows: PrepaymentRow[];
}) {
  const [state, formAction] = useActionState(
    recordBookingPrepaymentAction.bind(null, bookingId),
    {} as PrepaymentState,
  );
  const [open, setOpen] = useState(false);
  const waiting = rows.filter((r) => !r.applied_invoice);
  const waitingCents = waiting.reduce((s, r) => s + r.amount_cents, 0);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="sollos-label">Paid in advance</p>

      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Client paid before the job? Record it here — it goes onto the
          invoice when the job is invoiced.
        </p>
      ) : (
        <ul className="mt-3 space-y-2 text-xs">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  {formatCurrencyCents(r.amount_cents)} ·{" "}
                  {humanizePaymentMethod(r.method)}
                </p>
                <p className="text-muted-foreground">
                  {r.received_label}
                  {r.reference ? ` · ${r.reference}` : ""}
                </p>
                <p className="text-muted-foreground">
                  {r.applied_invoice ? (
                    <>
                      On{" "}
                      <Link
                        href={`/app/invoices/${r.applied_invoice.id}`}
                        className="font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {r.applied_invoice.number ?? "the invoice"}
                      </Link>
                    </>
                  ) : (
                    "Goes on the invoice when it's made"
                  )}
                </p>
              </div>
              {!r.applied_invoice && (
                <form action={removeBookingPrepaymentAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="booking_id" value={bookingId} />
                  <button
                    type="submit"
                    className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Remove
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {waiting.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {formatCurrencyCents(waitingCents)} waiting for this job&apos;s invoice.
        </p>
      )}

      {state.ok && (
        <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          {state.appliedTo
            ? "Recorded and added to the invoice."
            : "Recorded. It'll go on the invoice when the job is invoiced."}
        </p>
      )}

      {!canRecord ? (
        waiting.length > 0 && (
          <p className="mt-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            This job is cancelled — refund this, or record it on the
            client&apos;s next job and remove it here.
          </p>
        )
      ) : !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 text-xs font-medium text-foreground underline-offset-2 hover:underline"
        >
          + Record a payment
        </button>
      ) : (
        <form action={formAction} className="mt-3 space-y-3">
          <FormError message={state.errors?._form} />
          <FormField label="Amount ($)" htmlFor="pp_amount" required error={state.errors?.amount_dollars}>
            <Input
              id="pp_amount"
              name="amount_dollars"
              inputMode="decimal"
              defaultValue={
                state.values?.amount_dollars ??
                (defaultCents > 0 ? (defaultCents / 100).toFixed(2) : "")
              }
              required
            />
          </FormField>
          <FormField label="Method" htmlFor="pp_method" required error={state.errors?.method}>
            <select
              id="pp_method"
              name="method"
              defaultValue={state.values?.method ?? "bank_transfer"}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {humanizePaymentMethod(m)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Received" htmlFor="pp_received" required error={state.errors?.received_at}>
            <Input
              id="pp_received"
              name="received_at"
              type="date"
              defaultValue={state.values?.received_at ?? todayYmd}
              required
            />
          </FormField>
          <FormField label="Reference" htmlFor="pp_reference" error={state.errors?.reference}>
            <Input
              id="pp_reference"
              name="reference"
              placeholder="e-transfer #, cheque #…"
              defaultValue={state.values?.reference ?? ""}
            />
          </FormField>
          <div className="flex items-center gap-3">
            <SubmitButton size="sm">Save payment</SubmitButton>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

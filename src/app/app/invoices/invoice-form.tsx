"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  createInvoiceAction,
  updateInvoiceAction,
  type InvoiceFormState,
} from "./actions";

const empty: InvoiceFormState = {};

type Defaults = {
  client_id?: string;
  booking_id?: string | null;
  status?: string;
  amount_dollars?: string;
  due_date?: string | null;
};

export function InvoiceForm({
  mode,
  id,
  defaults,
  clients,
  bookings,
  currency = "CAD",
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: Defaults;
  clients: { id: string; label: string }[];
  bookings: { id: string; label: string }[];
  currency?: "CAD" | "USD";
}) {
  const action =
    mode === "create"
      ? createInvoiceAction
      : updateInvoiceAction.bind(null, id ?? "");
  const [state, formAction] = useActionState(action, empty);
  const v = state.values ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />

      <FormField
        label="Client"
        htmlFor="client_id"
        required
        error={state.errors?.client_id}
      >
        <FormSelect
          id="client_id"
          name="client_id"
          required
          defaultValue={v.client_id ?? defaults?.client_id ?? ""}
        >
          <option value="">Select a client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </FormSelect>
      </FormField>

      <FormField
        label="Linked booking"
        htmlFor="booking_id"
        error={state.errors?.booking_id}
        hint="Optional — link the booking this invoice covers"
      >
        <FormSelect
          id="booking_id"
          name="booking_id"
          defaultValue={v.booking_id ?? defaults?.booking_id ?? ""}
        >
          <option value="">— None —</option>
          {bookings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </FormSelect>
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Status"
          htmlFor="status"
          required
          error={state.errors?.status}
          hint="Sent / paid dates auto-stamp on transition"
        >
          <FormSelect
            id="status"
            name="status"
            defaultValue={v.status ?? defaults?.status ?? "draft"}
          >
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </FormSelect>
        </FormField>

        <FormField
          label={`Amount (${currency})`}
          htmlFor="amount_cents"
          required
          error={state.errors?.amount_cents}
        >
          <Input
            id="amount_cents"
            name="amount_cents"
            inputMode="decimal"
            required
            defaultValue={v.amount_cents ?? defaults?.amount_dollars ?? ""}
          />
        </FormField>
      </div>

      <FormField
        label="Due date"
        htmlFor="due_date"
        error={state.errors?.due_date}
      >
        <Input
          id="due_date"
          name="due_date"
          type="date"
          defaultValue={v.due_date ?? defaults?.due_date ?? ""}
        />
      </FormField>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href="/app/invoices"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Create invoice" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}

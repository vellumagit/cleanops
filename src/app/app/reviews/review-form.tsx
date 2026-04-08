"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { createReviewAction, type ReviewFormState } from "./actions";

const empty: ReviewFormState = {};

type Option = { id: string; label: string };

export function ReviewForm({
  clients,
  employees,
  bookings,
}: {
  clients: Option[];
  employees: Option[];
  bookings: Option[];
}) {
  const [state, formAction] = useActionState(createReviewAction, empty);
  const v = state.values ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />

      <div className="grid gap-5 sm:grid-cols-2">
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
            defaultValue={v.client_id ?? ""}
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
          label="Employee"
          htmlFor="employee_id"
          error={state.errors?.employee_id}
        >
          <FormSelect
            id="employee_id"
            name="employee_id"
            defaultValue={v.employee_id ?? ""}
          >
            <option value="">No employee tagged</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </FormSelect>
        </FormField>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Booking"
          htmlFor="booking_id"
          error={state.errors?.booking_id}
          hint="Optional — link a completed job"
        >
          <FormSelect
            id="booking_id"
            name="booking_id"
            defaultValue={v.booking_id ?? ""}
          >
            <option value="">No booking</option>
            {bookings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </FormSelect>
        </FormField>

        <FormField
          label="Rating (1–5)"
          htmlFor="rating"
          required
          error={state.errors?.rating}
        >
          <Input
            id="rating"
            name="rating"
            type="number"
            min={1}
            max={5}
            required
            defaultValue={v.rating ?? "5"}
          />
        </FormField>
      </div>

      <FormField label="Comment" htmlFor="comment" error={state.errors?.comment}>
        <Textarea
          id="comment"
          name="comment"
          rows={4}
          defaultValue={v.comment ?? ""}
        />
      </FormField>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href="/app/reviews"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">Add review</SubmitButton>
      </div>
    </form>
  );
}

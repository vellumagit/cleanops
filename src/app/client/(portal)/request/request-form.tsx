"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CalendarPlus, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  submitBookingRequestAction,
  type RequestBookingState,
} from "./actions";

const EMPTY: RequestBookingState = {};

export function RequestForm({
  defaultAddress,
}: {
  /** Pre-fill from the client record so they don't retype their
   *  address every time. They can edit if this request is for a
   *  different location. */
  defaultAddress: string | null;
}) {
  const [state, action] = useActionState<RequestBookingState, FormData>(
    submitBookingRequestAction,
    EMPTY,
  );

  // Success path — show a confirmation card instead of the form. The
  // owner will reach back out; there's nothing for the client to do
  // until they do.
  if (state.ok) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
        <h2 className="mt-3 text-lg font-semibold">Request received</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          We&rsquo;ll reach out soon to confirm details and put it on the
          calendar. No need to do anything else.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Link href="/client" className={buttonVariants({ variant: "outline" })}>
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />

      <FormField
        label="What do you need cleaned?"
        htmlFor="service_type"
        required
        hint="e.g. Standard house clean, move-out, deep clean, office."
      >
        <Input
          id="service_type"
          name="service_type"
          placeholder="Standard house clean"
          required
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Preferred date"
          htmlFor="preferred_date"
          hint="We'll confirm before finalizing."
        >
          <Input id="preferred_date" name="preferred_date" type="date" />
        </FormField>

        <FormField
          label="Preferred time"
          htmlFor="preferred_time_window"
        >
          <FormSelect
            id="preferred_time_window"
            name="preferred_time_window"
            defaultValue="flexible"
          >
            <option value="flexible">Flexible</option>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
          </FormSelect>
        </FormField>
      </div>

      <FormField
        label="Address"
        htmlFor="address"
        hint="Leave blank to use the address we have on file."
      >
        <Input
          id="address"
          name="address"
          defaultValue={defaultAddress ?? ""}
        />
      </FormField>

      <FormField
        label="Anything we should know?"
        htmlFor="notes"
        hint="Pets, access codes, areas to focus on, special requests."
      >
        <Textarea id="notes" name="notes" rows={4} />
      </FormField>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href="/client"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Sending…">
          <CalendarPlus className="h-4 w-4" />
          Send request
        </SubmitButton>
      </div>
    </form>
  );
}

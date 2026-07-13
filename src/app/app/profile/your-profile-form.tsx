"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { updateMyProfileAction, type ProfileFormState } from "./actions";

const empty: ProfileFormState = {};

export function YourProfileForm({
  defaults,
}: {
  defaults: { full_name: string; phone: string };
}) {
  const [state, formAction] = useActionState(updateMyProfileAction, empty);
  const v = state.values ?? {};

  useEffect(() => {
    if (state.values && !state.errors) toast.success("Profile updated");
  }, [state]);

  return (
    <form action={formAction} className="max-w-lg space-y-5">
      <FormError message={state.errors?._form} />

      <FormField
        label="Your name"
        htmlFor="full_name"
        required
        error={state.errors?.full_name}
        hint="How you appear across Sollos — on bookings, the schedule, and to your team. Set this so you're shown as yourself, not your email."
      >
        <Input
          id="full_name"
          name="full_name"
          required
          placeholder="e.g. Svitlana Pavliuk"
          defaultValue={v.full_name ?? defaults.full_name}
        />
      </FormField>

      <FormField label="Phone" htmlFor="phone" error={state.errors?.phone}>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          placeholder="(555) 123-4567"
          defaultValue={v.phone ?? defaults.phone}
        />
      </FormField>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </form>
  );
}

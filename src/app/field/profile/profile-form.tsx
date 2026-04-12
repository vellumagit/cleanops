"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { updateProfileAction, type ProfileFormState } from "./actions";

const empty: ProfileFormState = {};

export function ProfileForm({
  defaults,
}: {
  defaults: { full_name: string; phone: string };
}) {
  const [state, formAction] = useActionState(updateProfileAction, empty);
  const v = state.values ?? {};

  // Surface a success toast when the action returned values without errors.
  useEffect(() => {
    if (state.values && !state.errors) {
      toast.success("Profile updated");
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />

      <FormField
        label="Full name"
        htmlFor="full_name"
        required
        error={state.errors?.full_name}
      >
        <Input
          id="full_name"
          name="full_name"
          required
          className="h-12 text-base"
          defaultValue={v.full_name ?? defaults.full_name}
        />
      </FormField>

      <FormField label="Phone" htmlFor="phone" error={state.errors?.phone}>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          className="h-12 text-base"
          defaultValue={v.phone ?? defaults.phone}
        />
      </FormField>

      <div className="pt-2">
        <SubmitButton pendingLabel="Saving…" className="h-14 w-full text-base font-semibold">
          Save changes
        </SubmitButton>
      </div>
    </form>
  );
}

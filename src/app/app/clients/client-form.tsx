"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  createClientAction,
  updateClientAction,
  type ClientFormState,
} from "./actions";

const empty: ClientFormState = {};

type Defaults = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  preferred_contact?: string;
};

export function ClientForm({
  mode,
  id,
  defaults,
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: Defaults;
}) {
  const action =
    mode === "create"
      ? createClientAction
      : updateClientAction.bind(null, id ?? "");

  const [state, formAction] = useActionState(action, empty);
  const v = { ...defaults, ...state.values } as Defaults;

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />

      <FormField
        label="Name"
        htmlFor="name"
        required
        error={state.errors?.name}
      >
        <Input
          id="name"
          name="name"
          required
          defaultValue={v.name ?? ""}
          autoComplete="off"
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Email" htmlFor="email" error={state.errors?.email}>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={v.email ?? ""}
            autoComplete="off"
          />
        </FormField>

        <FormField label="Phone" htmlFor="phone" error={state.errors?.phone}>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={v.phone ?? ""}
            autoComplete="off"
          />
        </FormField>
      </div>

      <FormField label="Address" htmlFor="address" error={state.errors?.address}>
        <Input
          id="address"
          name="address"
          defaultValue={v.address ?? ""}
          autoComplete="off"
        />
      </FormField>

      <FormField
        label="Preferred contact"
        htmlFor="preferred_contact"
        error={state.errors?.preferred_contact}
      >
        <FormSelect
          id="preferred_contact"
          name="preferred_contact"
          defaultValue={v.preferred_contact ?? "email"}
        >
          <option value="email">Email</option>
          <option value="phone">Phone</option>
          <option value="sms">SMS</option>
        </FormSelect>
      </FormField>

      <FormField label="Notes" htmlFor="notes" error={state.errors?.notes}>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={v.notes ?? ""}
          rows={4}
        />
      </FormField>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href="/app/clients"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Create client" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}

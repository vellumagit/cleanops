"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { NETWORK_CATEGORIES } from "@/lib/validators/network";
import {
  createNetworkContactAction,
  updateNetworkContactAction,
  type NetworkContactFormState,
} from "./actions";

const empty: NetworkContactFormState = {};

type Defaults = {
  name?: string;
  category?: string;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
};

export function NetworkContactForm({
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
      ? createNetworkContactAction
      : updateNetworkContactAction.bind(null, id ?? "");

  const [state, formAction] = useActionState(action, empty);
  const v = { ...defaults, ...state.values } as Defaults;

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />

      <div className="grid gap-5 sm:grid-cols-2">
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

        <FormField
          label="Category"
          htmlFor="category"
          error={state.errors?.category}
        >
          <FormSelect
            id="category"
            name="category"
            defaultValue={v.category ?? "other"}
          >
            {NETWORK_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </FormSelect>
        </FormField>
      </div>

      <FormField
        label="Company"
        htmlFor="company"
        error={state.errors?.company}
      >
        <Input
          id="company"
          name="company"
          defaultValue={v.company ?? ""}
          autoComplete="off"
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Phone"
          htmlFor="phone"
          error={state.errors?.phone}
          hint="Free-form — nothing is texted automatically."
        >
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={v.phone ?? ""}
            autoComplete="off"
          />
        </FormField>

        <FormField label="Email" htmlFor="email" error={state.errors?.email}>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={v.email ?? ""}
            autoComplete="off"
          />
        </FormField>
      </div>

      <FormField
        label="Notes"
        htmlFor="notes"
        error={state.errors?.notes}
        hint="How you know them, what they're good for, referral terms…"
      >
        <Textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={v.notes ?? ""}
        />
      </FormField>

      <div className="flex items-center justify-end gap-2">
        <Link
          href="/app/network"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Add contact" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}

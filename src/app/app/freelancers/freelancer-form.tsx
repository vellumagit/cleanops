"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  createFreelancerContactAction,
  updateFreelancerContactAction,
  type FreelancerContactFormState,
} from "./actions";

const empty: FreelancerContactFormState = {};

type Defaults = {
  full_name?: string;
  phone?: string;
  email?: string | null;
  notes?: string | null;
  active?: boolean;
};

export function FreelancerForm({
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
      ? createFreelancerContactAction
      : updateFreelancerContactAction.bind(null, id ?? "");

  const [state, formAction] = useActionState(action, empty);
  const v = { ...defaults, ...state.values } as Defaults;

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
          defaultValue={v.full_name ?? ""}
          autoComplete="off"
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Phone"
          htmlFor="phone"
          required
          error={state.errors?.phone}
          hint="E.164 format, e.g. +15125550101"
        >
          <Input
            id="phone"
            name="phone"
            type="tel"
            required
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

      <FormField label="Notes" htmlFor="notes" error={state.errors?.notes}>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={v.notes ?? ""}
          rows={3}
          placeholder="Prefers weekends, has own car, certified for biohazard…"
        />
      </FormField>

      <FormField label="Active" htmlFor="active">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            id="active"
            name="active"
            value="true"
            defaultChecked={v.active ?? true}
            className="h-4 w-4 rounded border-input"
          />
          <span className="text-muted-foreground">
            Include this contact when broadcasting new offers
          </span>
        </label>
      </FormField>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href="/app/freelancers"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Add to bench" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { DurationInput } from "@/components/duration-input";
import {
  createPackageAction,
  updatePackageAction,
  type PackageFormState,
} from "./actions";

const empty: PackageFormState = {};

type Defaults = {
  name?: string;
  description?: string | null;
  duration_minutes?: number;
  price_dollars?: string;
  is_active?: boolean;
  included_text?: string;
};

export function PackageForm({
  mode,
  id,
  defaults,
  currency = "CAD",
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: Defaults;
  currency?: "CAD" | "USD";
}) {
  const action =
    mode === "create"
      ? createPackageAction
      : updatePackageAction.bind(null, id ?? "");
  const [state, formAction] = useActionState(action, empty);

  const v = {
    name: state.values?.name ?? defaults?.name ?? "",
    description: state.values?.description ?? defaults?.description ?? "",
    duration_minutes:
      state.values?.duration_minutes ??
      (defaults?.duration_minutes != null
        ? String(defaults.duration_minutes)
        : ""),
    price_cents: state.values?.price_cents ?? defaults?.price_dollars ?? "",
    included: state.values?.included ?? defaults?.included_text ?? "",
  };
  const isActiveDefault = defaults?.is_active ?? true;

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />

      <FormField label="Name" htmlFor="name" required error={state.errors?.name}>
        <Input id="name" name="name" required defaultValue={v.name} />
      </FormField>

      <FormField
        label="Description"
        htmlFor="description"
        error={state.errors?.description}
      >
        <Textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={v.description ?? ""}
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Duration"
          htmlFor="duration_minutes"
          required
          error={state.errors?.duration_minutes}
        >
          <DurationInput
            name="duration_minutes"
            defaultMinutes={Number(v.duration_minutes) || 0}
            required
          />
        </FormField>

        <FormField
          label={`Price (${currency})`}
          htmlFor="price_cents"
          required
          error={state.errors?.price_cents}
          hint="Enter dollars, e.g. 149.00"
        >
          <Input
            id="price_cents"
            name="price_cents"
            inputMode="decimal"
            required
            defaultValue={v.price_cents}
          />
        </FormField>
      </div>

      <FormField
        label="What's included"
        htmlFor="included"
        error={state.errors?.included}
        hint="One item per line (or comma-separated)"
      >
        <Textarea
          id="included"
          name="included"
          rows={4}
          defaultValue={v.included}
          placeholder={"Kitchen deep clean\nBathrooms\nVacuum & mop"}
        />
      </FormField>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={isActiveDefault}
          className="h-4 w-4 rounded border-input"
        />
        Active and visible to your team
      </label>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href="/app/packages"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Create package" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}

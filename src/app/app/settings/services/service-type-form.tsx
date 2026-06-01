"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import {
  createServiceTypeAction,
  updateServiceTypeAction,
  type ServiceTypeFormState,
} from "./actions";

const empty: ServiceTypeFormState = {};

export type ServiceFormDefaults = {
  category: string;
  name: string;
  description: string;
  default_duration_minutes: string;
  default_price_cents: string; // dollar string for the input
  color: string;
  sort_order: string;
  is_active: boolean;
};

const DEFAULT_NEW: ServiceFormDefaults = {
  category: "other",
  name: "",
  description: "",
  default_duration_minutes: "120",
  default_price_cents: "",
  color: "",
  sort_order: "100",
  is_active: true,
};

/**
 * Shared create/edit form for one service_type row. The parent panel
 * decides whether to render this in "new row" mode or as an
 * expanded edit of an existing row.
 */
export function ServiceTypeForm({
  mode,
  id,
  defaults = DEFAULT_NEW,
  currency,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: ServiceFormDefaults;
  currency: "CAD" | "USD";
  onCancel: () => void;
  onSaved: () => void;
}) {
  const boundAction =
    mode === "edit" && id
      ? updateServiceTypeAction.bind(null, id)
      : createServiceTypeAction;
  const [state, formAction] = useActionState(boundAction, empty);
  const v = state.values ?? {};

  // Successful submit is signaled by the action returning `{ ok: true }`.
  // The initial state passed to useActionState is bare `{}` which has
  // `ok: undefined`, so this effect ONLY fires after a real submission.
  // Previously we tried to detect success by "values is empty + no
  // errors", which matched the initial state too and collapsed the
  // form the instant it mounted.
  useEffect(() => {
    if (state.ok) {
      toast.success(mode === "edit" ? "Service saved" : "Service added");
      onSaved();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.errors?._form} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Name"
          htmlFor={`name-${id ?? "new"}`}
          required
          error={state.errors?.name}
          hint="Shown in the booking form and on bookings."
        >
          <Input
            id={`name-${id ?? "new"}`}
            name="name"
            defaultValue={v.name ?? defaults.name}
            placeholder="e.g. Window cleaning"
            maxLength={64}
          />
        </FormField>

        <FormField
          label="Category"
          htmlFor={`category-${id ?? "new"}`}
          required
          error={state.errors?.category}
          hint="Used by reports + auto-categorization. Pick the closest match."
        >
          <FormSelect
            id={`category-${id ?? "new"}`}
            name="category"
            defaultValue={v.category ?? defaults.category}
          >
            <optgroup label="Cleaning">
              <option value="standard">Standard clean</option>
              <option value="deep">Deep clean</option>
              <option value="move_out">Move-out clean</option>
              <option value="recurring">Recurring clean</option>
            </optgroup>
            <optgroup label="Appointments">
              <option value="meeting">Meeting</option>
              <option value="consultation">Consultation</option>
              <option value="walkthrough">Walkthrough</option>
            </optgroup>
            <optgroup label="Other">
              <option value="other">Other</option>
            </optgroup>
          </FormSelect>
        </FormField>
      </div>

      <FormField
        label="Description"
        htmlFor={`description-${id ?? "new"}`}
        error={state.errors?.description}
        hint="Optional — shown as a hint under the name."
      >
        <Input
          id={`description-${id ?? "new"}`}
          name="description"
          defaultValue={v.description ?? defaults.description}
          placeholder="e.g. Includes inside oven, fridge, and cabinets"
          maxLength={280}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField
          label="Default duration (min)"
          htmlFor={`default_duration_minutes-${id ?? "new"}`}
          error={state.errors?.default_duration_minutes}
          hint="Pre-fills the booking form."
        >
          <Input
            id={`default_duration_minutes-${id ?? "new"}`}
            name="default_duration_minutes"
            type="number"
            inputMode="numeric"
            min={0}
            max={1440}
            defaultValue={
              v.default_duration_minutes ?? defaults.default_duration_minutes
            }
            placeholder="120"
          />
        </FormField>

        <FormField
          label={`Default price (${currency})`}
          htmlFor={`default_price_cents-${id ?? "new"}`}
          error={state.errors?.default_price_cents}
          hint="Leave blank if you quote per booking."
        >
          <Input
            id={`default_price_cents-${id ?? "new"}`}
            name="default_price_cents"
            type="text"
            inputMode="decimal"
            defaultValue={v.default_price_cents ?? defaults.default_price_cents}
            placeholder="0.00"
          />
        </FormField>

        <FormField
          label="Sort order"
          htmlFor={`sort_order-${id ?? "new"}`}
          error={state.errors?.sort_order}
          hint="Lower numbers show first."
        >
          <Input
            id={`sort_order-${id ?? "new"}`}
            name="sort_order"
            type="number"
            inputMode="numeric"
            min={0}
            max={9999}
            defaultValue={v.sort_order ?? defaults.sort_order}
          />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <FormField
          label="Calendar color"
          htmlFor={`color-${id ?? "new"}`}
          error={state.errors?.color}
          hint="Hex code, e.g. #00aaff. Optional."
        >
          <Input
            id={`color-${id ?? "new"}`}
            name="color"
            type="text"
            defaultValue={v.color ?? defaults.color}
            placeholder="#00aaff"
            maxLength={7}
          />
        </FormField>

        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={
              v.is_active === "on"
                ? true
                : v.is_active === ""
                  ? defaults.is_active
                  : defaults.is_active
            }
            className="h-4 w-4 rounded border-input"
          />
          <span>Active (shown in the booking form)</span>
        </label>
      </div>

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <SubmitButton>
          {mode === "edit" ? "Save changes" : "Add service"}
        </SubmitButton>
      </div>
    </form>
  );
}

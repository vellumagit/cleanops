"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  createInventoryAction,
  updateInventoryAction,
  type InventoryFormState,
} from "./actions";

const empty: InventoryFormState = {};

type Defaults = {
  name?: string;
  category?: string;
  quantity?: string;
  reorder_threshold?: string;
  assigned_to?: string | null;
  notes?: string | null;
};

export function InventoryForm({
  mode,
  id,
  defaults,
  members,
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: Defaults;
  members: { id: string; label: string }[];
}) {
  const action =
    mode === "create"
      ? createInventoryAction
      : updateInventoryAction.bind(null, id ?? "");
  const [state, formAction] = useActionState(action, empty);
  const v = state.values ?? {};

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
          defaultValue={v.name ?? defaults?.name ?? ""}
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Category"
          htmlFor="category"
          required
          error={state.errors?.category}
        >
          <FormSelect
            id="category"
            name="category"
            defaultValue={v.category ?? defaults?.category ?? "consumable"}
          >
            <option value="consumable">Consumable</option>
            <option value="chemical">Chemical</option>
            <option value="equipment">Equipment</option>
          </FormSelect>
        </FormField>

        <FormField
          label="Assigned to"
          htmlFor="assigned_to"
          error={state.errors?.assigned_to}
          hint="Optional — assign to a specific employee"
        >
          <FormSelect
            id="assigned_to"
            name="assigned_to"
            defaultValue={v.assigned_to ?? defaults?.assigned_to ?? ""}
          >
            <option value="">— Unassigned —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </FormSelect>
        </FormField>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Quantity"
          htmlFor="quantity"
          required
          error={state.errors?.quantity}
        >
          <Input
            id="quantity"
            name="quantity"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={v.quantity ?? defaults?.quantity ?? "0"}
          />
        </FormField>

        <FormField
          label="Reorder threshold"
          htmlFor="reorder_threshold"
          required
          error={state.errors?.reorder_threshold}
          hint="Flag low stock at or below this level"
        >
          <Input
            id="reorder_threshold"
            name="reorder_threshold"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={
              v.reorder_threshold ?? defaults?.reorder_threshold ?? "0"
            }
          />
        </FormField>
      </div>

      <FormField label="Notes" htmlFor="notes" error={state.errors?.notes}>
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={v.notes ?? defaults?.notes ?? ""}
        />
      </FormField>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href="/app/inventory"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Add item" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}

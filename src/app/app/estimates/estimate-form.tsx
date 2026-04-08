"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  createEstimateAction,
  updateEstimateAction,
  type EstimateFormState,
} from "./actions";

const empty: EstimateFormState = {};

type Defaults = {
  client_id?: string;
  service_description?: string | null;
  notes?: string | null;
  status?: string;
  total_dollars?: string;
};

export function EstimateForm({
  mode,
  id,
  defaults,
  clients,
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: Defaults;
  clients: { id: string; label: string }[];
}) {
  const action =
    mode === "create"
      ? createEstimateAction
      : updateEstimateAction.bind(null, id ?? "");
  const [state, formAction] = useActionState(action, empty);
  const v = state.values ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />

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
          defaultValue={v.client_id ?? defaults?.client_id ?? ""}
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
        label="Service description"
        htmlFor="service_description"
        error={state.errors?.service_description}
        hint="Short summary of what's being quoted"
      >
        <Textarea
          id="service_description"
          name="service_description"
          rows={3}
          defaultValue={
            v.service_description ?? defaults?.service_description ?? ""
          }
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Status"
          htmlFor="status"
          required
          error={state.errors?.status}
          hint="Sent / decided dates auto-stamp on transition"
        >
          <FormSelect
            id="status"
            name="status"
            defaultValue={v.status ?? defaults?.status ?? "draft"}
          >
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="approved">Approved</option>
            <option value="declined">Declined</option>
          </FormSelect>
        </FormField>

        <FormField
          label="Total (USD)"
          htmlFor="total_cents"
          required
          error={state.errors?.total_cents}
        >
          <Input
            id="total_cents"
            name="total_cents"
            inputMode="decimal"
            required
            defaultValue={v.total_cents ?? defaults?.total_dollars ?? ""}
          />
        </FormField>
      </div>

      <FormField label="Notes" htmlFor="notes" error={state.errors?.notes}>
        <Textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={v.notes ?? defaults?.notes ?? ""}
        />
      </FormField>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href="/app/estimates"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Create estimate" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}

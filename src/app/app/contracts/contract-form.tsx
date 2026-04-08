"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  createContractAction,
  updateContractAction,
  type ContractFormState,
} from "./actions";

const empty: ContractFormState = {};

type Defaults = {
  client_id?: string;
  estimate_id?: string | null;
  service_type?: string;
  start_date?: string;
  end_date?: string | null;
  agreed_price_dollars?: string;
  payment_terms?: string | null;
  status?: string;
};

export function ContractForm({
  mode,
  id,
  defaults,
  clients,
  estimates,
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: Defaults;
  clients: { id: string; label: string }[];
  estimates: { id: string; label: string }[];
}) {
  const action =
    mode === "create"
      ? createContractAction
      : updateContractAction.bind(null, id ?? "");
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
        label="Linked estimate"
        htmlFor="estimate_id"
        error={state.errors?.estimate_id}
        hint="Optional — link the estimate this contract was generated from"
      >
        <FormSelect
          id="estimate_id"
          name="estimate_id"
          defaultValue={v.estimate_id ?? defaults?.estimate_id ?? ""}
        >
          <option value="">— None —</option>
          {estimates.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </FormSelect>
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Service type"
          htmlFor="service_type"
          required
          error={state.errors?.service_type}
        >
          <FormSelect
            id="service_type"
            name="service_type"
            defaultValue={v.service_type ?? defaults?.service_type ?? "standard"}
          >
            <option value="standard">Standard</option>
            <option value="deep">Deep</option>
            <option value="move_out">Move out</option>
            <option value="recurring">Recurring</option>
          </FormSelect>
        </FormField>

        <FormField
          label="Status"
          htmlFor="status"
          required
          error={state.errors?.status}
        >
          <FormSelect
            id="status"
            name="status"
            defaultValue={v.status ?? defaults?.status ?? "active"}
          >
            <option value="active">Active</option>
            <option value="ended">Ended</option>
            <option value="cancelled">Cancelled</option>
          </FormSelect>
        </FormField>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Start date"
          htmlFor="start_date"
          required
          error={state.errors?.start_date}
        >
          <Input
            id="start_date"
            name="start_date"
            type="date"
            required
            defaultValue={v.start_date ?? defaults?.start_date ?? ""}
          />
        </FormField>

        <FormField
          label="End date"
          htmlFor="end_date"
          error={state.errors?.end_date}
          hint="Leave blank for open-ended"
        >
          <Input
            id="end_date"
            name="end_date"
            type="date"
            defaultValue={v.end_date ?? defaults?.end_date ?? ""}
          />
        </FormField>
      </div>

      <FormField
        label="Agreed price (USD)"
        htmlFor="agreed_price_cents"
        required
        error={state.errors?.agreed_price_cents}
      >
        <Input
          id="agreed_price_cents"
          name="agreed_price_cents"
          inputMode="decimal"
          required
          defaultValue={
            v.agreed_price_cents ?? defaults?.agreed_price_dollars ?? ""
          }
        />
      </FormField>

      <FormField
        label="Payment terms"
        htmlFor="payment_terms"
        error={state.errors?.payment_terms}
        hint="e.g. Net 15, monthly invoice on the 1st"
      >
        <Textarea
          id="payment_terms"
          name="payment_terms"
          rows={3}
          defaultValue={v.payment_terms ?? defaults?.payment_terms ?? ""}
        />
      </FormField>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href="/app/contracts"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Create contract" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}

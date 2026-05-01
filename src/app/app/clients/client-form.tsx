"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { SetupReturnField } from "@/components/setup-return-field";
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
  preferred_cleaner_id?: string | null;
  sms_opted_in?: boolean | null;
  billing_cadence?: string | null;
  billing_type?: string | null;
  flat_rate_cents?: number | null;
  referred_by_client_id?: string | null;
};

export function ClientForm({
  mode,
  id,
  defaults,
  cleaners = [],
  referralClients = [],
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: Defaults;
  /** Active memberships for the "Preferred cleaner" dropdown. Passing
   *  an empty array hides the dropdown — useful for orgs that haven't
   *  added any employees yet (setup-first-client flow). */
  cleaners?: Array<{ id: string; label: string }>;
  /** Existing clients for the "Referred by" dropdown. */
  referralClients?: Array<{ id: string; name: string }>;
}) {
  const action =
    mode === "create"
      ? createClientAction
      : updateClientAction.bind(null, id ?? "");

  const [state, formAction] = useActionState(action, empty);
  const v = { ...defaults, ...state.values } as Defaults;

  return (
    <form action={formAction} className="space-y-5">
      <SetupReturnField />
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

      {/* SMS opt-in — shown only when a phone number is present. Collecting
          explicit consent here satisfies TCPA (US) and CASL (Canada). Only
          check this after explaining to the client that they'll receive
          texts about their bookings. */}
      <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 px-4 py-3">
        <input
          type="checkbox"
          id="sms_opted_in"
          name="sms_opted_in"
          defaultChecked={v.sms_opted_in ?? false}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
        />
        <div className="space-y-0.5">
          <label
            htmlFor="sms_opted_in"
            className="cursor-pointer text-sm font-medium leading-none"
          >
            SMS opt-in
          </label>
          <p className="text-xs text-muted-foreground">
            Client has given explicit consent to receive booking confirmation
            and reminder texts. Required before the platform will send any SMS
            to this client.
          </p>
        </div>
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

      {cleaners.length > 0 && (
        <FormField
          label="Preferred cleaner"
          htmlFor="preferred_cleaner_id"
          error={state.errors?.preferred_cleaner_id}
          hint="Auto-fills the assignee on new bookings for this client. Leave blank to pick per-booking."
        >
          <FormSelect
            id="preferred_cleaner_id"
            name="preferred_cleaner_id"
            defaultValue={v.preferred_cleaner_id ?? ""}
          >
            <option value="">— No preference —</option>
            {cleaners.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </FormSelect>
        </FormField>
      )}

      <FormField label="Notes" htmlFor="notes" error={state.errors?.notes}>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={v.notes ?? ""}
          rows={4}
        />
      </FormField>

      {referralClients.length > 0 && (
        <FormField
          label="Referred by"
          htmlFor="referred_by_client_id"
          error={state.errors?.referred_by_client_id}
          hint="Which existing client sent this person your way? Optional."
        >
          <FormSelect
            id="referred_by_client_id"
            name="referred_by_client_id"
            defaultValue={v.referred_by_client_id ?? ""}
          >
            <option value="">— No referral —</option>
            {referralClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </FormSelect>
        </FormField>
      )}

      {/* ── Billing cadence ───────────────────────────────────────────────── */}
      <div className="rounded-md border border-border bg-muted/20 px-4 py-4 space-y-4">
        <div>
          <p className="text-sm font-medium leading-none">Billing cadence</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Controls when invoices are generated for this client. On-demand
            (default) creates one invoice per completed job. Biweekly and
            monthly generate a single consolidated invoice on the 1st and/or
            15th of the month.
          </p>
        </div>

        <FormField
          label="Invoice frequency"
          htmlFor="billing_cadence"
          error={state.errors?.billing_cadence}
        >
          <FormSelect
            id="billing_cadence"
            name="billing_cadence"
            defaultValue={v.billing_cadence ?? "on_demand"}
          >
            <option value="on_demand">On demand — one invoice per job</option>
            <option value="biweekly">Biweekly — 1st &amp; 15th of month</option>
            <option value="monthly">Monthly — 1st of month</option>
          </FormSelect>
        </FormField>

        <FormField
          label="Line-item style"
          htmlFor="billing_type"
          error={state.errors?.billing_type}
          hint="Itemized lists each completed job. Flat rate charges a fixed amount regardless of how many jobs ran."
        >
          <FormSelect
            id="billing_type"
            name="billing_type"
            defaultValue={v.billing_type ?? "itemized"}
          >
            <option value="itemized">Itemized — line item per booking</option>
            <option value="flat_rate">Flat rate — fixed retainer amount</option>
          </FormSelect>
        </FormField>

        {/* flat_rate_cents — only meaningful when billing_type = flat_rate,
            but we always render it so the value isn't lost on toggle. The
            server ignores it for itemized clients. */}
        <FormField
          label="Flat rate (per period)"
          htmlFor="flat_rate_cents"
          error={state.errors?.flat_rate_cents}
          hint="Enter the amount in dollars (e.g. 250 = $250.00). Leave blank to fall back to summing job totals."
        >
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
              $
            </span>
            <Input
              id="flat_rate_cents"
              name="flat_rate_cents"
              type="number"
              min="0"
              step="1"
              placeholder="0"
              className="pl-7"
              defaultValue={
                v.flat_rate_cents != null
                  ? String(Math.round(Number(v.flat_rate_cents) / 100))
                  : ""
              }
            />
          </div>
        </FormField>
      </div>

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

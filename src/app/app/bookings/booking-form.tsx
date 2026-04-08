"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  createBookingAction,
  updateBookingAction,
  type BookingFormState,
} from "./actions";

const empty: BookingFormState = {};

export type BookingFormDefaults = {
  client_id?: string;
  package_id?: string | null;
  assigned_to?: string | null;
  scheduled_at_local?: string;
  duration_minutes?: number;
  service_type?: string;
  status?: string;
  total_dollars?: string;
  hourly_rate_dollars?: string;
  address?: string | null;
  notes?: string | null;
};

type Option = { id: string; label: string };

export function BookingForm({
  mode,
  id,
  defaults,
  clients,
  packages,
  employees,
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: BookingFormDefaults;
  clients: Option[];
  packages: Option[];
  employees: Option[];
}) {
  const action =
    mode === "create"
      ? createBookingAction
      : updateBookingAction.bind(null, id ?? "");
  const [state, formAction] = useActionState(action, empty);
  const v = state.values ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />

      <div className="grid gap-5 sm:grid-cols-2">
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
          label="Package"
          htmlFor="package_id"
          error={state.errors?.package_id}
        >
          <FormSelect
            id="package_id"
            name="package_id"
            defaultValue={v.package_id ?? defaults?.package_id ?? ""}
          >
            <option value="">No package</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </FormSelect>
        </FormField>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Scheduled at"
          htmlFor="scheduled_at"
          required
          error={state.errors?.scheduled_at}
        >
          <Input
            id="scheduled_at"
            name="scheduled_at"
            type="datetime-local"
            required
            defaultValue={
              v.scheduled_at ?? defaults?.scheduled_at_local ?? ""
            }
          />
        </FormField>

        <FormField
          label="Duration (minutes)"
          htmlFor="duration_minutes"
          required
          error={state.errors?.duration_minutes}
        >
          <Input
            id="duration_minutes"
            name="duration_minutes"
            type="number"
            min={1}
            max={1440}
            required
            defaultValue={
              v.duration_minutes ??
              (defaults?.duration_minutes != null
                ? String(defaults.duration_minutes)
                : "")
            }
          />
        </FormField>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
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
            <option value="deep">Deep clean</option>
            <option value="move_out">Move-out</option>
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
            defaultValue={v.status ?? defaults?.status ?? "pending"}
          >
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="en_route">En route</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </FormSelect>
        </FormField>

        <FormField
          label="Assigned to"
          htmlFor="assigned_to"
          error={state.errors?.assigned_to}
        >
          <FormSelect
            id="assigned_to"
            name="assigned_to"
            defaultValue={v.assigned_to ?? defaults?.assigned_to ?? ""}
          >
            <option value="">Unassigned</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </FormSelect>
        </FormField>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Total (USD)"
          htmlFor="total_cents"
          required
          error={state.errors?.total_cents}
          hint="What the client will be billed"
        >
          <Input
            id="total_cents"
            name="total_cents"
            inputMode="decimal"
            required
            defaultValue={v.total_cents ?? defaults?.total_dollars ?? ""}
          />
        </FormField>

        <FormField
          label="Hourly rate (USD)"
          htmlFor="hourly_rate_cents"
          error={state.errors?.hourly_rate_cents}
          hint="Optional — for time-and-materials jobs"
        >
          <Input
            id="hourly_rate_cents"
            name="hourly_rate_cents"
            inputMode="decimal"
            defaultValue={
              v.hourly_rate_cents ?? defaults?.hourly_rate_dollars ?? ""
            }
          />
        </FormField>
      </div>

      <FormField label="Address" htmlFor="address" error={state.errors?.address}>
        <Input
          id="address"
          name="address"
          defaultValue={v.address ?? defaults?.address ?? ""}
        />
      </FormField>

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
          href="/app/bookings"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Create booking" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}

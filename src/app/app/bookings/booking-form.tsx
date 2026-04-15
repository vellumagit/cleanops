"use client";

import { useState, useActionState } from "react";
import Link from "next/link";
import { Repeat, CalendarPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { DurationInput } from "@/components/duration-input";
import {
  createBookingAction,
  createRecurringBookingAction,
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
  series_id?: string | null;
};

type Option = { id: string; label: string };

const DAY_LABELS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

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
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState("weekly");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [monthlyNth, setMonthlyNth] = useState<string>("2");
  const [monthlyDow, setMonthlyDow] = useState<string>("2");

  const defaultMinutes = defaults?.duration_minutes ?? 0;

  // Single-booking action
  const singleAction =
    mode === "create"
      ? createBookingAction
      : updateBookingAction.bind(null, id ?? "");
  const [singleState, singleFormAction] = useActionState(singleAction, empty);

  // Recurring action (only for create mode)
  const [recurringState, recurringFormAction] = useActionState(
    createRecurringBookingAction,
    empty,
  );

  const state = isRecurring ? recurringState : singleState;
  const formAction = isRecurring ? recurringFormAction : singleFormAction;
  const v = state.values ?? {};

  const isEditingSeries = mode === "edit" && !!defaults?.series_id;

  function toggleDay(day: number) {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  }

  /** Shared duration input rendered in both one-time and recurring blocks. */
  const durationInput = (
    <FormField
      label="Duration"
      htmlFor="duration_minutes"
      required
      error={state.errors?.duration_minutes}
    >
      <DurationInput
        name="duration_minutes"
        defaultMinutes={defaultMinutes}
        required
      />
    </FormField>
  );

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />

      {/* Recurring toggle — only on create */}
      {mode === "create" && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <button
            type="button"
            onClick={() => setIsRecurring(false)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              !isRecurring
                ? "bg-background text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            One-time
          </button>
          <button
            type="button"
            onClick={() => setIsRecurring(true)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              isRecurring
                ? "bg-background text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Repeat className="h-3.5 w-3.5" />
            Recurring
          </button>
        </div>
      )}

      {/* Series indicator on edit */}
      {isEditingSeries && (
        <div className="flex items-center gap-2 rounded-md bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
          <Repeat className="h-3.5 w-3.5 shrink-0" />
          This booking is part of a recurring schedule. Editing it only changes this single occurrence.
        </div>
      )}

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

      {/* Recurrence settings — only when recurring + create */}
      {isRecurring && mode === "create" && (
        <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Repeat className="h-4 w-4" />
            Recurrence schedule
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Frequency"
              htmlFor="recurrence_pattern"
              required
            >
              <FormSelect
                id="recurrence_pattern"
                name="recurrence_pattern"
                defaultValue={recurrencePattern}
                onChange={(e) => setRecurrencePattern(e.target.value)}
              >
                <option value="weekly">Weekly</option>
                <option value="bi_weekly">Every 2 weeks</option>
                <option value="tri_weekly">Every 3 weeks</option>
                <option value="monthly">Monthly (same date)</option>
                <option value="monthly_nth">Monthly (Nth weekday)</option>
                <option value="custom_weekly">Custom weekly</option>
              </FormSelect>
            </FormField>

            <FormField
              label="Time"
              htmlFor="start_time"
              required
            >
              <Input
                id="start_time"
                name="start_time"
                type="time"
                required
                defaultValue={v.start_time ?? "09:00"}
              />
            </FormField>
          </div>

          {/* Monthly-Nth picker */}
          {recurrencePattern === "monthly_nth" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Which occurrence" htmlFor="monthly_nth" required>
                <FormSelect
                  id="monthly_nth"
                  name="monthly_nth"
                  value={monthlyNth}
                  onChange={(e) => setMonthlyNth(e.target.value)}
                >
                  <option value="1">1st</option>
                  <option value="2">2nd</option>
                  <option value="3">3rd</option>
                  <option value="4">4th</option>
                  <option value="5">Last</option>
                </FormSelect>
              </FormField>
              <FormField label="Weekday" htmlFor="monthly_dow" required>
                <FormSelect
                  id="monthly_dow"
                  name="monthly_dow"
                  value={monthlyDow}
                  onChange={(e) => setMonthlyDow(e.target.value)}
                >
                  {DAY_LABELS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label === "Sun"
                        ? "Sunday"
                        : d.label === "Mon"
                          ? "Monday"
                          : d.label === "Tue"
                            ? "Tuesday"
                            : d.label === "Wed"
                              ? "Wednesday"
                              : d.label === "Thu"
                                ? "Thursday"
                                : d.label === "Fri"
                                  ? "Friday"
                                  : "Saturday"}
                    </option>
                  ))}
                </FormSelect>
              </FormField>
            </div>
          )}

          {/* Custom days picker */}
          {recurrencePattern === "custom_weekly" && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Days of the week <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {DAY_LABELS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors border ${
                      selectedDays.includes(day.value)
                        ? "bg-foreground text-background border-foreground"
                        : "bg-background text-muted-foreground border-border hover:border-foreground/50"
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              <input
                type="hidden"
                name="custom_days"
                value={selectedDays.join(",")}
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Start date"
              htmlFor="starts_at"
              required
            >
              <Input
                id="starts_at"
                name="starts_at"
                type="date"
                required
                defaultValue={v.starts_at ?? ""}
              />
            </FormField>

            <FormField
              label="End date"
              htmlFor="ends_at"
              hint="Leave blank for ongoing"
            >
              <Input
                id="ends_at"
                name="ends_at"
                type="date"
                defaultValue={v.ends_at ?? ""}
              />
            </FormField>
          </div>

          <FormField
            label="Generate ahead"
            htmlFor="generate_ahead"
            hint="How many future bookings to create at once"
          >
            <FormSelect
              id="generate_ahead"
              name="generate_ahead"
              defaultValue={v.generate_ahead ?? "8"}
            >
              <option value="4">4 bookings</option>
              <option value="8">8 bookings</option>
              <option value="12">12 bookings</option>
              <option value="16">16 bookings</option>
              <option value="26">26 bookings (~6 months weekly)</option>
              <option value="52">52 bookings (~1 year weekly)</option>
            </FormSelect>
          </FormField>
        </div>
      )}

      {/* Schedule — only for one-time bookings */}
      {!isRecurring && (
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

          {durationInput}
        </div>
      )}

      {/* Duration — for recurring (time is in recurrence section) */}
      {isRecurring && durationInput}

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
            defaultValue={
              v.service_type ??
              defaults?.service_type ??
              (isRecurring ? "recurring" : "standard")
            }
          >
            <option value="standard">Standard</option>
            <option value="deep">Deep clean</option>
            <option value="move_out">Move-out</option>
            <option value="recurring">Recurring</option>
          </FormSelect>
        </FormField>

        {!isRecurring && (
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
        )}

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
          hint={isRecurring ? "Per visit" : "What the client will be billed"}
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
        <SubmitButton pendingLabel={isRecurring ? "Creating…" : "Saving…"}>
          {mode === "create"
            ? isRecurring
              ? "Create recurring booking"
              : "Create booking"
            : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}

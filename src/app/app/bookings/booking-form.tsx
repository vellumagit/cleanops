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
import { SetupReturnField } from "@/components/setup-return-field";
import { cn } from "@/lib/utils";
import { RECURRENCE_OPTIONS } from "@/lib/recurrence";
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
  /** Additional crew members on this booking (excludes the primary).
   *  Used to seed the multi-select when editing. */
  additional_assignees?: string[];
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

/** Client option carries the fields we auto-fill into the form. */
export type ClientOption = Option & {
  address: string | null;
  notes: string | null;
  /** Pre-assigned cleaner on this client. When set and the primary
   *  assignee is still empty on this form, picking this client will
   *  auto-fill the assignee dropdown — saves a click for clients who
   *  always want the same cleaner. */
  preferred_cleaner_id: string | null;
};

/** Package option carries price + duration so selecting a package can
 *  pre-fill the total + duration. */
export type PackageOption = Option & {
  price_cents: number;
  duration_minutes: number;
};

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
  currency = "CAD",
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: BookingFormDefaults;
  clients: ClientOption[];
  packages: PackageOption[];
  employees: Option[];
  currency?: "CAD" | "USD";
}) {
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState("weekly");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [monthlyNth, setMonthlyNth] = useState<string>("2");
  const [monthlyDow, setMonthlyDow] = useState<string>("2");
  // Track the primary assignee in local state so the "additional crew"
  // checkbox list can hide whoever's already the primary — can't assign
  // the same person twice.
  const [primaryAssignee, setPrimaryAssignee] = useState<string>(
    defaults?.assigned_to ?? "",
  );
  // Default to indefinite. New series are almost always open-ended —
  // cleaning retainers with explicit end dates are the exception.
  const [endsIndefinite, setEndsIndefinite] = useState(true);
  // Controlled value for ends_at. Switching from uncontrolled `defaultValue`
  // avoids a subtle React bug where toggling the `disabled` prop on a date
  // input can leave the DOM value out of sync with what actually gets submitted.
  const [endsAtValue, setEndsAtValue] = useState("");
  // Additional crew members on this booking (beyond the primary assignee).
  // Submitted as repeated "additional_assignees" fields so FormData.getAll()
  // picks them all up on the server side.
  const [additionalAssignees, setAdditionalAssignees] = useState<string[]>(
    defaults?.additional_assignees ?? [],
  );

  function toggleAdditional(id: string) {
    setAdditionalAssignees((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  }

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

  // Controlled values for the fields that auto-populate from client +
  // package selection. We only pre-fill when the field is empty so we
  // never overwrite something the user already typed. Initializers use
  // `defaults` (not `v`) so that on remount we seed from the edit record;
  // validation-error re-submits preserve whatever was typed via the
  // handlers below.
  const [addressValue, setAddressValue] = useState<string>(
    defaults?.address ?? "",
  );
  const [notesValue, setNotesValue] = useState<string>(
    defaults?.notes ?? "",
  );
  const [totalValue, setTotalValue] = useState<string>(
    defaults?.total_dollars ?? "",
  );
  // DurationInput is uncontrolled internally — to pre-fill after mount
  // we swap its `key` so it remounts with a new defaultMinutes. Only
  // kicked when the user picks a package AND duration is still empty.
  const [durationSeed, setDurationSeed] = useState<number>(defaultMinutes);
  const [durationKey, setDurationKey] = useState<number>(0);

  /**
   * Pre-fill rule: only set the target field if it's currently empty.
   * That way picking a client populates a blank address but never
   * clobbers something the user typed, and switching clients mid-edit
   * won't erase their work.
   */
  function handleClientChange(clientId: string) {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    if (!addressValue && c.address) setAddressValue(c.address);
    if (!notesValue && c.notes) setNotesValue(c.notes);
    // Pre-fill the primary assignee from the client's preferred cleaner
    // when no assignee is chosen yet. Same "only-if-empty" rule as
    // everything else — switching clients never clobbers a user
    // deliberate pick.
    if (!primaryAssignee && c.preferred_cleaner_id) {
      // Belt-and-braces: only auto-pick if the preferred cleaner is
      // actually in the employees list (they may have been
      // deactivated since the client was last edited).
      const exists = employees.some((e) => e.id === c.preferred_cleaner_id);
      if (exists) setPrimaryAssignee(c.preferred_cleaner_id);
    }
  }

  function handlePackageChange(packageId: string) {
    const p = packages.find((x) => x.id === packageId);
    if (!p) return;
    // Package price fills Total when blank.
    if (!totalValue && p.price_cents > 0) {
      setTotalValue((p.price_cents / 100).toFixed(2));
    }
    // Duration only swaps in when DurationInput hasn't been touched
    // yet (durationSeed still matches its original default).
    if (durationSeed === 0 && p.duration_minutes > 0) {
      setDurationSeed(p.duration_minutes);
      setDurationKey((k) => k + 1);
    }
  }

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
        key={durationKey}
        name="duration_minutes"
        defaultMinutes={durationSeed}
        required
      />
    </FormField>
  );

  return (
    <form action={formAction} className="space-y-5">
      <SetupReturnField />
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
            onChange={(e) => handleClientChange(e.target.value)}
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
            onChange={(e) => handlePackageChange(e.target.value)}
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
                {RECURRENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </FormSelect>
              {/* Description of the currently-selected pattern. */}
              <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                {
                  RECURRENCE_OPTIONS.find(
                    (o) => o.value === recurrencePattern,
                  )?.description
                }
              </p>
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

            <FormField label="Ends" htmlFor="ends_at">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={endsIndefinite}
                    onChange={(e) => setEndsIndefinite(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span>Continue indefinitely</span>
                </label>
                <Input
                  id="ends_at"
                  name="ends_at"
                  type="date"
                  value={endsIndefinite ? "" : endsAtValue}
                  onChange={(e) => setEndsAtValue(e.target.value)}
                  disabled={endsIndefinite}
                  required={!endsIndefinite}
                  className={endsIndefinite ? "opacity-50" : ""}
                />
              </div>
            </FormField>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Sollos generates about 2 months of bookings ahead and
            auto-extends each night. There&rsquo;s no cap — the series
            keeps going forever unless you set an end date or pause it.
          </p>

          {/* Hidden: generate_ahead is kept as the cron's batch size,
              but owners don't need to think about it. 8 is the sweet
              spot for ~2 months of weekly. */}
          <input type="hidden" name="generate_ahead" value="8" />
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
          label="Primary assignee"
          htmlFor="assigned_to"
          error={state.errors?.assigned_to}
        >
          <FormSelect
            id="assigned_to"
            name="assigned_to"
            defaultValue={v.assigned_to ?? defaults?.assigned_to ?? ""}
            onChange={(e) => {
              // Track the selected value in state only so the "additional
              // crew" pill list can hide whoever's primary. The DOM value
              // flows to FormData via defaultValue + the native selected
              // attribute — not via React controlled-component binding,
              // which had an edge case where quick select-then-submit
              // could submit with the wrong value.
              setPrimaryAssignee(e.target.value);
              if (e.target.value) {
                setAdditionalAssignees((prev) =>
                  prev.filter((id) => id !== e.target.value),
                );
              }
            }}
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

      {/* Additional crew — checkbox list. Hidden inputs below ensure the
          server action receives each selected id as a separate value. */}
      <FormField label="Additional crew" htmlFor="additional_assignees">
        {employees.filter((e) => e.id !== primaryAssignee).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {employees.length === 0
              ? "No active employees yet."
              : "Everyone on the team is already assigned."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {employees
                .filter((e) => e.id !== primaryAssignee)
                .map((e) => {
                  const checked = additionalAssignees.includes(e.id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => toggleAdditional(e.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        checked
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground",
                      )}
                    >
                      {checked ? "✓ " : ""}
                      {e.label}
                    </button>
                  );
                })}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Pick one primary assignee above. Add additional crew here for
              two-person jobs, deep cleans, or move-outs.
            </p>
            {additionalAssignees.map((id) => (
              <input
                key={id}
                type="hidden"
                name="additional_assignees"
                value={id}
              />
            ))}
          </>
        )}
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label={`Total (${currency})`}
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
            value={totalValue}
            onChange={(e) => setTotalValue(e.target.value)}
          />
        </FormField>

        <FormField
          label={`Hourly rate (${currency})`}
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
          value={addressValue}
          onChange={(e) => setAddressValue(e.target.value)}
        />
      </FormField>

      <FormField label="Notes" htmlFor="notes" error={state.errors?.notes}>
        <Textarea
          id="notes"
          name="notes"
          rows={4}
          value={notesValue}
          onChange={(e) => setNotesValue(e.target.value)}
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

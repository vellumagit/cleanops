"use client";

import { useState, useActionState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Repeat,
  CalendarPlus,
  SplitSquareVertical,
  Plus,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { Tip } from "@/components/tip";
import { SubmitButton } from "@/components/submit-button";
import { DurationInput } from "@/components/duration-input";
import { DayGlanceField } from "./day-glance-field";
import { ReturnToField } from "@/components/return-to-field";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { cn } from "@/lib/utils";
import { RECURRENCE_OPTIONS } from "@/lib/recurrence";
import { EARLY_START_GRACE_MINUTES } from "@/lib/booking-status";
import {
  createBookingAction,
  createRecurringBookingAction,
  updateBookingAction,
  type BookingFormState,
} from "./actions";

const empty: BookingFormState = {};

export type BookingFormDefaults = {
  client_id?: string;
  assigned_to?: string | null;
  /** Additional crew members on this booking (excludes the primary).
   *  Used to seed the multi-select when editing. */
  additional_assignees?: string[];
  scheduled_at_local?: string;
  /** Raw UTC ISO string from the DB — used for "this and future" propagation. */
  scheduled_at_utc?: string;
  duration_minutes?: number;
  /** Legacy enum value (e.g. "standard"). Kept for back-compat — the
   *  form prefers `service_type_id` when present and only falls back
   *  to enum-based defaults when the FK isn't set. */
  service_type?: string;
  /** New FK pointing at the org's service_types row. Source of truth
   *  for the dropdown selection. */
  service_type_id?: string | null;
  status?: string;
  total_dollars?: string;
  address?: string | null;
  property_id?: string | null;
  notes?: string | null;
  /** Portal booking-request id when the form was opened via "Create
   *  booking" on Requests — the create action marks it scheduled. */
  from_request?: string;
  /** Estimate id when opened via "Book this job" on an estimate — the
   *  create action stamps bookings.estimate_id so the link shows. */
  estimate_id?: string;
  series_id?: string | null;
  /** Series schedule fields — passed when editing a recurring booking so the
   *  "Edit recurring schedule" section can be pre-filled. */
  series_pattern?: string;
  /** HH:MM 24-hour time */
  series_start_time?: string;
  /** YYYY-MM-DD anchor date for the new schedule (defaults to current booking's date) */
  series_starts_at?: string;
  series_ends_at?: string | null;
  series_custom_days?: number[];
  series_monthly_nth?: number | null;
  series_monthly_dow?: number | null;
  /** Pre-existing split segments when editing a booking that has splits. */
  splits?: SplitSegment[];
  /** Show each cleaner their share (duration ÷ crew) in the field app. */
  divide_hours_evenly?: boolean;
};

type Option = {
  id: string;
  label: string;
  /** Cleaner has an accommodation / health note on file — surfaces a flag in
   * the crew pickers so the assigner checks the employee file first. */
  hasAccommodations?: boolean;
};

/** A service this org offers — loaded from service_types. The form
 *  uses the row's `id` as the dropdown value but actually submits the
 *  enum `category` as `service_type` so the legacy column stays
 *  populated. Plus a hidden `service_type_id` and `service_type_label`
 *  go along so downstream tables get the FK and the display name. */
export type ServiceOption = {
  id: string;
  label: string;
  category: string;
  description: string | null;
  default_duration_minutes: number | null;
  default_price_cents: number | null;
};

type SplitSegment = {
  id: string;
  assigned_to: string;
  duration_minutes: number;
};

/**
 * Render a cumulative-offset duration as a clean "Xh", "Ym", or "Xh Ym"
 * label. Used in the "(starts at +...)" label under each split segment.
 *
 * Previously this was inlined as `${Math.floor(n/60)}h${n%60}m` which
 * produced ugly outputs like "0h30m" (when sub-hour) or "1h30m" (no
 * space). Centralized here so the format is consistent everywhere.
 */
function formatOffsetLabel(totalMinutes: number): string {
  if (totalMinutes <= 0) return "0m";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/** Order categories the same way they were grouped in the old hardcoded
 *  dropdown (Cleaning → Appointments → Other) so the move to a dynamic
 *  list doesn't feel like a reshuffle. */
const CATEGORY_ORDER: Record<string, number> = {
  standard: 0,
  deep: 1,
  move_out: 2,
  recurring: 3,
  meeting: 10,
  consultation: 11,
  walkthrough: 12,
  other: 99,
};

const CATEGORY_GROUP: Record<string, string> = {
  standard: "Cleaning",
  deep: "Cleaning",
  move_out: "Cleaning",
  recurring: "Cleaning",
  meeting: "Appointments",
  consultation: "Appointments",
  walkthrough: "Appointments",
  other: "Other",
};

function prettyCategory(group: string): string {
  return group;
}

function groupServicesByCategory(
  services: ServiceOption[],
): Array<[string, ServiceOption[]]> {
  const groups = new Map<string, ServiceOption[]>();
  for (const s of services) {
    const group = CATEGORY_GROUP[s.category] ?? "Other";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(s);
  }
  const groupOrder = ["Cleaning", "Appointments", "Other"];
  return groupOrder
    .filter((g) => groups.has(g))
    .map(
      (g) =>
        [g, groups.get(g)!.sort(byCategoryThenSortOrder)] as [
          string,
          ServiceOption[],
        ],
    );
}

function byCategoryThenSortOrder(a: ServiceOption, b: ServiceOption): number {
  const ca = CATEGORY_ORDER[a.category] ?? 50;
  const cb = CATEGORY_ORDER[b.category] ?? 50;
  if (ca !== cb) return ca - cb;
  return 0;
}

/** Client option carries the fields we auto-fill into the form. */
export type PropertyOption = {
  id: string;
  label: string;
  address: string | null;
};

export type ClientOption = Option & {
  address: string | null;
  notes: string | null;
  /**
   * The places this client has. Empty or single for almost everyone, several
   * for an Airbnb host or a landlord. Shipped with the client list rather
   * than fetched on selection so picking a client cannot leave the property
   * dropdown briefly empty and tempt someone into typing the address again —
   * which is the habit this whole feature exists to end.
   */
  properties?: PropertyOption[];
  /** Pre-assigned cleaner on this client. When set and the primary
   *  assignee is still empty on this form, picking this client will
   *  auto-fill the assignee dropdown — saves a click for clients who
   *  always want the same cleaner. */
  preferred_cleaner_id: string | null;
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
  employees,
  services,
  currency = "CAD",
  divideHoursDefault = false,
  onSuccess,
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: BookingFormDefaults;
  clients: ClientOption[];
  employees: Option[];
  services: ServiceOption[];
  currency?: "CAD" | "USD";
  /** Org-level "divide team-job hours" automation is ON — the per-booking
   *  toggle is then redundant (every team job divides), so we show a note. */
  divideHoursDefault?: boolean;
  /** When provided, the form runs in "embedded" mode: submitting signals
   *  done via state instead of a page redirect, then calls onSuccess so
   *  the parent can close the Sheet. */
  onSuccess?: () => void;
}) {
  // Cancel should land where Save lands — both read the same ?_return, so
  // abandoning an edit opened from the scheduler returns to that week rather
  // than dumping you on the bookings list.
  const returnTo = useSearchParams().get("_return");
  const cancelHref = returnTo || "/app/bookings";

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

  // ── Series schedule state (edit mode only) ──────────────────────────────
  // These are shown when editing a recurring booking with "this_and_future"
  // scope so the owner can change the recurrence rule, not just field values.
  const [seriesPattern, setSeriesPattern] = useState(
    defaults?.series_pattern ?? "weekly",
  );
  const [seriesStartTime, setSeriesStartTime] = useState(
    defaults?.series_start_time ?? "09:00",
  );
  const [seriesStartsAt, setSeriesStartsAt] = useState(
    defaults?.series_starts_at ?? "",
  );
  const [seriesEndsIndefinite, setSeriesEndsIndefinite] = useState(
    !defaults?.series_ends_at,
  );
  const [seriesEndsAtValue, setSeriesEndsAtValue] = useState(
    defaults?.series_ends_at ?? "",
  );
  const [seriesCustomDays, setSeriesCustomDays] = useState<number[]>(
    defaults?.series_custom_days ?? [],
  );
  const [seriesMonthlyNth, setSeriesMonthlyNth] = useState(
    String(defaults?.series_monthly_nth ?? "2"),
  );
  const [seriesMonthlyDow, setSeriesMonthlyDow] = useState(
    String(defaults?.series_monthly_dow ?? "2"),
  );

  function toggleSeriesDay(day: number) {
    setSeriesCustomDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day].sort(),
    );
  }

  // ── Service selection ─────────────────────────────────────────────────────
  // The dropdown's value is a service_types.id. We pick the initial
  // selection in this priority order:
  //   1. Explicit defaults.service_type_id (edit mode of a booking
  //      that already has the FK)
  //   2. First active service whose category matches the legacy enum
  //      defaults.service_type (edit mode pre-migration, or a booking
  //      whose row was archived)
  //   3. First active service with category "recurring" for recurring
  //      bookings, else first "standard", else just the first row
  function pickInitialServiceId(): string {
    if (services.length === 0) return "";
    if (defaults?.service_type_id) {
      const m = services.find((s) => s.id === defaults.service_type_id);
      if (m) return m.id;
    }
    if (defaults?.service_type) {
      const m = services.find((s) => s.category === defaults.service_type);
      if (m) return m.id;
    }
    const wantedCategory = isRecurring ? "recurring" : "standard";
    const cat = services.find((s) => s.category === wantedCategory);
    return (cat ?? services[0]).id;
  }
  const [serviceTypeId, setServiceTypeId] = useState<string>(
    pickInitialServiceId(),
  );
  const selectedService = services.find((s) => s.id === serviceTypeId);

  // ── Split shifts ──────────────────────────────────────────────────────────
  const [splitEnabled, setSplitEnabled] = useState(
    Boolean(defaults?.splits?.length),
  );
  const [splits, setSplits] = useState<SplitSegment[]>(defaults?.splits ?? []);
  const [divideHours, setDivideHours] = useState<boolean>(
    defaults?.divide_hours_evenly ?? false,
  );

  function addSplit() {
    setSplits((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        assigned_to: "",
        duration_minutes: 120,
      },
    ]);
  }

  function removeSplit(id: string) {
    setSplits((prev) => prev.filter((s) => s.id !== id));
  }

  function updateSplit(id: string, patch: Partial<SplitSegment>) {
    setSplits((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
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

  // Mirrored into state so the Status options can react to it. See
  // `statusOptions` below — a job far enough out simply isn't offered
  // "Completed", rather than being offered it and rejected on save.
  const [scheduledAtLocal, setScheduledAtLocal] = useState(
    v.scheduled_at ?? defaults?.scheduled_at_local ?? "",
  );

  const currentStatus = v.status ?? defaults?.status ?? "confirmed";

  /*
   * Which statuses this job can hold, given when it happens.
   *
   * This control is a bare native <select>, and on Windows Chrome a focused
   * closed select changes value on the mouse wheel — inside a sheet you have
   * to wheel-scroll to reach the submit button. Simplifying the status list
   * (1081c28) moved "Completed" from four notches below the default to two,
   * and made native typeahead "c" walk from Confirmed to Completed instead of
   * being a no-op. That is how booking a766d848 was created two days early
   * already marked complete, which hid the shift from Jim entirely.
   *
   * The server rejects it now, but a rejection is an error message someone has
   * to read. An option that isn't in the DOM can't be reached by wheel, arrow
   * key or typeahead at all. So the rule from src/lib/booking-status.ts is
   * mirrored here: past and imminent jobs keep the full list — back-filling
   * history is legitimate and common — and jobs further out than the
   * early-start grace drop the two statuses they cannot legitimately hold.
   *
   * The booking's own current status always stays, so editing a completed job
   * never silently rewrites it; moving that job into the future is the server
   * guard's business, and it explains itself.
   */
  const scheduledMs = new Date(scheduledAtLocal).getTime();
  const beyondGrace =
    Number.isFinite(scheduledMs) &&
    scheduledMs > Date.now() + EARLY_START_GRACE_MINUTES * 60_000;
  const statusOptions = [
    { value: "pending", label: "Pending" },
    { value: "confirmed", label: "Confirmed" },
    { value: "in_progress", label: "In progress" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ].filter(
    (o) =>
      !beyondGrace ||
      o.value === currentStatus ||
      (o.value !== "completed" && o.value !== "in_progress"),
  );

  // When embedded (onSuccess is set), watch for the server action returning
  // _done=1 (meaning it skipped redirect) and call onSuccess to close the Sheet.
  useEffect(() => {
    if (onSuccess && (state.values as Record<string, unknown>)?._done === "1") {
      onSuccess();
    }
  }, [state.values, onSuccess]);

  // Controlled values for the fields that auto-populate from client +
  // service selection. We only pre-fill when the field is empty so we
  // never overwrite something the user already typed. Initializers use
  // `defaults` (not `v`) so that on remount we seed from the edit record;
  // validation-error re-submits preserve whatever was typed via the
  // handlers below.
  const [addressValue, setAddressValue] = useState<string>(
    defaults?.address ?? "",
  );
  const [notesValue, setNotesValue] = useState<string>(defaults?.notes ?? "");
  const [propertyId, setPropertyId] = useState<string>(() => {
    if (defaults?.property_id) return defaults.property_id;
    // A client with exactly one property has nothing to choose — select it,
    // the same rule handleClientChange applies. Doing it here too means a
    // pre-filled edit form (where no client-change event ever fires) heals
    // a legacy booking that predates properties on its next ordinary save.
    const preset = clients.find((c) => c.id === defaults?.client_id);
    const props = preset?.properties ?? [];
    return props.length === 1 ? props[0].id : "";
  });
  // The client select stays uncontrolled (it has a defaultValue and a lot of
  // prefill behaviour hanging off it); this mirrors the choice so the property
  // picker knows whose properties to offer.
  const [selectedClientId, setSelectedClientId] = useState<string>(
    defaults?.client_id ?? "",
  );
  const selectedClientProperties =
    clients.find((c) => c.id === selectedClientId)?.properties ?? [];
  const [totalValue, setTotalValue] = useState<string>(
    defaults?.total_dollars ?? "",
  );
  // DurationInput is uncontrolled internally — to pre-fill after mount
  // we swap its `key` so it remounts with a new defaultMinutes. Only
  // kicked when a service prefill lands AND duration is still empty.
  const [durationSeed, setDurationSeed] = useState<number>(defaultMinutes);
  const [durationKey, setDurationKey] = useState<number>(0);
  // Tracks whether the user has typed in the duration input themselves.
  // DurationInput is uncontrolled so the parent doesn't see its value;
  // we set this ref via the onUserInput callback. The service
  // prefill path gates on this so they don't silently overwrite what
  // the user just typed. Reset to false when we deliberately remount
  // DurationInput via durationKey.
  const durationTouched = useRef<boolean>(false);

  /**
   * Pre-fill rule: only set the target field if it's currently empty.
   * That way picking a client populates a blank address but never
   * clobbers something the user typed, and switching clients mid-edit
   * won't erase their work.
   */
  function handleClientChange(clientId: string) {
    setSelectedClientId(clientId);
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    // One property means there is nothing to choose — select it and fill the
    // address from it. More than one and we deliberately leave the picker
    // empty so somebody has to say WHICH, rather than silently booking the
    // first unit in the list.
    const props = c.properties ?? [];
    if (props.length === 1) {
      setPropertyId(props[0].id);
      if (!addressValue && props[0].address) setAddressValue(props[0].address);
    } else {
      setPropertyId("");
    }
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

  /**
   * Service selection pre-fill — only fills blank fields, never clobbers
   * something the user typed. (Packages used to share this job with a
   * whichever-was-touched-last rule; retired 2026-08-29, services are the
   * one source of defaults now.)
   *
   * Called from the service dropdown's onChange — not on initial mount
   * — so editing an existing booking never triggers an unexpected
   * prefill.
   */
  function handleServiceChange(serviceId: string) {
    const s = services.find((x) => x.id === serviceId);
    if (!s) return;
    if (
      !totalValue &&
      s.default_price_cents !== null &&
      s.default_price_cents > 0
    ) {
      setTotalValue((s.default_price_cents / 100).toFixed(2));
    }
    if (
      !durationTouched.current &&
      durationSeed === 0 &&
      s.default_duration_minutes !== null &&
      s.default_duration_minutes > 0
    ) {
      setDurationSeed(s.default_duration_minutes);
      setDurationKey((k) => k + 1);
    }
  }

  // Fire the service prefill once on mount in CREATE mode. The form
  // already pre-selects a service via pickInitialServiceId() but its
  // defaults (duration + price) don't propagate to Total / Duration
  // until the user re-picks the same option. This effect closes that
  // gap. Edit mode is intentionally skipped — defaults already populate
  // the fields and a programmatic prefill would clobber them.
  useEffect(() => {
    if (mode === "create" && serviceTypeId) {
      handleServiceChange(serviceTypeId);
    }
    // Intentionally fire once on mount only. handleServiceChange has
    // its own only-if-blank gates so re-running it isn't dangerous,
    // but we want one-shot semantics here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isEditingSeries = mode === "edit" && !!defaults?.series_id;

  const [updateScope, setUpdateScope] = useState<
    "this_only" | "this_and_future"
  >("this_only");

  // ── Notify-the-client interception ───────────────────────────────────
  // A save that would notify the client (email or text, per their channel
  // preference) pauses for one explicit choice.
  const formRef = useRef<HTMLFormElement>(null);
  const notifyInputRef = useRef<HTMLInputElement>(null);
  const notifyDecidedRef = useRef(false);
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);

  const timeChanged =
    mode === "edit" &&
    Boolean(defaults?.scheduled_at_local) &&
    scheduledAtLocal !== defaults?.scheduled_at_local;
  const seriesScheduleChanged =
    isEditingSeries &&
    updateScope === "this_and_future" &&
    (seriesPattern !== (defaults?.series_pattern ?? "weekly") ||
      seriesStartTime !== (defaults?.series_start_time ?? "09:00") ||
      seriesStartsAt !== (defaults?.series_starts_at ?? "") ||
      (seriesEndsIndefinite ? "" : seriesEndsAtValue) !==
        (defaults?.series_ends_at ?? "") ||
      seriesCustomDays.join(",") !==
        (defaults?.series_custom_days ?? []).join(","));
  // Pending bookings never notify (the client hasn't heard about the job
  // at all yet), matching the server's own gate.
  const wouldNotifyClient =
    defaults?.status !== "pending" && (timeChanged || seriesScheduleChanged);

  function saveWithNotifyChoice(choice: "1" | "0") {
    if (notifyInputRef.current) notifyInputRef.current.value = choice;
    notifyDecidedRef.current = true;
    setNotifyDialogOpen(false);
    formRef.current?.requestSubmit();
  }

  // A failed save (validation error) re-arms the question — the next
  // attempt may carry a different time than the one they decided on.
  useEffect(() => {
    if (state.errors) notifyDecidedRef.current = false;
  }, [state.errors]);

  function toggleDay(day: number) {
    setSelectedDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day].sort(),
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
        onUserInput={() => {
          durationTouched.current = true;
        }}
      />
    </FormField>
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-5"
      // The one interception in this form: a save that would NOTIFY the
      // client (time moved, or the recurring schedule rewritten) stops
      // for one question — notify them, or save quietly. Brian's demo
      // taught us why: an unexpected client message mid-save is a trust
      // problem, in both directions.
      onSubmit={(e) => {
        if (mode !== "edit") return;
        if (notifyDecidedRef.current) return;
        if (!wouldNotifyClient) return;
        e.preventDefault();
        setNotifyDialogOpen(true);
      }}
    >
      <input
        ref={notifyInputRef}
        type="hidden"
        name="notify_client"
        defaultValue="1"
      />
      <ReturnToField />
      {/* Signal the server action to return a done-state instead of
          redirecting when we're embedded inside a Sheet / drawer. */}
      {onSuccess && <input type="hidden" name="_source" value="calendar" />}
      {mode === "create" && defaults?.from_request && (
        <input type="hidden" name="from_request" value={defaults.from_request} />
      )}
      {mode === "create" && defaults?.estimate_id && (
        <input type="hidden" name="estimate_id" value={defaults.estimate_id} />
      )}
      <FormError message={state.errors?._form} />

      {/* Hidden scope + series fields for recurring edits */}
      {isEditingSeries && (
        <>
          <input type="hidden" name="update_scope" value={updateScope} />
          <input
            type="hidden"
            name="series_id"
            value={defaults?.series_id ?? ""}
          />
          <input
            type="hidden"
            name="series_scheduled_at"
            value={defaults?.scheduled_at_utc ?? ""}
          />
        </>
      )}

      {/* Recurring series edit banner */}
      {isEditingSeries && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <Repeat className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This is a <strong>recurring booking</strong>. Changes can apply to
            just this occurrence or to all future bookings in the series.
          </span>
        </div>
      )}

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
          This booking is part of a recurring schedule. Editing it only changes
          this single occurrence.
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label={
            <>
              Client <Tip k="select-typeahead" />
            </>
          }
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

      </div>

      {/* Recurrence settings — only when recurring + create */}
      {isRecurring && mode === "create" && (
        <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Repeat className="h-4 w-4" />
            Recurrence schedule
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Frequency" htmlFor="recurrence_pattern" required>
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
                  RECURRENCE_OPTIONS.find((o) => o.value === recurrencePattern)
                    ?.description
                }
              </p>
            </FormField>

            <FormField label="Time" htmlFor="start_time" required>
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
              <FormField
                label="Which occurrence"
                htmlFor="monthly_nth"
                required
              >
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
            <FormField label="Start date" htmlFor="starts_at" required>
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
                {/* Quick preset buttons */}
                {!endsIndefinite && (
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: "1 year", months: 12 },
                      { label: "2 years", months: 24 },
                      { label: "5 years", months: 60 },
                    ].map(({ label, months }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => {
                          const d = new Date();
                          d.setMonth(d.getMonth() + months);
                          setEndsAtValue(d.toISOString().slice(0, 10));
                        }}
                        className="rounded-full border border-input bg-muted px-2.5 py-0.5 text-xs hover:bg-accent"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
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
            Sollos generates about 2 months of bookings ahead and auto-extends
            each night. There&rsquo;s no cap — the series keeps going forever
            unless you set an end date or pause it.
          </p>

          {/* Hidden: generate_ahead is the cron's batch size.
              52 = 1 year of weekly, 2 years of biweekly, 4+ years monthly. */}
          <input type="hidden" name="generate_ahead" value="52" />
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
              value={scheduledAtLocal}
              onChange={(e) => setScheduledAtLocal(e.target.value)}
            />
            {/* Names the weekday and lists what is already on that day —
                a datetime-local on a phone tells you neither. */}
            <DayGlanceField value={scheduledAtLocal} excludeBookingId={id} />
          </FormField>

          {durationInput}
        </div>
      )}

      {/* Duration — for recurring (time is in recurrence section) */}
      {isRecurring && durationInput}

      <div className="grid gap-5 sm:grid-cols-3">
        <FormField
          label="Service"
          htmlFor="service_type_select"
          required
          error={state.errors?.service_type}
          hint={
            services.length === 0 ? (
              <>
                No services configured.{" "}
                <Link
                  href="/app/settings/services"
                  className="underline underline-offset-2"
                >
                  Add one
                </Link>{" "}
                first.
              </>
            ) : undefined
          }
        >
          <FormSelect
            id="service_type_select"
            value={serviceTypeId}
            onChange={(e) => {
              setServiceTypeId(e.target.value);
              handleServiceChange(e.target.value);
            }}
          >
            {groupServicesByCategory(services).map(([category, items]) => (
              <optgroup key={category} label={prettyCategory(category)}>
                {items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </FormSelect>
          {/* Three things flow to the server on submit:
              - service_type        — the enum (still NOT NULL on the table)
              - service_type_id     — the FK to service_types
              - service_type_label  — denormalized display name

              IMMUTABILITY: on edit, we send the ORIGINAL enum that the
              booking was created with, not the current category of the
              selected service. Otherwise re-categorizing a service in
              Settings → Services would silently rewrite the enum on
              every existing booking that used it (next time someone
              saved an unrelated edit), breaking reports and calendar
              coloring for historical jobs. The server actions also
              drop service_type from the UPDATE payload as belt-and-
              braces, but the hidden input matters too for the
              "this and future" + recurring expansion paths that copy
              the form value forward. */}
          <input
            type="hidden"
            name="service_type"
            value={
              mode === "edit"
                ? (defaults?.service_type ??
                  selectedService?.category ??
                  "other")
                : (selectedService?.category ?? "other")
            }
          />
          <input
            type="hidden"
            name="service_type_id"
            value={selectedService?.id ?? ""}
          />
          <input
            type="hidden"
            name="service_type_label"
            value={selectedService?.label ?? ""}
          />
        </FormField>

        {!isRecurring && (
          <FormField
            label="Status"
            htmlFor="status"
            required
            error={state.errors?.status}
            hint={
              currentStatus === "pending"
                ? "Pending = penciled in, not agreed yet. It shows amber everywhere and is never auto-completed or invoiced until you confirm it."
                : undefined
            }
          >
            <FormSelect id="status" name="status" defaultValue={currentStatus}>
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
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
                {e.hasAccommodations ? " ⚠ (note on file)" : ""}
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
                      {e.hasAccommodations && (
                        <AlertTriangle
                          className="ml-1 inline-block h-3 w-3 align-[-1px] text-amber-600 dark:text-amber-400"
                          aria-label="Has accommodations on file"
                        />
                      )}
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

      {/* Divide hours evenly — only meaningful for a team of 2+ working the
          same hours (not a hand-off split). Purely a field-app display: each
          cleaner sees their share (duration ÷ crew). Does not change the
          window, payroll (clock-based), or the client's bill. */}
      {!splitEnabled &&
        (primaryAssignee ? 1 : 0) + additionalAssignees.length >= 2 &&
        (divideHoursDefault ? (
          <p className="rounded-lg border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
            {/* Preserve this booking's own flag while the org-wide setting
                hides the checkbox — otherwise editing the booking would
                silently clear it, which would matter if the org setting is
                later turned off. */}
            <input
              type="hidden"
              name="divide_hours_evenly"
              value={divideHours ? "on" : ""}
            />
            <span className="font-medium text-foreground">
              Hours are divided evenly across the crew
            </span>{" "}
            for all team jobs (Settings → Automations → Scheduling). Each
            cleaner will see their share (job length ÷ crew) in the field app.
          </p>
        ) : (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-muted/20 p-4">
            <input
              type="checkbox"
              name="divide_hours_evenly"
              checked={divideHours}
              onChange={(e) => setDivideHours(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              <span className="text-sm font-medium">
                Divide the hours evenly across the crew
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Each cleaner sees their share in the field app — a 4h job with 2
                cleaners shows as ~2h each. Doesn&rsquo;t change the visit
                window, their pay (from clock-in/out), or the client&rsquo;s
                bill.
              </span>
            </span>
          </label>
        ))}

      {/* ── Split shift ────────────────────────────────────────────────────
          When enabled, the booking is divided into time segments, each
          assigned to a different employee with their own rate.
          Segments are serialised as a JSON hidden field and saved to
          bookings.splits in the server action.
      ────────────────────────────────────────────────────────────────── */}
      {!isRecurring && (
        <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={splitEnabled}
              onChange={(e) => {
                setSplitEnabled(e.target.checked);
                if (e.target.checked && splits.length === 0) {
                  setSplits([
                    {
                      id: crypto.randomUUID(),
                      assigned_to: "",
                      duration_minutes: Math.round(defaultMinutes / 2) || 120,
                    },
                    {
                      id: crypto.randomUUID(),
                      assigned_to: "",
                      duration_minutes: Math.round(defaultMinutes / 2) || 120,
                    },
                  ]);
                }
              }}
              className="h-4 w-4 rounded border-input"
            />
            <SplitSquareVertical className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Split shift (hand-off)</span>
          </label>
          <p className="-mt-1 pl-7 text-xs text-muted-foreground">
            One cleaner works the first part, another takes over partway through
            — they do <strong>not</strong> overlap. For two cleaners working the{" "}
            <strong>same hours together</strong>, don&rsquo;t split: just assign
            them both as crew.
          </p>

          {splitEnabled && (
            <div className="space-y-3 pt-1">
              {/* Hidden field: serialised splits JSON */}
              <input
                type="hidden"
                name="splits"
                value={JSON.stringify(splits)}
              />

              {splits.map((seg, idx) => {
                // Compute start time for display
                const startOffset = splits
                  .slice(0, idx)
                  .reduce((sum, s) => sum + s.duration_minutes, 0);
                return (
                  <div
                    key={seg.id}
                    className="rounded-md border border-border bg-card p-3 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Segment {idx + 1}
                        {startOffset > 0 && (
                          <span className="ml-1.5 font-normal normal-case">
                            (starts at +{formatOffsetLabel(startOffset)})
                          </span>
                        )}
                      </span>
                      {splits.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeSplit(seg.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                          aria-label="Remove segment"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          Assigned to
                        </label>
                        <select
                          value={seg.assigned_to}
                          onChange={(e) =>
                            updateSplit(seg.id, { assigned_to: e.target.value })
                          }
                          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
                        >
                          <option value="">Select employee…</option>
                          {employees.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              {emp.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          Duration
                        </label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={Math.floor(seg.duration_minutes / 60)}
                            onChange={(e) => {
                              const hrs = Math.max(
                                0,
                                Number(e.target.value) || 0,
                              );
                              updateSplit(seg.id, {
                                duration_minutes:
                                  hrs * 60 + (seg.duration_minutes % 60),
                              });
                            }}
                            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
                          />
                          <span className="shrink-0 text-xs text-muted-foreground">
                            hr
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={55}
                            step={5}
                            value={seg.duration_minutes % 60}
                            onChange={(e) => {
                              const mins = Math.min(
                                55,
                                Math.max(0, Number(e.target.value) || 0),
                              );
                              updateSplit(seg.id, {
                                duration_minutes:
                                  Math.floor(seg.duration_minutes / 60) * 60 +
                                  mins,
                              });
                            }}
                            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
                          />
                          <span className="shrink-0 text-xs text-muted-foreground">
                            min
                          </span>
                        </div>
                      </div>

                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={addSplit}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-input py-2 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Add segment
              </button>

              {/* Summary row. The "$X estimated cost" that used to sit here
                  multiplied a per-segment rate nobody was ever paid — each
                  cleaner's clocked time is priced at their own wage. */}
              {splits.length > 0 &&
                (() => {
                  const totalSplitMins = splits.reduce(
                    (s, seg) => s + seg.duration_minutes,
                    0,
                  );
                  return (
                    <p className="text-xs text-muted-foreground">
                      Total:{" "}
                      <strong>
                        {Math.floor(totalSplitMins / 60)}h
                        {totalSplitMins % 60 > 0
                          ? ` ${totalSplitMins % 60}m`
                          : ""}
                      </strong>{" "}
                      across {splits.length} employees
                    </p>
                  );
                })()}
            </div>
          )}
        </div>
      )}

      {/* The "Hourly rate" field that used to sit beside Total is gone.
          It was the CLIENT'S time-and-materials price, but the pay code
          treated it as a per-booking wage override — a $35/hr-billed job
          paid the cleaner $35. One box, two meanings; Brian: "remove it
          entirely." Price a job with Total; wages live on the person. */}
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
      </div>

      {/*
        Only shown when the client actually has more than one place. A single
        property is not a choice, and rendering a one-option dropdown on every
        ordinary booking is the kind of noise that gets ignored — including on
        the rare booking where it matters.
      */}
      {/* Shown from ONE property up, not two. It used to hide for a single
          property and auto-select invisibly — correct data, invisible magic —
          and Svitlana read the silence as "it doesn't show up". A picker with
          one option is mild noise; a feature the owner can't see working is
          a support call. */}
      {selectedClientProperties.length >= 1 ? (
        <FormField label="Property" htmlFor="property_id">
          <FormSelect
            id="property_id"
            name="property_id"
            value={propertyId}
            onChange={(e) => {
              const id = e.target.value;
              setPropertyId(id);
              // Switching property always rewrites the address — unlike the
              // client prefill, which only fills a blank. Picking the downtown
              // loft and leaving the suburb address behind is precisely how a
              // cleaner ends up at the wrong door.
              const p = selectedClientProperties.find((x) => x.id === id);
              if (p?.address) setAddressValue(p.address);
            }}
          >
            <option value="">Choose a property…</option>
            {selectedClientProperties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.address ? p.label + " — " + p.address : p.label}
              </option>
            ))}
          </FormSelect>
        </FormField>
      ) : (
        // No visible choice — but the value must STILL be submitted. The
        // single-property auto-selection above is worthless if it never
        // reaches FormData: the server reads an absent field as null, which
        // both (a) kept the sole property — 100% of clients after the
        // backfill — off every booking they made, leaving door codes off the
        // field screen, and (b) severed an existing link on every edit.
        <input type="hidden" name="property_id" value={propertyId} />
      )}

      <FormField
        label="Address"
        htmlFor="address"
        error={state.errors?.address}
      >
        <AddressAutocomplete
          id="address"
          name="address"
          value={addressValue}
          onChange={setAddressValue}
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

      {/* Scope selector — only when editing a recurring booking */}
      {isEditingSeries && (
        <fieldset className="rounded-lg border border-border bg-muted/30 p-3.5 space-y-2">
          <legend className="px-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Apply changes to
          </legend>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="radio"
              name="_scope_ui"
              value="this_only"
              checked={updateScope === "this_only"}
              onChange={() => setUpdateScope("this_only")}
              className="accent-primary"
            />
            <span className="text-sm">
              <span className="font-medium">Just this booking</span>
              <span className="ml-1.5 text-muted-foreground">
                — only this occurrence is updated
              </span>
            </span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="radio"
              name="_scope_ui"
              value="this_and_future"
              checked={updateScope === "this_and_future"}
              onChange={() => setUpdateScope("this_and_future")}
              className="accent-primary"
            />
            <span className="text-sm">
              <span className="font-medium">This and all future bookings</span>
              <span className="ml-1.5 text-muted-foreground">
                — updates this and every upcoming occurrence
              </span>
            </span>
          </label>
        </fieldset>
      )}

      {/* ── Edit recurring schedule ─────────────────────────────────────────
          Shown only when editing a recurring booking AND the user chose
          "this and all future bookings". Lets the owner change the frequency,
          time-of-day, days, or end-date without creating a brand-new series.
          The server action detects `series_update_schedule=1`, deletes future
          pending/confirmed occurrences, and regenerates from the new rule.   */}
      {isEditingSeries && updateScope === "this_and_future" && (
        <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20 p-4">
          <div className="flex items-center gap-1.5">
            <Repeat className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-semibold text-foreground">
              Edit recurring schedule
            </h3>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Changing the schedule will cancel future occurrences and regenerate
            them from the new rule.
          </p>

          {/* Signal the server to apply schedule changes */}
          <input type="hidden" name="series_update_schedule" value="1" />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Frequency" htmlFor="series_pattern" required>
              <FormSelect
                id="series_pattern"
                name="series_pattern"
                value={seriesPattern}
                onChange={(e) => setSeriesPattern(e.target.value)}
              >
                {RECURRENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </FormSelect>
              <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                {
                  RECURRENCE_OPTIONS.find((o) => o.value === seriesPattern)
                    ?.description
                }
              </p>
            </FormField>

            <FormField label="Time" htmlFor="series_start_time" required>
              <Input
                id="series_start_time"
                name="series_start_time"
                type="time"
                required
                value={seriesStartTime}
                onChange={(e) => setSeriesStartTime(e.target.value)}
              />
            </FormField>
          </div>

          {/* Monthly-Nth picker */}
          {seriesPattern === "monthly_nth" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Which occurrence"
                htmlFor="series_monthly_nth"
                required
              >
                <FormSelect
                  id="series_monthly_nth"
                  name="series_monthly_nth"
                  value={seriesMonthlyNth}
                  onChange={(e) => setSeriesMonthlyNth(e.target.value)}
                >
                  <option value="1">1st</option>
                  <option value="2">2nd</option>
                  <option value="3">3rd</option>
                  <option value="4">4th</option>
                  <option value="5">Last</option>
                </FormSelect>
              </FormField>
              <FormField label="Weekday" htmlFor="series_monthly_dow" required>
                <FormSelect
                  id="series_monthly_dow"
                  name="series_monthly_dow"
                  value={seriesMonthlyDow}
                  onChange={(e) => setSeriesMonthlyDow(e.target.value)}
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
          {seriesPattern === "custom_weekly" && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Days of the week <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {DAY_LABELS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleSeriesDay(day.value)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors border ${
                      seriesCustomDays.includes(day.value)
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
                name="series_custom_days"
                value={seriesCustomDays.join(",")}
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Regenerate from"
              htmlFor="series_starts_at"
              required
              hint="New occurrences are generated from this date forward"
            >
              <Input
                id="series_starts_at"
                name="series_starts_at"
                type="date"
                required
                value={seriesStartsAt}
                onChange={(e) => setSeriesStartsAt(e.target.value)}
              />
            </FormField>

            <FormField label="Series ends" htmlFor="series_ends_at">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={seriesEndsIndefinite}
                    onChange={(e) => setSeriesEndsIndefinite(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span>Continue indefinitely</span>
                </label>
                {/* Quick preset buttons */}
                {!seriesEndsIndefinite && (
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: "1 year", months: 12 },
                      { label: "2 years", months: 24 },
                      { label: "5 years", months: 60 },
                    ].map(({ label, months }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => {
                          const d = new Date();
                          d.setMonth(d.getMonth() + months);
                          setSeriesEndsAtValue(d.toISOString().slice(0, 10));
                        }}
                        className="rounded-full border border-input bg-muted px-2.5 py-0.5 text-xs hover:bg-accent"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <Input
                  id="series_ends_at"
                  name="series_ends_at"
                  type="date"
                  value={seriesEndsIndefinite ? "" : seriesEndsAtValue}
                  onChange={(e) => setSeriesEndsAtValue(e.target.value)}
                  disabled={seriesEndsIndefinite}
                  required={!seriesEndsIndefinite}
                  className={seriesEndsIndefinite ? "opacity-50" : ""}
                />
              </div>
            </FormField>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        {/* In embedded mode (calendar sheet) there's no page to navigate
            back to — the sheet's own close button serves as Cancel. */}
        {!onSuccess && (
          <Link
            href={cancelHref}
            className={buttonVariants({ variant: "ghost" })}
          >
            Cancel
          </Link>
        )}
        <SubmitButton
          pendingLabel={isRecurring ? "Creating…" : "Saving…"}
          disabled={services.length === 0}
        >
          {mode === "create"
            ? isRecurring
              ? "Create recurring booking"
              : "Create booking"
            : updateScope === "this_and_future"
              ? "Save this & future bookings"
              : "Save changes"}
        </SubmitButton>
      </div>

      <Dialog open={notifyDialogOpen} onOpenChange={setNotifyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tell the client about this change?</DialogTitle>
            <DialogDescription>
              {seriesScheduleChanged && !timeChanged
                ? "This rewrites their upcoming visits. Sollos can notify them of the new schedule — email or text, whichever they prefer — or save quietly so you can tell them yourself."
                : "This moves the visit time. Sollos can notify them of the new time — email or text, whichever they prefer — or save quietly so you can tell them yourself."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => saveWithNotifyChoice("0")}
              className={buttonVariants({ variant: "outline" })}
            >
              Save without notifying
            </button>
            <button
              type="button"
              onClick={() => saveWithNotifyChoice("1")}
              className={buttonVariants()}
            >
              Save &amp; notify client
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </form>
  );
}

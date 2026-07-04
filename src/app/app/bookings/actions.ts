"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import type { Database, Json } from "@/lib/supabase/types";

type ServiceTypeEnum = Database["public"]["Enums"]["service_type"];
import {
  BookingSchema,
  RecurringBookingSchema,
  SplitsArraySchema,
} from "@/lib/validators/bookings";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  syncMemberCalendarEvents,
} from "@/lib/google-calendar";
import { generateOccurrences, type SeriesRule } from "@/lib/recurrence";
import {
  notifyBookingAssignment,
  notifyBookingCancelledToEmployee,
  sendBookingCancelledToClient,
  sendBookingConfirmation,
  sendBookingRescheduled,
  autoInvoiceOnJobComplete,
} from "@/lib/automations";
import { canCreateData } from "@/lib/subscription";
import { getOrgTimezone } from "@/lib/org-timezone";
import { localInputToUtcIso } from "@/lib/validators/common";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { redirectAfterSetup } from "@/lib/setup-return";

type Field = keyof typeof BookingSchema.shape;
export type BookingFormState = ActionState<Field & string>;

function readFormValues(formData: FormData) {
  return {
    client_id: String(formData.get("client_id") ?? ""),
    package_id: String(formData.get("package_id") ?? ""),
    assigned_to: String(formData.get("assigned_to") ?? ""),
    scheduled_at: String(formData.get("scheduled_at") ?? ""),
    duration_minutes: String(formData.get("duration_minutes") ?? ""),
    service_type: String(formData.get("service_type") ?? "standard"),
    status: String(formData.get("status") ?? "pending"),
    total_cents: String(formData.get("total_cents") ?? ""),
    hourly_rate_cents: String(formData.get("hourly_rate_cents") ?? ""),
    address: String(formData.get("address") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    divide_hours_evenly: String(formData.get("divide_hours_evenly") ?? ""),
  };
}

/**
 * Pull the FK + denormalized label that the booking form ships in
 * hidden inputs alongside the enum `service_type`. These aren't part
 * of the Zod schema (we don't want to fail validation on legacy form
 * posts that don't ship them), so we read them ourselves and apply
 * them to the booking insert/update payload.
 *
 * Returns nulls when the fields are absent — the table accepts NULL
 * for both columns, so a partial caller (e.g. the public client
 * portal request form) won't break.
 */
function readServiceExtras(formData: FormData): {
  service_type_id: string | null;
  service_type_label: string | null;
} {
  const id = String(formData.get("service_type_id") ?? "").trim();
  const label = String(formData.get("service_type_label") ?? "").trim();
  return {
    service_type_id: id.length > 0 ? id : null,
    service_type_label: label.length > 0 ? label : null,
  };
}

function readRecurringFormValues(formData: FormData) {
  return {
    client_id: String(formData.get("client_id") ?? ""),
    package_id: String(formData.get("package_id") ?? ""),
    assigned_to: String(formData.get("assigned_to") ?? ""),
    recurrence_pattern: String(formData.get("recurrence_pattern") ?? "weekly"),
    custom_days: String(formData.get("custom_days") ?? ""),
    monthly_nth: String(formData.get("monthly_nth") ?? ""),
    monthly_dow: String(formData.get("monthly_dow") ?? ""),
    start_time: String(formData.get("start_time") ?? ""),
    starts_at: String(formData.get("starts_at") ?? ""),
    ends_at: String(formData.get("ends_at") ?? ""),
    generate_ahead: String(formData.get("generate_ahead") ?? "52"),
    duration_minutes: String(formData.get("duration_minutes") ?? ""),
    service_type: String(formData.get("service_type") ?? "recurring"),
    total_cents: String(formData.get("total_cents") ?? ""),
    hourly_rate_cents: String(formData.get("hourly_rate_cents") ?? ""),
    address: String(formData.get("address") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

/**
 * Parse the array of additional-crew membership ids out of a submitted
 * form. Uses FormData.getAll so multiple same-named inputs are all
 * captured.
 */
function readAdditionalAssignees(formData: FormData): string[] {
  return formData
    .getAll("additional_assignees")
    .map((v) => String(v))
    .filter((v) => v.length > 0);
}

type SplitSegmentInput = { assigned_to: string; duration_minutes: number };

/**
 * Sync the booking_assignees junction table for a booking after a
 * create/update. `primary_id` is the single assignee stored in
 * bookings.assigned_to; `additional_ids` is the extra crew. The table's
 * existing rows are replaced so re-editing feels intuitive.
 *
 * When `splits` is non-empty, booking_assignees is built from the
 * segments array instead — each segment employee gets a row with their
 * start offset and duration. This makes booking_assignees the single
 * source of truth for split shifts.
 */
async function syncBookingAssignees(
  supabase: Awaited<
    ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>
  >,
  organizationId: string,
  bookingId: string,
  primaryId: string | null,
  additionalIds: string[],
  splits: SplitSegmentInput[] = [],
): Promise<void> {
  // CROSS-ORG GUARD: every submitted membership_id must belong to the
  // caller's org and be active. Otherwise a malicious owner with multiple
  // org memberships could plant a foreign membership in booking_assignees
  // by spoofing the form payload — RLS won't catch it because the row
  // itself is in the caller's org. Filter unknown IDs out silently.
  const submitted = new Set<string>();
  if (primaryId) submitted.add(primaryId);
  for (const id of additionalIds) if (id) submitted.add(id);
  for (const s of splits) if (s.assigned_to) submitted.add(s.assigned_to);

  let validIds: Set<string> = new Set();
  if (submitted.size > 0) {
    const { data: validMembers } = (await supabase
      .from("memberships")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .in("id", Array.from(submitted))) as unknown as {
      data: Array<{ id: string }> | null;
    };
    validIds = new Set((validMembers ?? []).map((m) => m.id));
  }
  const isValid = (id: string | null | undefined): id is string =>
    !!id && validIds.has(id);

  // Filter the inputs to only the validated IDs.
  const safePrimaryId = isValid(primaryId) ? primaryId : null;
  const safeAdditionalIds = additionalIds.filter(isValid);
  const safeSplits = splits.filter((s) => isValid(s.assigned_to));

  // Drop the existing set. RLS scopes this to the caller's org; the
  // booking_id filter is the authoritative narrowing.
  await (supabase
    .from("booking_assignees")
    .delete()
    .eq("booking_id", bookingId) as unknown as Promise<unknown>);

  const rows: Array<{
    organization_id: string;
    booking_id: string;
    membership_id: string;
    is_primary: boolean;
    split_index: number | null;
    split_start_offset_minutes: number | null;
    split_duration_minutes: number | null;
  }> = [];

  if (safeSplits.length > 0) {
    // Split mode: derive booking_assignees from the segments array.
    // Offsets are computed cumulatively from segment durations.
    let offset = 0;
    const seen = new Set<string>();
    safeSplits.forEach((seg, idx) => {
      if (!seg.assigned_to || seen.has(seg.assigned_to)) {
        offset += Number(seg.duration_minutes) || 0;
        return;
      }
      seen.add(seg.assigned_to);
      rows.push({
        organization_id: organizationId,
        booking_id: bookingId,
        membership_id: seg.assigned_to,
        is_primary: idx === 0,
        split_index: idx,
        split_start_offset_minutes: offset,
        split_duration_minutes: Number(seg.duration_minutes) || 0,
      });
      offset += Number(seg.duration_minutes) || 0;
    });
    // Also persist any "additional crew" who aren't part of any segment.
    // Without this, owners who add helpers via the additional_assignees
    // checkboxes alongside splits would silently lose those helpers —
    // they wouldn't see the job, wouldn't get notifications, no GCal sync.
    for (const id of safeAdditionalIds) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push({
        organization_id: organizationId,
        booking_id: bookingId,
        membership_id: id,
        is_primary: false,
        split_index: null,
        split_start_offset_minutes: null,
        split_duration_minutes: null,
      });
    }
  } else {
    // Normal mode: primary + additional crew, no split metadata.
    if (safePrimaryId) {
      rows.push({
        organization_id: organizationId,
        booking_id: bookingId,
        membership_id: safePrimaryId,
        is_primary: true,
        split_index: null,
        split_start_offset_minutes: null,
        split_duration_minutes: null,
      });
    }
    for (const id of safeAdditionalIds) {
      if (id === safePrimaryId) continue; // guard against duplicates
      rows.push({
        organization_id: organizationId,
        booking_id: bookingId,
        membership_id: id,
        is_primary: false,
        split_index: null,
        split_start_offset_minutes: null,
        split_duration_minutes: null,
      });
    }
  }

  if (rows.length === 0) return;

  await (supabase
    .from("booking_assignees")
    .insert(rows) as unknown as Promise<unknown>);
}

/**
 * Bulk variant of syncBookingAssignees for `this_and_future` series
 * updates. Validates memberships ONCE, deletes all targets in ONE
 * statement, builds N×rows arrays then inserts in ONE statement.
 *
 * The per-booking version did 3 sequential round-trips per sibling
 * (validate, delete, insert). For a year-long weekly series that's
 * 156 round-trips and could time out Vercel's 15s action limit. This
 * version does 3 statements total regardless of how many bookings.
 *
 * Behavior contract matches syncBookingAssignees: when splits is
 * non-empty, the segments array drives the rows (with additionalIds
 * appended as non-split crew); otherwise primary + additional.
 */
async function syncBookingAssigneesBulk(
  supabase: Awaited<
    ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>
  >,
  organizationId: string,
  bookingIds: string[],
  primaryId: string | null,
  additionalIds: string[],
  splits: SplitSegmentInput[] = [],
): Promise<void> {
  if (bookingIds.length === 0) return;

  // Single membership validation pass (was repeated per booking).
  const submitted = new Set<string>();
  if (primaryId) submitted.add(primaryId);
  for (const id of additionalIds) if (id) submitted.add(id);
  for (const s of splits) if (s.assigned_to) submitted.add(s.assigned_to);

  let validIds: Set<string> = new Set();
  if (submitted.size > 0) {
    const { data: validMembers } = (await supabase
      .from("memberships")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .in("id", Array.from(submitted))) as unknown as {
      data: Array<{ id: string }> | null;
    };
    validIds = new Set((validMembers ?? []).map((m) => m.id));
  }
  const isValid = (id: string | null | undefined): id is string =>
    !!id && validIds.has(id);

  const safePrimaryId = isValid(primaryId) ? primaryId : null;
  const safeAdditionalIds = additionalIds.filter(isValid);
  const safeSplits = splits.filter((s) => isValid(s.assigned_to));

  // One DELETE for every target booking.
  await (supabase
    .from("booking_assignees")
    .delete()
    .in("booking_id", bookingIds) as unknown as Promise<unknown>);

  // Pre-compute the canonical row template once, then stamp each booking_id.
  type Row = {
    organization_id: string;
    booking_id: string;
    membership_id: string;
    is_primary: boolean;
    split_index: number | null;
    split_start_offset_minutes: number | null;
    split_duration_minutes: number | null;
  };

  const buildRowsForBooking = (bookingId: string): Row[] => {
    const out: Row[] = [];
    if (safeSplits.length > 0) {
      let offset = 0;
      const seen = new Set<string>();
      safeSplits.forEach((seg, idx) => {
        if (!seg.assigned_to || seen.has(seg.assigned_to)) {
          offset += Number(seg.duration_minutes) || 0;
          return;
        }
        seen.add(seg.assigned_to);
        out.push({
          organization_id: organizationId,
          booking_id: bookingId,
          membership_id: seg.assigned_to,
          is_primary: idx === 0,
          split_index: idx,
          split_start_offset_minutes: offset,
          split_duration_minutes: Number(seg.duration_minutes) || 0,
        });
        offset += Number(seg.duration_minutes) || 0;
      });
      for (const id of safeAdditionalIds) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({
          organization_id: organizationId,
          booking_id: bookingId,
          membership_id: id,
          is_primary: false,
          split_index: null,
          split_start_offset_minutes: null,
          split_duration_minutes: null,
        });
      }
    } else {
      if (safePrimaryId) {
        out.push({
          organization_id: organizationId,
          booking_id: bookingId,
          membership_id: safePrimaryId,
          is_primary: true,
          split_index: null,
          split_start_offset_minutes: null,
          split_duration_minutes: null,
        });
      }
      for (const id of safeAdditionalIds) {
        if (id === safePrimaryId) continue;
        out.push({
          organization_id: organizationId,
          booking_id: bookingId,
          membership_id: id,
          is_primary: false,
          split_index: null,
          split_start_offset_minutes: null,
          split_duration_minutes: null,
        });
      }
    }
    return out;
  };

  const allRows: Row[] = bookingIds.flatMap(buildRowsForBooking);
  if (allRows.length === 0) return;

  await (supabase
    .from("booking_assignees")
    .insert(allRows) as unknown as Promise<unknown>);
}

/**
 * Look up human-readable names for the client and assigned employee so
 * the Google Calendar event has a useful title/description.
 */
async function getBookingLabels(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  clientId: string,
  assignedTo: string | null,
) {
  let clientName: string | undefined;
  let employeeName: string | undefined;

  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .maybeSingle();
  if (client) clientName = client.name;

  if (assignedTo) {
    const { data: emp } = await supabase
      .from("memberships")
      .select("profiles(full_name)")
      .eq("id", assignedTo)
      .maybeSingle();
    if (emp?.profiles) {
      const profile = emp.profiles as unknown as { full_name: string };
      employeeName = profile.full_name;
    }
  }

  return { clientName, employeeName };
}

export async function createBookingAction(
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(BookingSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  // Re-interpret the datetime-local string using the org's timezone.
  // BookingSchema's transform used DEFAULT_TZ (falls back to a reasonable
  // default but can drift for orgs outside Eastern). Rewriting here uses
  // the authoritative per-org timezone.
  const orgTz = await getOrgTimezone(membership.organization_id);
  parsed.data.scheduled_at = localInputToUtcIso(raw.scheduled_at, orgTz);

  // Past dates are allowed — owners regularly need to back-fill historical
  // jobs when they're onboarding, switching from another tool, catching up
  // on last month, or reconstructing records. We intentionally do not
  // reject past scheduled_at. A previous version of this guard blocked
  // pending/confirmed/en_route status in the past to catch typos, but the
  // cost to legitimate catch-up use was too high. If the UI needs a soft
  // "are you sure?" for date-typo protection in the future, do it
  // client-side so it's an advisory, not a gate.

  if (!(await canCreateData(membership.organization_id))) {
    return { errors: { _form: "Your subscription has expired. Subscribe to create new bookings." }, values: raw };
  }

  // Parse + validate split segments. Empty array = no split shift.
  // Invalid input (missing assigned_to, zero/negative duration, segments
  // without a UUID) is rejected with a form error rather than silently
  // accepted — previously the action would save a booking with
  // assigned_to="" and no crew notifications.
  const splitsJson = String(formData.get("splits") ?? "[]");
  let splitsRaw: unknown[] = [];
  try { splitsRaw = JSON.parse(splitsJson); } catch { splitsRaw = []; }
  if (!Array.isArray(splitsRaw)) splitsRaw = [];

  const splitsParsed = SplitsArraySchema.safeParse(splitsRaw);
  if (!splitsParsed.success) {
    return {
      errors: {
        _form:
          "Split-shift segments are incomplete. Make sure every segment has a cleaner and a duration greater than zero.",
      },
      values: raw,
    };
  }
  const splits = splitsParsed.data;

  // A split shift is a HAND-OFF between different people, and booking_assignees
  // is UNIQUE(booking_id, membership_id) — a cleaner can hold only one segment.
  // Reject the same cleaner across two segments instead of silently dropping
  // one (which undercounted their hours and broke the handoff).
  {
    const ids = (splits as SplitSegmentInput[])
      .map((s) => s.assigned_to)
      .filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      return {
        errors: {
          _form:
            "Each cleaner can take only one segment of a split shift. Assign a different cleaner to each segment — a split is a hand-off between people, not one person working two separate windows.",
        },
        values: raw,
      };
    }
  }

  // When split segments exist, use their total duration for GCal (not the
  // booking's overall duration_minutes, which is the full slot length).
  const effectiveDuration =
    splits.length > 0
      ? splits.reduce(
          (sum, s) => sum + (Number(s.duration_minutes) || 0),
          0,
        )
      : parsed.data.duration_minutes;

  // When splits are active, ALWAYS make assigned_to track segment 0.
  // Otherwise the form's "Primary assignee" dropdown can point at a
  // different person than the first segment, leaving the booking with
  // a primary not present in any segment — notifications go to the
  // wrong person, GCal labels say the wrong name, etc.
  const segmentZeroAssignee = (() => {
    if (splits.length === 0) return null;
    const first = splits[0] as { assigned_to?: string };
    return first?.assigned_to || null;
  })();
  const effectiveAssignedTo =
    splits.length > 0
      ? segmentZeroAssignee
      : (parsed.data.assigned_to ?? null);

  const serviceExtras = readServiceExtras(formData);
  // Server-side gate: the form's submit button is disabled when the
  // service catalog is empty, but pressing Enter inside an input
  // bypasses the button-disabled check via native form submission.
  // Without this guard a booking would save with service_type_id=NULL
  // and service_type_label="" — exactly the bug the empty-catalog
  // submit-button fix tried to close. Belt + braces.
  if (!serviceExtras.service_type_id) {
    return {
      errors: {
        _form:
          "No services configured. Go to Settings → Services and add at least one before creating a booking.",
      },
      values: raw,
    };
  }
  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      organization_id: membership.organization_id,
      client_id: parsed.data.client_id,
      package_id: parsed.data.package_id ?? null,
      assigned_to: effectiveAssignedTo,
      scheduled_at: parsed.data.scheduled_at,
      duration_minutes: parsed.data.duration_minutes,
      service_type: parsed.data.service_type,
      service_type_id: serviceExtras.service_type_id,
      service_type_label: serviceExtras.service_type_label,
      status: parsed.data.status,
      total_cents: parsed.data.total_cents,
      hourly_rate_cents: parsed.data.hourly_rate_cents ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      divide_hours_evenly: parsed.data.divide_hours_evenly,
      splits: splits,
    })
    .select("id")
    .single();

  if (error) return { errors: { _form: error.message }, values: raw };

  // Additional crew (if any) — write to booking_assignees so the primary
  // + extras are all tracked consistently. For split shifts, pass the
  // segments array so each employee gets a row with offset/duration.
  await syncBookingAssignees(
    supabase,
    membership.organization_id,
    booking.id,
    effectiveAssignedTo,
    readAdditionalAssignees(formData),
    splits as SplitSegmentInput[],
  );

  // Email booking confirmation to client (fire-and-forget)
  sendBookingConfirmation(booking.id);

  // Notify EVERY assigned crew member (primary + additional + every
  // split segment employee). Previously only segment-0 got a push, so
  // additional crew and non-primary segment employees were silently
  // added to jobs they didn't know about.
  {
    const splitAssigneesForNotify = (splits as SplitSegmentInput[])
      .map((s) => s.assigned_to)
      .filter(Boolean);
    const everyAssignee = Array.from(
      new Set(
        [
          effectiveAssignedTo,
          ...readAdditionalAssignees(formData),
          ...splitAssigneesForNotify,
        ].filter(Boolean) as string[],
      ),
    );
    for (const mid of everyAssignee) {
      const labels = await getBookingLabels(
        supabase,
        parsed.data.client_id,
        mid,
      );
      notifyBookingAssignment(
        membership.organization_id,
        booking.id,
        mid,
        {
          clientName: labels.clientName ?? "A client",
          scheduledAt: parsed.data.scheduled_at,
          serviceType: parsed.data.service_type,
          address: parsed.data.address ?? null,
        },
      );
    }
  }

  // Sync to Google Calendar (fire-and-forget — don't block the action)
  const labels = await getBookingLabels(
    supabase,
    parsed.data.client_id,
    effectiveAssignedTo,
  );
  await createCalendarEvent(membership.organization_id, {
    id: booking.id,
    scheduled_at: parsed.data.scheduled_at,
    duration_minutes: effectiveDuration,
    service_type: parsed.data.service_type,
    address: parsed.data.address ?? null,
    notes: parsed.data.notes ?? null,
    client_name: labels.clientName,
    employee_name: labels.employeeName,
    split_count: new Set(
      (splits as SplitSegmentInput[]).map((s) => s.assigned_to).filter(Boolean),
    ).size,
  }).catch((err) => console.error("[gcal] sync error on create:", err));

  // Sync to each assigned employee's personal calendar (fire-and-forget).
  {
    const splitAssignees = (splits as SplitSegmentInput[])
      .map((s) => s.assigned_to)
      .filter(Boolean);
    const allAssignees = Array.from(new Set([
      ...(parsed.data.assigned_to ? [parsed.data.assigned_to] : []),
      ...readAdditionalAssignees(formData),
      ...splitAssignees,
    ]));
    syncMemberCalendarEvents(booking.id, allAssignees, {
      id: booking.id,
      scheduled_at: parsed.data.scheduled_at,
      duration_minutes: effectiveDuration,
      service_type: parsed.data.service_type,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      client_name: labels.clientName,
    }).catch(() => {});
  }

  revalidatePath("/app/bookings");
  revalidatePath("/app/calendar");
  revalidatePath("/app");

  // When the form is embedded in the calendar Sheet, return a done
  // signal instead of redirecting so the sheet can close without
  // navigating away from the calendar page.
  if (String(formData.get("_source") ?? "") === "calendar") {
    return { values: { ...raw, _done: "1" } };
  }

  redirectAfterSetup(formData, "/app/bookings");
}

export async function createRecurringBookingAction(
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const raw = readRecurringFormValues(formData);
  const parsed = parseForm(RecurringBookingSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors as BookingFormState["errors"], values: raw };

  const { membership, supabase } = await getActionContext();

  const orgTz = await getOrgTimezone(membership.organization_id);

  // Past start dates are allowed — owners often back-fill a recurring
  // client who has been with them for months. generateOccurrences will
  // still produce instances from starts_at onward up to the generate_ahead
  // limit, so a 3-month-old start date produces a reasonable window of
  // occurrences (the user can always delete the ones that didn't actually
  // happen, or set their status to cancelled). A previous version of this
  // guard rejected past starts_at but blocked legitimate onboarding.

  // Validate custom_days for custom_weekly
  if (
    parsed.data.recurrence_pattern === "custom_weekly" &&
    (!parsed.data.custom_days || parsed.data.custom_days.length === 0)
  ) {
    return {
      errors: { _form: "Select at least one day of the week for custom weekly scheduling." },
      values: raw,
    };
  }

  // Validate monthly_nth inputs
  if (
    parsed.data.recurrence_pattern === "monthly_nth" &&
    (parsed.data.monthly_nth == null || parsed.data.monthly_dow == null)
  ) {
    return {
      errors: { _form: "Pick both an ordinal (1st, 2nd, etc.) and a weekday for monthly scheduling." },
      values: raw,
    };
  }

  // 1. Create the booking series
  // Read service FK once up front — used by both the series row and
  // each generated occurrence so they all stay in sync.
  const recurringServiceExtras = readServiceExtras(formData);
  // Same Enter-key guard as createBookingAction. Without a real
  // service_type_id the recurring series + all generated occurrences
  // would have NULL FK + empty label.
  if (!recurringServiceExtras.service_type_id) {
    return {
      errors: {
        _form:
          "No services configured. Go to Settings → Services and add at least one before creating a recurring booking.",
      },
      values: raw,
    };
  }
  const { data: series, error: seriesErr } = await (supabase
    .from("booking_series")
    .insert({
      organization_id: membership.organization_id,
      client_id: parsed.data.client_id,
      pattern: parsed.data.recurrence_pattern,
      custom_days: parsed.data.recurrence_pattern === "custom_weekly"
        ? parsed.data.custom_days
        : null,
      monthly_nth: parsed.data.recurrence_pattern === "monthly_nth"
        ? parsed.data.monthly_nth ?? null
        : null,
      monthly_dow: parsed.data.recurrence_pattern === "monthly_nth"
        ? parsed.data.monthly_dow ?? null
        : null,
      start_time: parsed.data.start_time,
      starts_at: parsed.data.starts_at,
      ends_at: parsed.data.ends_at ?? null,
      generate_ahead: parsed.data.generate_ahead,
      duration_minutes: parsed.data.duration_minutes,
      service_type: parsed.data.service_type,
      // FK + label live on the series row too (migration
      // 20260531010000) so the extend-series cron can carry them
      // forward onto each generated occurrence — without these,
      // cron-generated bookings would display the humanized enum
      // instead of the org's custom service name.
      service_type_id: recurringServiceExtras.service_type_id,
      service_type_label: recurringServiceExtras.service_type_label,
      package_id: parsed.data.package_id ?? null,
      assigned_to: parsed.data.assigned_to ?? null,
      total_cents: parsed.data.total_cents,
      hourly_rate_cents: parsed.data.hourly_rate_cents ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select("id")
    .single() as unknown as { data: { id: string } | null; error: { message: string } | null });

  if (seriesErr || !series) {
    return {
      errors: { _form: seriesErr?.message ?? "Failed to create series" },
      values: raw,
    };
  }

  // 2. Generate the first batch of occurrences
  const rule: SeriesRule = {
    pattern: parsed.data.recurrence_pattern,
    custom_days: parsed.data.custom_days ?? null,
    start_time: parsed.data.start_time,
    starts_at: parsed.data.starts_at,
    ends_at: parsed.data.ends_at ?? null,
    generate_ahead: parsed.data.generate_ahead,
    monthly_nth: parsed.data.monthly_nth ?? null,
    monthly_dow: parsed.data.monthly_dow ?? null,
    tz: orgTz,
  };

  const occurrences = generateOccurrences(rule, parsed.data.generate_ahead, null);

  if (occurrences.length === 0) {
    return {
      errors: { _form: "No occurrences could be generated from the recurrence rule. Check your start date and days." },
      values: raw,
    };
  }

  // 3. Insert all booking instances (recurringServiceExtras declared above)
  const bookingRows = occurrences.map((scheduled_at) => ({
    organization_id: membership.organization_id,
    client_id: parsed.data.client_id,
    package_id: parsed.data.package_id ?? null,
    assigned_to: parsed.data.assigned_to ?? null,
    scheduled_at,
    duration_minutes: parsed.data.duration_minutes,
    service_type: parsed.data.service_type,
    service_type_id: recurringServiceExtras.service_type_id,
    service_type_label: recurringServiceExtras.service_type_label,
    status: "confirmed" as const,
    total_cents: parsed.data.total_cents,
    hourly_rate_cents: parsed.data.hourly_rate_cents ?? null,
    address: parsed.data.address ?? null,
    notes: parsed.data.notes
      ? `[Recurring] ${parsed.data.notes}`
      : "[Recurring]",
    series_id: series.id,
  }));

  const { data: insertedBookings, error: bookingsErr } = await (supabase
    .from("bookings")
    .insert(bookingRows)
    .select("id, scheduled_at") as unknown as {
    data: { id: string; scheduled_at: string }[] | null;
    error: { message: string } | null;
  });

  if (bookingsErr) {
    return {
      errors: { _form: bookingsErr.message },
      values: raw,
    };
  }

  // 4. Sync booking_assignees + Google Calendar for each occurrence
  if (insertedBookings && insertedBookings.length > 0) {
    const labels = await getBookingLabels(
      supabase,
      parsed.data.client_id,
      parsed.data.assigned_to ?? null,
    );

    const additionalIds = readAdditionalAssignees(formData);
    const recurringAssignees = [
      parsed.data.assigned_to,
      ...additionalIds,
    ].filter(Boolean) as string[];

    // Assignee rows are written inline (awaited) — the scheduler and field
    // app need them present the moment the save returns.
    for (const b of insertedBookings) {
      // Write booking_assignees rows so the scheduler shows the booking
      // in every assignee's lane, the field app surfaces it to additional
      // crew, and quick-assign edits later work cleanly. Splits aren't
      // supported on recurring bookings (UI hides them), so pass [].
      await syncBookingAssignees(
        supabase,
        membership.organization_id,
        b.id,
        parsed.data.assigned_to ?? null,
        additionalIds,
        [],
      );
    }

    // Calendar sync runs in after() so the save returns immediately while the
    // serverless runtime keeps the function alive until the Google Calendar
    // writes actually finish. Firing these un-awaited (the old way) meant the
    // function froze right after the redirect and the events silently never
    // got created — the root cause of recurring bookings with no calendar
    // entry. Awaited sequentially here so they reliably complete.
    const calBookings = insertedBookings;
    after(async () => {
      for (const b of calBookings) {
        await createCalendarEvent(membership.organization_id, {
          id: b.id,
          scheduled_at: b.scheduled_at,
          duration_minutes: parsed.data.duration_minutes,
          service_type: parsed.data.service_type,
          address: parsed.data.address ?? null,
          notes: parsed.data.notes ?? null,
          client_name: labels.clientName,
          employee_name: labels.employeeName,
        }).catch((err) =>
          console.error("[gcal] recurring create:", err),
        );
        await syncMemberCalendarEvents(b.id, recurringAssignees, {
          id: b.id,
          scheduled_at: b.scheduled_at,
          duration_minutes: parsed.data.duration_minutes,
          service_type: parsed.data.service_type,
          address: parsed.data.address ?? null,
          notes: parsed.data.notes ?? null,
          client_name: labels.clientName,
        }).catch(() => {});
      }
    });
  }

  revalidatePath("/app/bookings");
  revalidatePath("/app/calendar");
  revalidatePath("/app");

  // When the form is embedded in the calendar Sheet, return a done
  // signal instead of redirecting so the sheet can close without
  // navigating away from the calendar page.
  if (String(formData.get("_source") ?? "") === "calendar") {
    return { values: { ...raw, _done: "1" } };
  }

  redirectAfterSetup(formData, "/app/bookings");
}

export async function updateBookingAction(
  id: string,
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(BookingSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  // Re-interpret datetime-local with the org's tz (see createBookingAction).
  const orgTz = await getOrgTimezone(membership.organization_id);
  parsed.data.scheduled_at = localInputToUtcIso(raw.scheduled_at, orgTz);

  // Fetch the existing booking to detect assignee + scheduled_at + status changes.
  // service_type is pulled too so the "this and future" schedule-change
  // path can carry the original enum forward onto regenerated rows —
  // without it, the regenerate path silently rewrites the enum and
  // bypasses the immutability rule the field-only edit path enforces.
  const { data: existing } = (await supabase
    .from("bookings")
    .select("google_calendar_event_id, assigned_to, scheduled_at, status, service_type")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      google_calendar_event_id: string | null;
      assigned_to: string | null;
      scheduled_at: string | null;
      status: string | null;
      service_type: string | null;
    } | null;
  };

  // Fetch the booking's PREVIOUS assignees so we can later diff against
  // the new set and notify only NEW additions (not existing ones).
  // Includes split-segment employees because booking_assignees is now
  // the source of truth for them too.
  const { data: previousAssigneesRows } = (await supabase
    .from("booking_assignees")
    .select("membership_id")
    .eq("booking_id", id)) as unknown as {
    data: Array<{ membership_id: string }> | null;
  };
  const previousAssigneeIds = new Set(
    (previousAssigneesRows ?? []).map((r) => r.membership_id),
  );

  // Parse + validate split segments. Same rules as createBookingAction.
  const updateSplitsJson = String(formData.get("splits") ?? "[]");
  let updateSplitsRaw: unknown[] = [];
  try { updateSplitsRaw = JSON.parse(updateSplitsJson); } catch { updateSplitsRaw = []; }
  if (!Array.isArray(updateSplitsRaw)) updateSplitsRaw = [];

  const updateSplitsParsed = SplitsArraySchema.safeParse(updateSplitsRaw);
  if (!updateSplitsParsed.success) {
    return {
      errors: {
        _form:
          "Split-shift segments are incomplete. Make sure every segment has a cleaner and a duration greater than zero.",
      },
      values: raw,
    };
  }
  const updateSplits = updateSplitsParsed.data;

  // Same cleaner can't hold two segments (UNIQUE(booking_id, membership_id)) —
  // reject rather than silently drop a segment and undercount their hours.
  {
    const ids = (updateSplits as SplitSegmentInput[])
      .map((s) => s.assigned_to)
      .filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      return {
        errors: {
          _form:
            "Each cleaner can take only one segment of a split shift. Assign a different cleaner to each segment — a split is a hand-off between people, not one person working two separate windows.",
        },
        values: raw,
      };
    }
  }

  const updateEffectiveDuration =
    updateSplits.length > 0
      ? updateSplits.reduce(
          (sum, s) => sum + (Number(s.duration_minutes) || 0),
          0,
        )
      : parsed.data.duration_minutes;

  // When splits are active, align assigned_to to segment 0 (see
  // createBookingAction for the rationale).
  const updateSegmentZeroAssignee = (() => {
    if (updateSplits.length === 0) return null;
    const first = updateSplits[0] as { assigned_to?: string };
    return first?.assigned_to || null;
  })();
  const updateEffectiveAssignedTo =
    updateSplits.length > 0
      ? updateSegmentZeroAssignee
      : (parsed.data.assigned_to ?? null);

  const updateServiceExtras = readServiceExtras(formData);
  // Server-side gate matching createBookingAction: if the service
  // catalog is empty (everything archived) and the user pressed Enter
  // to submit (bypassing the disabled submit button), refuse the
  // update rather than writing service_type_id=NULL and breaking the
  // FK denormalization downstream paths rely on.
  if (!updateServiceExtras.service_type_id) {
    return {
      errors: {
        _form:
          "No services configured. Go to Settings → Services and add at least one before saving this booking.",
      },
      values: raw,
    };
  }
  // IMMUTABILITY: service_type (the legacy enum) is omitted from the
  // UPDATE payload. The form still posts a value (which the recurring
  // propagation paths below need), but we never rewrite this column
  // on a booking once it exists. Re-categorizing a service in
  // Settings → Services could otherwise silently corrupt the historical
  // enum value the next time someone edited an unrelated field. The
  // FK + denormalized label still update so renames + display follow
  // the catalog.
  const { error } = await supabase
    .from("bookings")
    .update({
      client_id: parsed.data.client_id,
      package_id: parsed.data.package_id ?? null,
      assigned_to: updateEffectiveAssignedTo,
      scheduled_at: parsed.data.scheduled_at,
      duration_minutes: parsed.data.duration_minutes,
      service_type_id: updateServiceExtras.service_type_id,
      service_type_label: updateServiceExtras.service_type_label,
      status: parsed.data.status,
      total_cents: parsed.data.total_cents,
      hourly_rate_cents: parsed.data.hourly_rate_cents ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      divide_hours_evenly: parsed.data.divide_hours_evenly,
      splits: updateSplits,
    })
    .eq("id", id);

  if (error) return { errors: { _form: error.message }, values: raw };

  // Replace the booking_assignees rows to match the form's new primary +
  // additional selection. For split shifts, pass the segments array so
  // each employee gets a row with offset/duration.
  await syncBookingAssignees(
    supabase,
    membership.organization_id,
    id,
    updateEffectiveAssignedTo,
    readAdditionalAssignees(formData),
    updateSplits as SplitSegmentInput[],
  );

  // Notify NEW assignees (anyone who wasn't on the booking before).
  // Covers: new primary on a non-split edit, new additional crew added,
  // and any new segment employee on a split edit. Existing crew already
  // know about the job so we don't re-spam them.
  {
    const splitAssigneesForNotify = (updateSplits as SplitSegmentInput[])
      .map((s) => s.assigned_to)
      .filter(Boolean);
    const everyAssignee = Array.from(
      new Set(
        [
          updateEffectiveAssignedTo,
          ...readAdditionalAssignees(formData),
          ...splitAssigneesForNotify,
        ].filter(Boolean) as string[],
      ),
    );
    const newAssignees = everyAssignee.filter(
      (id) => !previousAssigneeIds.has(id),
    );
    for (const mid of newAssignees) {
      const labels = await getBookingLabels(
        supabase,
        parsed.data.client_id,
        mid,
      );
      notifyBookingAssignment(
        membership.organization_id,
        id,
        mid,
        {
          clientName: labels.clientName ?? "A client",
          scheduledAt: parsed.data.scheduled_at,
          serviceType: parsed.data.service_type,
          address: parsed.data.address ?? null,
        },
      );
    }
  }

  // "This and all future" propagation for recurring series.
  // We use the admin client for the bulk update because RLS on bookings can
  // silently drop bulk-UPDATE rows when the series_id column isn't in the
  // policy predicate — org isolation is still enforced via an explicit filter.
  const updateScope = String(formData.get("update_scope") ?? "this_only");
  const seriesId = String(formData.get("series_id") ?? "").trim();
  const seriesScheduledAt = String(formData.get("series_scheduled_at") ?? "").trim();

  if (updateScope === "this_and_future" && seriesId && seriesScheduledAt) {
    const admin = createSupabaseAdminClient();

    // Fields that propagate to future bookings regardless of schedule change.
    // We intentionally do NOT touch scheduled_at or status on siblings —
    // each occurrence keeps its own date and lifecycle.
    //
    // SPLIT-SHIFT NOTES:
    //   - assigned_to uses updateEffectiveAssignedTo so siblings get the
    //     segment-0 employee, matching the edited booking exactly.
    //   - splits is propagated so siblings adopt the same segment
    //     structure. The booking_assignees rows for each sibling are
    //     rebuilt below via syncBookingAssignees so the calendar +
    //     field app actually see the new split shape.
    // IMMUTABILITY (see UPDATE payload above): service_type enum is
    // intentionally excluded from sibling propagation. Each sibling
    // keeps its original enum value. service_type_id and the
    // denormalized label still propagate so renames + display in the
    // service catalog follow through.
    const propagatableFields = {
      duration_minutes: parsed.data.duration_minutes,
      service_type_id: updateServiceExtras.service_type_id,
      service_type_label: updateServiceExtras.service_type_label,
      total_cents: parsed.data.total_cents,
      hourly_rate_cents: parsed.data.hourly_rate_cents ?? null,
      assigned_to: updateEffectiveAssignedTo,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      splits: updateSplits,
    };

    // Check whether the owner is also changing the recurrence schedule.
    // The form signals this by including a hidden `series_update_schedule=1`
    // field, which is only injected when the schedule-edit section is visible.
    const updateSchedule =
      String(formData.get("series_update_schedule") ?? "") === "1";
    let scheduleFields: Record<string, unknown> = {};

    if (updateSchedule) {
      const newPattern = String(formData.get("series_pattern") ?? "").trim();
      const newStartTime = String(formData.get("series_start_time") ?? "").trim();
      const newStartsAt = String(formData.get("series_starts_at") ?? "").trim();
      const newEndsAt =
        String(formData.get("series_ends_at") ?? "").trim() || null;
      const newCustomDaysRaw = String(
        formData.get("series_custom_days") ?? "",
      ).trim();
      const newMonthlyNthRaw = String(
        formData.get("series_monthly_nth") ?? "",
      ).trim();
      const newMonthlyDowRaw = String(
        formData.get("series_monthly_dow") ?? "",
      ).trim();

      const validPatterns = [
        "weekly", "bi_weekly", "tri_weekly", "quad_weekly", "monthly",
        "custom_weekly", "monthly_nth", "every_2_months", "every_3_months",
        "every_6_months",
      ];

      if (validPatterns.includes(newPattern) && newStartTime && newStartsAt) {
        const parsedCustomDays =
          newPattern === "custom_weekly" && newCustomDaysRaw
            ? newCustomDaysRaw
                .split(",")
                .map(Number)
                .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6)
            : null;
        const parsedMonthlyNth =
          newPattern === "monthly_nth" && newMonthlyNthRaw
            ? Number(newMonthlyNthRaw)
            : null;
        const parsedMonthlyDow =
          newPattern === "monthly_nth" && newMonthlyDowRaw
            ? Number(newMonthlyDowRaw)
            : null;

        scheduleFields = {
          pattern: newPattern,
          start_time: newStartTime,
          starts_at: newStartsAt,
          ends_at: newEndsAt,
          custom_days: parsedCustomDays,
          monthly_nth: parsedMonthlyNth,
          monthly_dow: parsedMonthlyDow,
        };

        // Labels + assignees + the carried service_type, computed once so
        // both the stale-event teardown and the regenerated-event creation
        // below reuse them.
        const regenLabels = await getBookingLabels(
          supabase,
          parsed.data.client_id,
          updateEffectiveAssignedTo,
        );
        const regenAssignees = Array.from(
          new Set([
            ...(updateEffectiveAssignedTo ? [updateEffectiveAssignedTo] : []),
            ...readAdditionalAssignees(formData),
            ...(updateSplits as SplitSegmentInput[])
              .map((s) => s.assigned_to)
              .filter(Boolean),
          ]),
        ) as string[];
        // Carry the EXISTING booking's service_type enum onto the
        // regenerated siblings — never the form-posted value. Without this,
        // an admin who changes both schedule + service in one save silently
        // rewrites the enum on every regenerated row in the series.
        const seriesServiceTypeEnum = (existing?.service_type ??
          parsed.data.service_type) as ServiceTypeEnum;

        // Tear down the OLD future occurrences' calendar events BEFORE
        // deleting the rows. Otherwise the Google Calendar events orphan at
        // their old times and the reschedule never shows up on the calendar.
        const { data: staleSiblings } = (await admin
          .from("bookings")
          .select("id, google_calendar_event_id")
          .eq("series_id", seriesId)
          .eq("organization_id", membership.organization_id)
          .neq("id", id)
          .gte("scheduled_at", seriesScheduledAt)
          .not("status", "in", '("completed","cancelled")')) as unknown as {
          data: Array<{
            id: string;
            google_calendar_event_id: string | null;
          }> | null;
        };
        for (const sib of staleSiblings ?? []) {
          if (sib.google_calendar_event_id) {
            await deleteCalendarEvent(
              membership.organization_id,
              sib.google_calendar_event_id,
            ).catch((err) =>
              console.error(
                "[gcal] series-reschedule stale cleanup failed:",
                err,
              ),
            );
          }
          // Remove personal-calendar events (no-op when none are connected).
          await syncMemberCalendarEvents(sib.id, [], {
            id: sib.id,
            scheduled_at: seriesScheduledAt,
            duration_minutes: parsed.data.duration_minutes,
            service_type: seriesServiceTypeEnum,
            address: parsed.data.address ?? null,
            notes: parsed.data.notes ?? null,
            client_name: regenLabels.clientName,
          }).catch(() => {});
        }

        // Delete all future pending/confirmed occurrences in the series
        // (excluding the currently-edited booking — it's already updated).
        // The admin client bypasses RLS; org isolation enforced explicitly.
        await (admin
          .from("bookings")
          .delete()
          .eq("series_id", seriesId)
          .eq("organization_id", membership.organization_id)
          .neq("id", id)
          .gte("scheduled_at", seriesScheduledAt)
          .not(
            "status",
            "in",
            '("completed","cancelled")',
          ) as unknown as Promise<unknown>);

        // Generate new occurrences strictly after the current booking's
        // datetime so we don't create a duplicate for today's slot.
        const rule: SeriesRule = {
          pattern: newPattern as SeriesRule["pattern"],
          custom_days: parsedCustomDays,
          start_time: newStartTime,
          starts_at: newStartsAt,
          ends_at: newEndsAt,
          generate_ahead: 52,
          monthly_nth: parsedMonthlyNth,
          monthly_dow: parsedMonthlyDow,
          tz: orgTz,
        };

        const occurrences = generateOccurrences(
          rule,
          8,
          new Date(seriesScheduledAt), // `after` — exclusive, so starts after current booking
        );

        if (occurrences.length > 0) {
          const bookingRows = occurrences.map((scheduled_at) => ({
            organization_id: membership.organization_id,
            client_id: parsed.data.client_id,
            package_id: parsed.data.package_id ?? null,
            // Segment-0 employee for splits; form primary otherwise.
            assigned_to: updateEffectiveAssignedTo,
            scheduled_at,
            duration_minutes: parsed.data.duration_minutes,
            service_type: seriesServiceTypeEnum,
            service_type_id: updateServiceExtras.service_type_id,
            service_type_label: updateServiceExtras.service_type_label,
            status: "confirmed" as const,
            total_cents: parsed.data.total_cents,
            hourly_rate_cents: parsed.data.hourly_rate_cents ?? null,
            address: parsed.data.address ?? null,
            notes: parsed.data.notes ?? null,
            splits: updateSplits,
            series_id: seriesId,
          }));

          const { data: regenerated } = (await admin
            .from("bookings")
            .insert(bookingRows)
            .select("id, scheduled_at") as unknown as {
            data: Array<{ id: string; scheduled_at: string }> | null;
          });

          // Build booking_assignees for ALL regenerated occurrences in a
          // single bulk pass. Doing this per-row would do ~3 sequential
          // round-trips per occurrence and time out on long series.
          const regenRows = regenerated ?? [];
          const regenIds = regenRows.map((r) => r.id);
          if (regenIds.length > 0) {
            await syncBookingAssigneesBulk(
              supabase,
              membership.organization_id,
              regenIds,
              updateEffectiveAssignedTo,
              readAdditionalAssignees(formData),
              updateSplits as SplitSegmentInput[],
            );

            // Create calendar events for each regenerated booking so the
            // rescheduled future occurrences actually land on the org
            // calendar (and any connected personal calendars). Runs in
            // after() so the serverless runtime keeps the function alive
            // until the Google writes finish, instead of freezing right
            // after the redirect and dropping them.
            after(async () => {
              for (const rb of regenRows) {
                await createCalendarEvent(membership.organization_id, {
                  id: rb.id,
                  scheduled_at: rb.scheduled_at,
                  duration_minutes: parsed.data.duration_minutes,
                  service_type: seriesServiceTypeEnum,
                  address: parsed.data.address ?? null,
                  notes: parsed.data.notes ?? null,
                  client_name: regenLabels.clientName,
                  employee_name: regenLabels.employeeName,
                }).catch((err) =>
                  console.error("[gcal] series-reschedule create:", err),
                );
                await syncMemberCalendarEvents(rb.id, regenAssignees, {
                  id: rb.id,
                  scheduled_at: rb.scheduled_at,
                  duration_minutes: parsed.data.duration_minutes,
                  service_type: seriesServiceTypeEnum,
                  address: parsed.data.address ?? null,
                  notes: parsed.data.notes ?? null,
                  client_name: regenLabels.clientName,
                }).catch(() => {});
              }
            });
          }

          console.log(
            `[series-reschedule] regenerated ${occurrences.length} bookings in series ${seriesId}`,
          );
        }
      }
    } else {
      // No schedule change — propagate the field updates to existing future
      // siblings so they stay consistent with the edited booking.
      const { data: siblingIds } = (await admin
        .from("bookings")
        .select("id")
        .eq("series_id", seriesId)
        .eq("organization_id", membership.organization_id)
        .neq("id", id)
        .gte("scheduled_at", seriesScheduledAt)
        .not(
          "status",
          "in",
          '("completed","cancelled")',
        )) as unknown as { data: Array<{ id: string }> | null };

      await (admin
        .from("bookings")
        .update(propagatableFields)
        .eq("series_id", seriesId)
        .eq("organization_id", membership.organization_id)
        .neq("id", id)
        .gte("scheduled_at", seriesScheduledAt)
        .not(
          "status",
          "in",
          '("completed","cancelled")',
        ) as unknown as Promise<unknown>);

      // Rebuild booking_assignees for ALL siblings in a single bulk
      // pass. Per-row sync would do ~3 sequential DB round-trips per
      // sibling and exceed Vercel's action timeout for long series.
      const siblingIdList = (siblingIds ?? []).map((r) => r.id);
      if (siblingIdList.length > 0) {
        await syncBookingAssigneesBulk(
          supabase,
          membership.organization_id,
          siblingIdList,
          updateEffectiveAssignedTo,
          readAdditionalAssignees(formData),
          updateSplits as SplitSegmentInput[],
        );
      }
    }

    // Always keep the series template in sync — both field values and
    // (when changed) the new schedule so the nightly extend cron picks up
    // the right rule for future generations.
    await (admin
      .from("booking_series")
      .update({ ...propagatableFields, ...scheduleFields })
      .eq("id", seriesId)
      .eq("organization_id", membership.organization_id) as unknown as Promise<unknown>);

    console.log(`[series-update] saved changes to series ${seriesId}`);
  }

  // If the scheduled time changed, email the client + push employee
  // (both handled inside sendBookingRescheduled). Compare by INSTANT, not by
  // string: the stored value comes back from Postgres as "…+00:00" while
  // parsed.data.scheduled_at is a toISOString() "…Z" — same moment, different
  // text. A string compare here fired a phantom "rescheduled" notification on
  // every edit-form save (crew/notes changes included).
  if (
    existing?.scheduled_at &&
    new Date(existing.scheduled_at).getTime() !==
      new Date(parsed.data.scheduled_at).getTime()
  ) {
    sendBookingRescheduled(id, existing.scheduled_at);
  }

  // If the status flipped TO cancelled (not already cancelled), push the
  // assigned employee AND email the client.
  if (
    existing?.status !== "cancelled" &&
    parsed.data.status === "cancelled"
  ) {
    notifyBookingCancelledToEmployee(id);
    sendBookingCancelledToClient(id);
  }

  // If the status flipped TO completed from something else, kick off the
  // auto-invoice automation. Previously this only ran when an employee
  // marked a job done from the field app — owners marking a job complete
  // from the admin dashboard got no invoice at all, which looked like
  // the auto-invoice feature was broken. Awaited so the draft invoice is
  // present by the time /app/invoices revalidates below. The automation
  // catches its own errors internally so this won't throw here.
  if (
    existing?.status !== "completed" &&
    parsed.data.status === "completed"
  ) {
    await autoInvoiceOnJobComplete(id);
  }

  // Sync to Google Calendar
  const labels = await getBookingLabels(
    supabase,
    parsed.data.client_id,
    parsed.data.assigned_to ?? null,
  );

  // CANCELLATION HYGIENE: if the booking is now cancelled, remove it
  // from every calendar instead of updating. Cleaners would otherwise
  // see the event survive on their personal Google Calendar and drive
  // to a job that no longer exists.
  if (parsed.data.status === "cancelled") {
    if (existing?.google_calendar_event_id) {
      await deleteCalendarEvent(
        membership.organization_id,
        existing.google_calendar_event_id,
      ).catch((err) =>
        console.error("[gcal] cancel cleanup failed:", err),
      );
      // Clear the stored event ID so a later un-cancel re-creates clean.
      await supabase
        .from("bookings")
        .update({ google_calendar_event_id: null })
        .eq("id", id);
    }
    // Clear member calendar events with awaited cleanup so the mapping
    // rows still exist when the function runs its initial SELECT.
    await syncMemberCalendarEvents(id, [], {
      id,
      scheduled_at: parsed.data.scheduled_at,
      duration_minutes: updateEffectiveDuration,
      service_type: parsed.data.service_type,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      client_name: labels.clientName,
    }).catch((err) =>
      console.error("[gcal/member] cancel cleanup failed:", err),
    );
  } else {
    if (existing?.google_calendar_event_id) {
      // Update existing event
      await updateCalendarEvent(membership.organization_id, {
        id,
        google_calendar_event_id: existing.google_calendar_event_id,
        scheduled_at: parsed.data.scheduled_at,
        duration_minutes: updateEffectiveDuration,
        service_type: parsed.data.service_type,
        address: parsed.data.address ?? null,
        notes: parsed.data.notes ?? null,
        client_name: labels.clientName,
        employee_name: labels.employeeName,
        split_count: new Set(
          (updateSplits as SplitSegmentInput[])
            .map((s) => s.assigned_to)
            .filter(Boolean),
        ).size,
      }).catch((err) => console.error("[gcal] sync error on update:", err));
    } else {
      // No event yet — create one
      await createCalendarEvent(membership.organization_id, {
        id,
        scheduled_at: parsed.data.scheduled_at,
        duration_minutes: updateEffectiveDuration,
        service_type: parsed.data.service_type,
        address: parsed.data.address ?? null,
        notes: parsed.data.notes ?? null,
        client_name: labels.clientName,
        employee_name: labels.employeeName,
        split_count: new Set(
          (updateSplits as SplitSegmentInput[])
            .map((s) => s.assigned_to)
            .filter(Boolean),
        ).size,
      }).catch((err) => console.error("[gcal] sync error on create:", err));
    }

    // Sync to each assigned employee's personal calendar (fire-and-forget).
    {
      const splitAssignees = (updateSplits as SplitSegmentInput[])
        .map((s) => s.assigned_to)
        .filter(Boolean);
      const allAssignees = Array.from(new Set([
        ...(parsed.data.assigned_to ? [parsed.data.assigned_to] : []),
        ...readAdditionalAssignees(formData),
        ...splitAssignees,
      ]));
      syncMemberCalendarEvents(id, allAssignees, {
        id,
        scheduled_at: parsed.data.scheduled_at,
        duration_minutes: updateEffectiveDuration,
        service_type: parsed.data.service_type,
        address: parsed.data.address ?? null,
        notes: parsed.data.notes ?? null,
        client_name: labels.clientName,
      }).catch(() => {});
    }
  }

  revalidatePath("/app/bookings");
  revalidatePath(`/app/bookings/${id}/edit`);
  revalidatePath("/app");
  revalidatePath("/app/invoices");
  redirect("/app/bookings");
}

// ─── Duplicate booking ────────────────────────────────────────────────────────

// Simple cadences that "Make recurring" offers — each is anchored to the
// existing booking's weekday/date, so no extra inputs (custom days, nth
// weekday) are needed.
const MAKE_RECURRING_PATTERNS = new Set([
  "weekly",
  "bi_weekly",
  "tri_weekly",
  "quad_weekly",
  "monthly",
]);

/** Booking UTC time → local YYYY-MM-DD + HH:MM in the org's timezone. */
function utcToOrgLocalParts(
  iso: string,
  tz: string,
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

/**
 * Turn an existing single booking into a recurring series. The booking
 * becomes occurrence #1; future occurrences are generated from its
 * date/time on the chosen cadence. Owner/admin/manager only.
 */
export async function convertBookingToRecurringAction(
  bookingId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "You don't have permission." };
  }

  const pattern = String(formData.get("pattern") ?? "");
  if (!MAKE_RECURRING_PATTERNS.has(pattern)) {
    return { ok: false, error: "Pick a recurrence frequency." };
  }

  const { data: booking } = (await supabase
    .from("bookings")
    .select(
      "id, organization_id, client_id, scheduled_at, duration_minutes, service_type, service_type_id, service_type_label, package_id, assigned_to, total_cents, hourly_rate_cents, address, notes, status, series_id",
    )
    .eq("id", bookingId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      client_id: string;
      scheduled_at: string;
      duration_minutes: number;
      service_type: string;
      service_type_id: string | null;
      service_type_label: string | null;
      package_id: string | null;
      assigned_to: string | null;
      total_cents: number;
      hourly_rate_cents: number | null;
      address: string | null;
      notes: string | null;
      status: string;
      series_id: string | null;
    } | null;
  };

  if (!booking) return { ok: false, error: "Booking not found." };
  if (booking.series_id) {
    return { ok: false, error: "This booking is already part of a series." };
  }
  if (booking.status === "cancelled") {
    return { ok: false, error: "Can't make a cancelled booking recurring." };
  }

  const orgTz = await getOrgTimezone(membership.organization_id);
  const { date: startsAt, time: startTime } = utcToOrgLocalParts(
    booking.scheduled_at,
    orgTz,
  );

  const { data: series, error: seriesErr } = (await supabase
    .from("booking_series")
    .insert({
      organization_id: membership.organization_id,
      client_id: booking.client_id,
      pattern,
      custom_days: null,
      monthly_nth: null,
      monthly_dow: null,
      start_time: startTime,
      starts_at: startsAt,
      ends_at: null,
      generate_ahead: 8,
      duration_minutes: booking.duration_minutes,
      service_type: booking.service_type,
      service_type_id: booking.service_type_id,
      service_type_label: booking.service_type_label,
      package_id: booking.package_id,
      assigned_to: booking.assigned_to,
      total_cents: booking.total_cents,
      hourly_rate_cents: booking.hourly_rate_cents,
      address: booking.address,
      notes: booking.notes,
    } as never)
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (seriesErr || !series) {
    return { ok: false, error: seriesErr?.message ?? "Couldn't create series." };
  }

  // Link the existing booking as the first occurrence.
  await (supabase
    .from("bookings")
    .update({ series_id: series.id } as never)
    .eq("id", bookingId) as unknown as Promise<unknown>);

  // Generate future occurrences strictly after this booking's slot.
  const rule: SeriesRule = {
    pattern: pattern as SeriesRule["pattern"],
    custom_days: null,
    start_time: startTime,
    starts_at: startsAt,
    ends_at: null,
    generate_ahead: 8,
    monthly_nth: null,
    monthly_dow: null,
    tz: orgTz,
  };
  const occurrences = generateOccurrences(rule, 8, new Date(booking.scheduled_at));

  if (occurrences.length > 0) {
    const rows = occurrences.map((scheduled_at) => ({
      organization_id: booking.organization_id,
      client_id: booking.client_id,
      package_id: booking.package_id,
      assigned_to: booking.assigned_to,
      scheduled_at,
      duration_minutes: booking.duration_minutes,
      service_type: booking.service_type as ServiceTypeEnum,
      service_type_id: booking.service_type_id,
      service_type_label: booking.service_type_label,
      status: "confirmed" as const,
      total_cents: booking.total_cents,
      hourly_rate_cents: booking.hourly_rate_cents,
      address: booking.address,
      notes: booking.notes,
      series_id: series.id,
    }));

    const { data: inserted } = (await supabase
      .from("bookings")
      .insert(rows as never)
      .select("id, scheduled_at")) as unknown as {
      data: Array<{ id: string; scheduled_at: string }> | null;
    };
    const newRows = inserted ?? [];
    const newIds = newRows.map((r) => r.id);

    if (newIds.length > 0) {
      await syncBookingAssigneesBulk(
        supabase,
        membership.organization_id,
        newIds,
        booking.assigned_to,
        [],
        [],
      );

      const labels = await getBookingLabels(
        supabase,
        booking.client_id,
        booking.assigned_to,
      );
      after(async () => {
        for (const rb of newRows) {
          await createCalendarEvent(membership.organization_id, {
            id: rb.id,
            scheduled_at: rb.scheduled_at,
            duration_minutes: booking.duration_minutes,
            service_type: booking.service_type,
            address: booking.address,
            notes: booking.notes,
            client_name: labels.clientName,
            employee_name: labels.employeeName,
          }).catch((err) =>
            console.error("[gcal] make-recurring create:", err),
          );
        }
      });
    }
  }

  revalidatePath(`/app/bookings/${bookingId}`);
  revalidatePath("/app/bookings");
  revalidatePath("/app/calendar");
  return { ok: true };
}

/**
 * Create a copy of an existing booking (same client, service, crew, price)
 * with status reset to "pending". Redirects to the new booking's edit page
 * so the owner can adjust the date before confirming.
 */
export async function duplicateBookingAction(id: string) {
  const { membership, supabase } = await getActionContext();

  const { data: source } = (await supabase
    .from("bookings")
    .select(
      "client_id, package_id, assigned_to, scheduled_at, duration_minutes, service_type, service_type_id, service_type_label, total_cents, hourly_rate_cents, address, notes, splits",
    )
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      client_id: string;
      package_id: string | null;
      assigned_to: string | null;
      scheduled_at: string;
      duration_minutes: number;
      service_type: string;
      service_type_id: string | null;
      service_type_label: string | null;
      total_cents: number;
      hourly_rate_cents: number | null;
      address: string | null;
      notes: string | null;
      splits: Json;
    } | null;
  };

  if (!source) return;

  const { data: copy, error } = await supabase
    .from("bookings")
    .insert({
      organization_id: membership.organization_id,
      client_id: source.client_id,
      package_id: source.package_id ?? null,
      assigned_to: source.assigned_to ?? null,
      scheduled_at: source.scheduled_at,
      duration_minutes: source.duration_minutes,
      service_type: source.service_type as ServiceTypeEnum,
      service_type_id: source.service_type_id,
      service_type_label: source.service_type_label,
      status: "pending" as const,
      total_cents: source.total_cents,
      hourly_rate_cents: source.hourly_rate_cents ?? null,
      address: source.address ?? null,
      notes: source.notes ?? null,
      splits: (source.splits ?? []),
    })
    .select("id")
    .single();

  if (error || !copy) return;

  // Mirror the crew assignees — including split-shift segment metadata
  // so a duplicated split booking lands in the same per-segment state
  // as the source, not a degraded multi-crew-no-segments state.
  const { data: assignees } = (await supabase
    .from("booking_assignees")
    .select(
      "membership_id, is_primary, split_index, split_start_offset_minutes, split_duration_minutes",
    )
    .eq("booking_id", id)) as unknown as {
    data: Array<{
      membership_id: string;
      is_primary: boolean;
      split_index: number | null;
      split_start_offset_minutes: number | null;
      split_duration_minutes: number | null;
    }> | null;
  };

  if (assignees && assignees.length > 0) {
    await supabase.from("booking_assignees").insert(
      assignees.map((a) => ({
        booking_id: copy.id,
        membership_id: a.membership_id,
        organization_id: membership.organization_id,
        is_primary: a.is_primary,
        split_index: a.split_index,
        split_start_offset_minutes: a.split_start_offset_minutes,
        split_duration_minutes: a.split_duration_minutes,
      })),
    );
  }

  // Push to Google Calendar (org + per-member) so the duplicate is
  // visible even if the owner never opens the edit page after the
  // redirect. Use the same effective-duration logic as create: sum of
  // segments if splits exist, otherwise the booking's duration.
  {
    const sourceSplits = (Array.isArray(source.splits)
      ? source.splits
      : []) as Array<{ assigned_to?: string; duration_minutes?: number }>;
    const dupEffectiveDuration =
      sourceSplits.length > 0
        ? sourceSplits.reduce(
            (sum, s) => sum + (Number(s.duration_minutes) || 0),
            0,
          )
        : source.duration_minutes;

    const labels = await getBookingLabels(
      supabase,
      source.client_id,
      source.assigned_to ?? null,
    );

    createCalendarEvent(membership.organization_id, {
      id: copy.id,
      scheduled_at: source.scheduled_at,
      duration_minutes: dupEffectiveDuration,
      service_type: source.service_type,
      address: source.address,
      notes: source.notes,
      client_name: labels.clientName,
      employee_name: labels.employeeName,
      split_count: new Set(
        sourceSplits.map((s) => s.assigned_to).filter(Boolean),
      ).size,
    }).catch((err) =>
      console.error("[gcal] sync error on duplicate:", err),
    );

    // Personal calendars for every assignee (segment crew + primary).
    const everyAssignee = Array.from(
      new Set(
        [
          source.assigned_to,
          ...(assignees ?? []).map((a) => a.membership_id),
          ...sourceSplits.map((s) => s.assigned_to ?? null),
        ].filter(Boolean) as string[],
      ),
    );
    syncMemberCalendarEvents(copy.id, everyAssignee, {
      id: copy.id,
      scheduled_at: source.scheduled_at,
      duration_minutes: dupEffectiveDuration,
      service_type: source.service_type,
      address: source.address,
      notes: source.notes,
      client_name: labels.clientName,
    }).catch(() => {});
  }

  revalidatePath("/app/bookings");
  redirect(`/app/bookings/${copy.id}/edit`);
}

// ─── Mark booking complete ────────────────────────────────────────────────────

/**
 * Quick-complete a booking without opening the full edit form.
 * Triggers the same auto-invoice logic as saving via the edit form.
 */
export async function markBookingCompleteAction(id: string) {
  const { membership, supabase } = await getActionContext();

  const { error } = await supabase
    .from("bookings")
    .update({ status: "completed" })
    .eq("id", id)
    .eq("organization_id", membership.organization_id);

  if (error) return;

  await autoInvoiceOnJobComplete(id);

  revalidatePath("/app/bookings");
  revalidatePath(`/app/bookings/${id}`);
  redirect(`/app/bookings/${id}`);
}

export async function deleteBookingAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const cascade = String(formData.get("cascade_series") ?? "") === "true";
  const { membership, supabase } = await getActionContext();

  // Fetch the Google Calendar event ID + series_id before deleting
  const { data: existing } = (await supabase
    .from("bookings")
    .select("google_calendar_event_id, series_id")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      google_calendar_event_id: string | null;
      series_id: string | null;
    } | null;
  };

  // Cascade: delete every booking in this series first, then the series row.
  // We already verified the booking belongs to the user's org via the RLS-
  // bound fetch above. Use the admin client for the bulk delete because
  // RLS on bookings can silently drop bulk-DELETE rows when the filter
  // column (series_id) isn't in the policy's predicate shape — we still
  // enforce org isolation via an explicit .eq("organization_id", ...).
  if (cascade && existing?.series_id) {
    const admin = createSupabaseAdminClient();

    // Collect every Google Calendar event id in the series so we can
    // unsync them after the row delete.
    const { data: siblings } = (await admin
      .from("bookings")
      .select("id, google_calendar_event_id")
      .eq("series_id", existing.series_id)
      .eq(
        "organization_id",
        membership.organization_id,
      )) as unknown as {
      data: Array<{ id: string; google_calendar_event_id: string | null }> | null;
    };

    const { error: delBookingsErr, count: delBookingsCount } = await admin
      .from("bookings")
      .delete({ count: "exact" })
      .eq("series_id", existing.series_id)
      .eq("organization_id", membership.organization_id);
    if (delBookingsErr) {
      console.error(
        "[cascade-delete] bulk booking delete failed:",
        delBookingsErr.message,
      );
      throw delBookingsErr;
    }
    console.log(
      `[cascade-delete] removed ${delBookingsCount ?? 0} bookings from series ${existing.series_id}`,
    );

    const { error: delSeriesErr } = (await admin
      .from("booking_series")
      .delete()
      .eq("id", existing.series_id)
      .eq(
        "organization_id",
        membership.organization_id,
      )) as unknown as { error: { message: string } | null };
    if (delSeriesErr) {
      console.error(
        "[cascade-delete] series row delete failed:",
        delSeriesErr.message,
      );
    }

    // Delete all Google Calendar events for the series in parallel
    // (org-level + per-member personal calendars). MUST complete before
    // the booking rows are deleted, otherwise the cascade nukes
    // booking_member_calendar_events rows that hold the event IDs we
    // need to call DELETE on Google with.
    await Promise.all([
      ...(siblings ?? [])
        .filter((sib) => sib.google_calendar_event_id)
        .map((sib) =>
          deleteCalendarEvent(
            membership.organization_id,
            sib.google_calendar_event_id!,
          ).catch((err) =>
            console.error("[gcal] sync error on cascade delete:", err),
          ),
        ),
      // Clear all member calendar events for every sibling (awaited).
      ...(siblings ?? []).map((sib) =>
        syncMemberCalendarEvents(sib.id, [], {
          id: sib.id,
          scheduled_at: "",
          duration_minutes: 0,
          service_type: "",
          address: null,
          notes: null,
        }).catch(() => {}),
      ),
    ]);
  } else {
    // Single-booking delete. CRITICAL: clean up personal calendar events
    // BEFORE deleting the booking row. booking_member_calendar_events has
    // ON DELETE CASCADE on booking_id — if the booking row goes first,
    // the mapping rows holding the GCal event IDs vanish and the events
    // are orphaned on each cleaner's personal calendar forever.
    await syncMemberCalendarEvents(id, [], {
      id,
      scheduled_at: "",
      duration_minutes: 0,
      service_type: "",
      address: null,
      notes: null,
    }).catch((err) =>
      console.error("[gcal/member] cleanup failed on delete:", err),
    );

    const { error } = await supabase
      .from("bookings")
      .delete()
      .eq("id", id)
      .eq("organization_id", membership.organization_id);
    if (error) throw error;

    if (existing?.google_calendar_event_id) {
      await deleteCalendarEvent(
        membership.organization_id,
        existing.google_calendar_event_id,
      ).catch((err) => console.error("[gcal] sync error on delete:", err));
    }
  }

  revalidatePath("/app/bookings");
  revalidatePath("/app/bookings/series");
  revalidatePath("/app");
  redirect("/app/bookings");
}

/**
 * Skip a single recurring occurrence: add its date to the series'
 * skip_dates array AND delete this particular booking row. The nightly
 * extend cron will not regenerate this date; everything past it keeps
 * going as normal.
 */
export async function skipBookingOccurrenceAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();

  const { data: booking } = (await supabase
    .from("bookings")
    .select("series_id, scheduled_at, google_calendar_event_id")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      series_id: string | null;
      scheduled_at: string;
      google_calendar_event_id: string | null;
    } | null;
  };

  if (!booking || !booking.series_id) return;

  // Key the skip on the occurrence's ORG-LOCAL calendar date — that's what
  // recurrence.isSkipped compares against (it reads the local Y/M/D of the
  // generator's cursor). Using scheduled_at.slice(0,10) stored the UTC date,
  // which for an evening booking in a negative-offset TZ is the NEXT day and
  // never matched, so the nightly cron kept regenerating the skipped job.
  const orgTz = await getOrgTimezone(membership.organization_id);
  const skipDate = new Date(booking.scheduled_at).toLocaleDateString("en-CA", {
    timeZone: orgTz,
  }); // YYYY-MM-DD in the org's timezone

  // Pull the current skip_dates, append if not already there, write back.
  const { data: seriesRow } = (await supabase
    .from("booking_series")
    .select("skip_dates")
    .eq("id", booking.series_id)
    .maybeSingle()) as unknown as {
    data: { skip_dates: string[] | null } | null;
  };

  const existingSkips = seriesRow?.skip_dates ?? [];
  if (!existingSkips.includes(skipDate)) {
    await (supabase
      .from("booking_series")
      .update({ skip_dates: [...existingSkips, skipDate] })
      .eq("id", booking.series_id)
      .eq(
        "organization_id",
        membership.organization_id,
      ) as unknown as Promise<unknown>);
  }

  // Delete this occurrence.
  await supabase
    .from("bookings")
    .delete()
    .eq("id", id)
    .eq("organization_id", membership.organization_id);

  if (booking.google_calendar_event_id) {
    deleteCalendarEvent(
      membership.organization_id,
      booking.google_calendar_event_id,
    ).catch((err) =>
      console.error("[gcal] sync error on skip-occurrence:", err),
    );
  }

  // Also remove from any assigned employees' personal calendars.
  syncMemberCalendarEvents(id, [], {
    id,
    scheduled_at: "",
    duration_minutes: 0,
    service_type: "",
    address: null,
    notes: null,
  }).catch(() => {});

  revalidatePath("/app/bookings");
  revalidatePath("/app");
  redirect("/app/bookings");
}

/**
 * Cancel all future bookings in a series and deactivate the series.
 *
 * Cleans up Google Calendar events (org + per-member) for every
 * cancelled occurrence so cleaners don't see ghost jobs on their phones.
 */
export async function cancelSeriesAction(formData: FormData) {
  const seriesId = String(formData.get("series_id") ?? "");
  if (!seriesId) return;

  const { membership, supabase } = await getActionContext();
  const now = new Date().toISOString();

  // Deactivate the series — explicit org filter guards against series_id
  // spoofing even though the supabase client applies RLS.
  await (supabase
    .from("booking_series")
    .update({ active: false })
    .eq("id", seriesId)
    .eq("organization_id", membership.organization_id) as unknown as Promise<unknown>);

  // Pull the affected occurrences FIRST so we have their event IDs.
  // After the status flip the booking rows still exist but their GCal
  // events need explicit DELETE calls — calendar API knows nothing about
  // booking.status.
  const { data: affected } = (await supabase
    .from("bookings")
    .select("id, google_calendar_event_id")
    .eq("series_id", seriesId)
    .eq("organization_id", membership.organization_id)
    .in("status", ["pending", "confirmed"])
    .gte("scheduled_at", now)) as unknown as {
    data: Array<{ id: string; google_calendar_event_id: string | null }> | null;
  };

  // Flip status to cancelled.
  await (supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("series_id", seriesId)
    .eq("organization_id", membership.organization_id)
    .in("status", ["pending", "confirmed"])
    .gte("scheduled_at", now) as unknown as Promise<unknown>);

  // Delete the corresponding calendar events. Order matters: the booking
  // rows still exist (cancelled, not deleted), so booking_member_calendar_events
  // mapping rows survive — syncMemberCalendarEvents(_, [], _) walks them
  // and issues DELETEs to each member's personal calendar.
  if (affected && affected.length > 0) {
    await Promise.all([
      ...affected
        .filter((r) => r.google_calendar_event_id)
        .map((r) =>
          deleteCalendarEvent(
            membership.organization_id,
            r.google_calendar_event_id!,
          ).catch((err) =>
            console.error("[gcal] cancel-series cleanup failed:", err),
          ),
        ),
      ...affected.map((r) =>
        syncMemberCalendarEvents(r.id, [], {
          id: r.id,
          scheduled_at: "",
          duration_minutes: 0,
          service_type: "",
          address: null,
          notes: null,
        }).catch((err) =>
          console.error("[gcal/member] cancel-series cleanup failed:", err),
        ),
      ),
    ]);

    // Clear stored event IDs so a later un-cancel re-creates cleanly.
    await supabase
      .from("bookings")
      .update({ google_calendar_event_id: null })
      .in(
        "id",
        affected.map((r) => r.id),
      )
      .eq("organization_id", membership.organization_id);
  }

  revalidatePath("/app/bookings");
  revalidatePath("/app");
  redirect("/app/bookings");
}

/**
 * Force-generate the draft invoice for a booking. Used by the
 * "Generate invoice now" button on the booking detail page when the
 * auto-run didn't produce one (migration not applied, automation
 * toggle off, or any other silent failure).
 *
 * Returns a useActionState-style result so the button can render the
 * success/error message inline. Bypasses the isAutomationEnabled
 * gate via `force: true` — if the owner clicks the button, they've
 * explicitly asked for the invoice.
 */
export type GenerateInvoiceState = {
  error?: string;
  ok?: boolean;
  invoiceId?: string;
  invoiceNumber?: string | null;
};

export async function generateInvoiceFromBookingAction(
  _prev: GenerateInvoiceState,
  formData: FormData,
): Promise<GenerateInvoiceState> {
  const id = String(formData.get("booking_id") ?? "");
  if (!id) return { error: "Missing booking id." };

  const { membership } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { error: "Only owners, admins, or managers can generate invoices." };
  }

  const result = await autoInvoiceOnJobComplete(id, { force: true });
  if (!result.ok) return { error: result.reason };

  revalidatePath(`/app/bookings/${id}`);
  revalidatePath("/app/invoices");
  return {
    ok: true,
    invoiceId: result.invoiceId,
    invoiceNumber: result.number,
  };
}

/**
 * Assign one or more cleaners to a booking from a quick-action popup
 * — primary goes on bookings.assigned_to, additional crew goes into
 * booking_assignees. Both the scheduling quick-view dialog and the
 * bookings list row-actions use this so the owner can triage crew
 * without jumping into the full edit form.
 *
 * Notifies the new primary when assigned_to actually changes
 * (matching the flow in updateBookingAction — same automation key).
 *
 * Accepts FormData with:
 *   - id              — booking id
 *   - primary_id      — membership id to set as assigned_to ("" = unassigned)
 *   - additional_ids  — one or more membership ids for the junction
 */
export type AssignCrewState = {
  error?: string;
  ok?: boolean;
};

export async function assignBookingCrewAction(
  _prev: AssignCrewState,
  formData: FormData,
): Promise<AssignCrewState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing booking id." };

  const rawPrimary = String(formData.get("primary_id") ?? "").trim();
  const primaryId = rawPrimary === "" ? null : rawPrimary;
  const additionalIds = formData
    .getAll("additional_ids")
    .map((v) => String(v))
    .filter((v) => v.length > 0 && v !== primaryId);

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { error: "Only owners, admins, or managers can assign crew." };
  }

  // Read the existing assignee so we can detect a primary change
  // and fire notifyBookingAssignment if needed. Also fetch `splits` so we
  // can detect split-shift bookings and refuse to wipe their segment data.
  const { data: existing } = (await supabase
    .from("bookings")
    .select(
      "assigned_to, scheduled_at, duration_minutes, service_type, address, notes, splits, client:clients ( name )",
    )
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      assigned_to: string | null;
      scheduled_at: string;
      duration_minutes: number;
      service_type: string;
      address: string | null;
      notes: string | null;
      splits: Array<{ assigned_to?: string; duration_minutes?: number }> | null;
      client: { name: string | null } | null;
    } | null;
  };
  if (!existing) return { error: "Booking not found." };

  // SPLIT-SHIFT GUARD: the quick-assign popup has no way to express
  // segment-aware assignments. Refuse to mutate so we don't destroy
  // existing split data. The owner must use the full edit form to
  // change a split booking's crew.
  if (Array.isArray(existing.splits) && existing.splits.length > 0) {
    return {
      error:
        "This is a split-shift booking. Open it in the full editor to change crew assignments.",
    };
  }

  // Flip primary on the booking row first.
  if (primaryId !== existing.assigned_to) {
    const { error: updErr } = await supabase
      .from("bookings")
      .update({ assigned_to: primaryId })
      .eq("id", id);
    if (updErr) return { error: updErr.message };
  }

  await syncBookingAssignees(
    supabase,
    membership.organization_id,
    id,
    primaryId,
    additionalIds,
    [], // no splits from the quick-assign crew dialog (guarded above)
  );

  // Update personal calendars for all newly assigned members (and remove
  // events for unassigned ones). Fire-and-forget.
  if (existing) {
    const allAssignees = [primaryId, ...additionalIds].filter(Boolean) as string[];
    syncMemberCalendarEvents(id, allAssignees, {
      id,
      scheduled_at: existing.scheduled_at,
      duration_minutes: existing.duration_minutes,
      service_type: existing.service_type,
      address: existing.address,
      notes: existing.notes,
      client_name: existing.client?.name ?? undefined,
    }).catch(() => {});
  }

  // Refresh the ORG-level Google Calendar event description so the
  // "Assigned to: <name>" line names the NEW cleaner, not the old one.
  // Quick-assign previously left this stale.
  if (primaryId !== existing.assigned_to) {
    const { data: gcal } = (await supabase
      .from("bookings")
      .select("google_calendar_event_id")
      .eq("id", id)
      .maybeSingle()) as unknown as {
      data: { google_calendar_event_id: string | null } | null;
    };
    if (gcal?.google_calendar_event_id) {
      const labels = await getBookingLabels(
        supabase,
        // Quick-assign doesn't change the client; look it up from existing
        (await supabase
          .from("bookings")
          .select("client_id")
          .eq("id", id)
          .maybeSingle()).data?.client_id ?? "",
        primaryId,
      );
      updateCalendarEvent(membership.organization_id, {
        id,
        google_calendar_event_id: gcal.google_calendar_event_id,
        scheduled_at: existing.scheduled_at,
        duration_minutes: existing.duration_minutes,
        service_type: existing.service_type,
        address: existing.address,
        notes: existing.notes,
        client_name: labels.clientName,
        employee_name: labels.employeeName,
      }).catch((err) =>
        console.error("[gcal] quick-assign event refresh failed:", err),
      );
    }
  }

  // Fire the assignment notification when the primary actually
  // changed. Fire-and-forget — never block the dialog on it.
  if (primaryId && primaryId !== existing.assigned_to) {
    notifyBookingAssignment(
      membership.organization_id,
      id,
      primaryId,
      {
        clientName: existing.client?.name ?? "A client",
        scheduledAt: existing.scheduled_at,
        serviceType: existing.service_type,
        address: existing.address ?? null,
      },
    );
  }

  // "This and all future" propagation for recurring series.
  // Uses the admin client so the bulk update isn't silently dropped by
  // RLS. Org isolation is enforced via explicit .eq("series_id") +
  // the bookings table's own organization_id FK chain.
  const updateScope = String(formData.get("update_scope") ?? "this_only");
  const seriesId = String(formData.get("series_id") ?? "").trim();
  const seriesScheduledAt = String(
    formData.get("series_scheduled_at") ?? "",
  ).trim();

  if (updateScope === "this_and_future" && seriesId && seriesScheduledAt) {
    const admin = createSupabaseAdminClient();

    // Collect all future sibling IDs so we can sync their assignees.
    // organization_id filter is explicit because the admin client bypasses RLS.
    const { data: siblings } = await (admin
      .from("bookings")
      .select("id")
      .eq("series_id", seriesId)
      .eq("organization_id", membership.organization_id)
      .gte("scheduled_at", seriesScheduledAt)
      .neq("id", id)
      .not(
        "status",
        "in",
        '("completed","cancelled")',
      )) as unknown as { data: Array<{ id: string }> | null };

    const siblingIds = (siblings ?? []).map((s) => s.id);

    if (siblingIds.length > 0) {
      // Bulk-update assigned_to on all future siblings.
      await (admin
        .from("bookings")
        .update({ assigned_to: primaryId })
        .in("id", siblingIds)) as unknown as Promise<unknown>;

      // Replace booking_assignees for each sibling so additional crew
      // propagates consistently with the current booking.
      await (admin
        .from("booking_assignees")
        .delete()
        .in(
          "booking_id",
          siblingIds,
        )) as unknown as Promise<unknown>;

      const assigneeRows: Array<{
        organization_id: string;
        booking_id: string;
        membership_id: string;
        is_primary: boolean;
      }> = siblingIds.flatMap((bId) => {
        const rows: typeof assigneeRows = [];
        if (primaryId) {
          rows.push({
            organization_id: membership.organization_id,
            booking_id: bId,
            membership_id: primaryId,
            is_primary: true,
          });
        }
        for (const aId of additionalIds) {
          rows.push({
            organization_id: membership.organization_id,
            booking_id: bId,
            membership_id: aId,
            is_primary: false,
          });
        }
        return rows;
      });

      if (assigneeRows.length > 0) {
        await (admin
          .from("booking_assignees")
          .insert(assigneeRows)) as unknown as Promise<unknown>;
      }
    }

    // Update the series template row so newly-generated occurrences
    // inherit the new primary assignee. Admin client bypasses RLS so we
    // must filter by organization_id explicitly.
    await (admin
      .from("booking_series")
      .update({ assigned_to: primaryId })
      .eq("id", seriesId)
      .eq("organization_id", membership.organization_id)) as unknown as Promise<unknown>;
  }

  revalidatePath("/app/bookings");
  revalidatePath(`/app/bookings/${id}`);
  revalidatePath("/app/scheduling");
  revalidatePath("/app");
  return { ok: true };
}

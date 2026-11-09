"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { redirectBack } from "@/lib/return-to";
import {
  futureStatusError,
  allowedTransitionsFor,
  WRITABLE_BOOKING_STATUSES,
  WRITABLE_BOOKING_STATUS_LIST,
  type WritableBookingStatus,
  invoiceDraftDueOnEdit,
  bookingTermsChange,
} from "@/lib/booking-status";
import {
  lifecycleByAssignee,
  withPriorLifecycle,
  type AssigneeLifecycle,
} from "@/lib/crew-sync";
import { resolveSegmentWindows } from "@/lib/booking-segments";
import { crewFromForm } from "@/lib/series-crew";
import { after } from "next/server";
import { syncJob } from "@/lib/job-sync";
import { closeJob } from "@/lib/close-job";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { readServiceExtras } from "@/lib/service-extras";
import { can } from "@/lib/auth";
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
  deleteMemberCalendarEventById,
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
import { zonedYmd } from "@/lib/wall-clock";
import { wallClockColumns } from "@/lib/scheduled-local";
import { runtimeKnowsZone } from "@/lib/tz-probe";
import { resolveSeriesMove } from "@/lib/series-move";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { redirectAfterSetup } from "@/lib/setup-return";
import { logAuditEvent } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { formatDateTime } from "@/lib/format";
import { occurrenceDate } from "@/lib/client-job-requests";
import {
  detectCardNumber,
  CARD_DETECTED_MESSAGE,
} from "@/lib/card-detection";

type Field = keyof typeof BookingSchema.shape;
export type BookingFormState = ActionState<Field & string>;

function readFormValues(formData: FormData) {
  return {
    client_id: String(formData.get("client_id") ?? ""),
    assigned_to: String(formData.get("assigned_to") ?? ""),
    scheduled_at: String(formData.get("scheduled_at") ?? ""),
    duration_minutes: String(formData.get("duration_minutes") ?? ""),
    service_type: String(formData.get("service_type") ?? "standard"),
    status: String(formData.get("status") ?? "confirmed"),
    total_cents: String(formData.get("total_cents") ?? ""),
    address: String(formData.get("address") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    divide_hours_evenly: String(formData.get("divide_hours_evenly") ?? ""),
    is_free: String(formData.get("is_free") ?? ""),
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
/**
 * Which of the client's properties this job is at.
 *
 * Read here rather than in the Zod schema for the same reason as
 * readServiceExtras above: a caller that does not ship the field — the client
 * portal request form, an older cached page — must not fail validation. Absent
 * means null, and null is exactly what every single-property client produces.
 *
 * NOT trusted as-is. The value arrives from a browser and points at a row that
 * carries door codes, so every write path passes it through
 * propertyBelongsToClient() below before it reaches the database.
 */
function readPropertyId(formData: FormData): string | null {
  const id = String(formData.get("property_id") ?? "").trim();
  return id.length > 0 ? id : null;
}

/**
 * A property id from a form is only usable if it belongs to the client being
 * booked, in the caller's org. Without this check a forged id would attach one
 * tenant's job to another tenant's address — and the composite FK would not
 * catch it, because it only proves the property and the booking share an org,
 * not that they share a client.
 *
 * Returns null for anything that fails, so a bad id degrades to "no property"
 * rather than rejecting the save. The address the user sees is still written.
 */
/** The client must be this workspace's. The database enforces it too (a
 *  trigger since 2026-09-13); this is the sentence the form shows. */
async function clientBelongsToOrg(clientId: string, organizationId: string): Promise<boolean> {
  const { data } = (await createSupabaseAdminClient()
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("organization_id", organizationId)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  return Boolean(data);
}

async function propertyBelongsToClient(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  propertyId: string | null,
  clientId: string,
  organizationId: string,
): Promise<string | null> {
  if (!propertyId) return null;
  const { data } = (await admin
    .from("client_properties" as never)
    .select("id")
    .eq("id" as never, propertyId as never)
    .eq("client_id" as never, clientId as never)
    .eq("organization_id" as never, organizationId as never)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  return data ? propertyId : null;
}

function readRecurringFormValues(formData: FormData) {
  return {
    client_id: String(formData.get("client_id") ?? ""),
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

type SplitSegmentInput = {
  assigned_to: string;
  duration_minutes: number;
  /** Minutes after the booking start. Absent on segments saved before
   *  2026-10-02, which fall back to cumulative — see lib/booking-segments.ts. */
  start_offset_minutes?: number;
};

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
type BookingAssigneeSyncRow = {
  organization_id: string;
  booking_id: string;
  membership_id: string;
  is_primary: boolean;
  split_index: number | null;
  split_start_offset_minutes: number | null;
  split_duration_minutes: number | null;
};
type BookingAssigneeSyncRowWithLifecycle = BookingAssigneeSyncRow &
  AssigneeLifecycle;

async function syncBookingAssignees(
  supabase: Awaited<
    ReturnType<
      typeof import("@/lib/supabase/server").createSupabaseServerClient
    >
  >,
  organizationId: string,
  bookingId: string,
  primaryId: string | null,
  additionalIds: string[],
  splits?: SplitSegmentInput[],
  bookingPatch?: Record<string, Json>,
): Promise<string | null>;
async function syncBookingAssignees(
  supabase: Awaited<
    ReturnType<
      typeof import("@/lib/supabase/server").createSupabaseServerClient
    >
  >,
  organizationId: string,
  bookingId: string,
  primaryId: string | null,
  additionalIds: string[],
  splits: SplitSegmentInput[],
  bookingPatch: Record<string, Json>,
  buildOnly: true,
): Promise<BookingAssigneeSyncRowWithLifecycle[] | string>;
async function syncBookingAssignees(
  supabase: Awaited<
    ReturnType<
      typeof import("@/lib/supabase/server").createSupabaseServerClient
    >
  >,
  organizationId: string,
  bookingId: string,
  primaryId: string | null,
  additionalIds: string[],
  splits: SplitSegmentInput[] = [],
  bookingPatch: Record<string, Json> = {},
  buildOnly = false,
): Promise<
  | string
  | null
  | BookingAssigneeSyncRowWithLifecycle[]
> {
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

  // Preserve crew lifecycle while the database replaces the booking and crew
  // together in one transaction.
  const { data: priorRows } = (await supabase
    .from("booking_assignees")
    .select(
      "organization_id, booking_id, membership_id, is_primary, split_index, split_start_offset_minutes, split_duration_minutes, acceptance_status, responded_at, completed_at",
    )
    .eq("booking_id", bookingId)) as unknown as {
    data: Array<Record<string, unknown>> | null;
  };

  /*
   * Crew rows are rebuilt from the form on every save, so a member already on
   * the job came back as a BRAND NEW row — acceptance reset to pending,
   * completed_at wiped. See src/lib/crew-sync.ts for why those three columns
   * are not the form's to own.
   */
  const priorLifecycle = lifecycleByAssignee(priorRows);

  const rows: BookingAssigneeSyncRow[] = [];

  if (safeSplits.length > 0) {
    // Per-cleaner windows: derive booking_assignees from the segments array.
    // Each segment carries its own start offset, so windows may overlap, run
    // end-to-end, or leave a gap. Segments saved before 2026-10-02 have no
    // offset and fall back to cumulative — see lib/booking-segments.ts.
    const resolved = resolveSegmentWindows(safeSplits);
    const seen = new Set<string>();
    resolved.forEach((seg) => {
      if (!seg.assigned_to || seen.has(seg.assigned_to)) return;
      seen.add(seg.assigned_to);
      rows.push({
        organization_id: organizationId,
        booking_id: bookingId,
        membership_id: seg.assigned_to,
        is_primary: seg.index === 0,
        split_index: seg.index,
        split_start_offset_minutes: seg.start_offset_minutes,
        split_duration_minutes: seg.duration_minutes,
      });
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

  const updatedRows = rows.map((row) => withPriorLifecycle(row, priorLifecycle));
  if (buildOnly) return updatedRows;

  const { error: insertErr } = await createSupabaseAdminClient().rpc(
    "update_booking_assignments_v2",
    {
      p_organization_id: organizationId,
      p_booking_ids: [bookingId],
      p_booking_patch: bookingPatch,
      p_assignees: updatedRows,
    },
  );
  if (insertErr) {
    // The RPC transaction preserves both the booking and its prior crew.
    // Returned, not thrown. A throw here escaped the action and Next rendered
    // the generic error boundary — so the one message that says WHY the save
    // failed reached nobody, and the owner saw "An unexpected error occurred"
    // with a digest only the server logs can decode. The reason belongs on the
    // form, next to the field the person was editing.
    const operation = Object.keys(bookingPatch).length
      ? "booking and crew"
      : "crew";
    return `Couldn't update the ${operation}: ${insertErr.message}`;
  }

  return null;
}

/**
 * Bulk variant of syncBookingAssignees for `this_and_future` series
 * updates. Validates memberships once, then replaces booking fields and
 * assignees in a single database transaction.
 *
 * The per-booking version did 3 sequential round-trips per sibling
 * (validate, delete, insert). The transaction RPC keeps the bulk path
 * constant-time and rolls every row back if any assignment conflicts.
 *
 * Behavior contract matches syncBookingAssignees: when splits is
 * non-empty, the segments array drives the rows (with additionalIds
 * appended as non-split crew); otherwise primary + additional.
 */
async function syncBookingAssigneesBulk(
  supabase: Awaited<
    ReturnType<
      typeof import("@/lib/supabase/server").createSupabaseServerClient
    >
  >,
  organizationId: string,
  bookingIds: string[],
  primaryId: string | null,
  additionalIds: string[],
  splits: SplitSegmentInput[] = [],
  bookingPatch: Record<string, Json> = {},
): Promise<string | null> {
  if (bookingIds.length === 0) return null;

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

  // Snapshot lifecycle per (booking, member) before the wipe — same reason as
  // the single-booking path: acceptance and completion belong to the person on
  // the job, not to the form being re-saved. A "this and future" series edit
  // otherwise re-asked every cleaner to confirm every remaining occurrence.
  const { data: priorBulk } = (await supabase
    .from("booking_assignees")
    .select(
      "booking_id, membership_id, acceptance_status, responded_at, completed_at",
    )
    .in("booking_id", bookingIds)) as unknown as {
    data: Array<Record<string, unknown>> | null;
  };
  const priorBulkLifecycle = lifecycleByAssignee(priorBulk);

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
      // Same per-cleaner window rule as syncBookingAssignees above.
      const resolved = resolveSegmentWindows(safeSplits);
      const seen = new Set<string>();
      resolved.forEach((seg) => {
        if (!seg.assigned_to || seen.has(seg.assigned_to)) return;
        seen.add(seg.assigned_to);
        out.push({
          organization_id: organizationId,
          booking_id: bookingId,
          membership_id: seg.assigned_to,
          is_primary: seg.index === 0,
          split_index: seg.index,
          split_start_offset_minutes: seg.start_offset_minutes,
          split_duration_minutes: seg.duration_minutes,
        });
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
  const { error: bulkErr } = await createSupabaseAdminClient().rpc(
    "update_booking_assignments_v2",
    {
      p_organization_id: organizationId,
      p_booking_ids: bookingIds,
      p_booking_patch: bookingPatch,
      p_assignees: allRows.map((row) =>
        withPriorLifecycle(row, priorBulkLifecycle),
      ),
    },
  );
  if (bulkErr) {
    const operation = Object.keys(bookingPatch).length
      ? "future bookings and crew"
      : "crew on the future bookings";
    return `Couldn't update the ${operation}: ${bulkErr.message}`;
  }

  return null;
}

/**
 * Look up human-readable names for the client and assigned employee so
 * the Google Calendar event has a useful title/description.
 */
async function getBookingLabels(
  supabase: Awaited<
    ReturnType<
      typeof import("@/lib/supabase/server").createSupabaseServerClient
    >
  >,
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

  // Validated before it touches a payload: the id came from a browser and
  // points at a row holding door codes, so it must be proved to belong to
  // THIS client in THIS org. A bad id degrades to null rather than failing
  // the save — the address the user typed is still written either way.
  const propertyId = await propertyBelongsToClient(
    createSupabaseAdminClient(),
    readPropertyId(formData),
    parsed.data.client_id,
    membership.organization_id,
  );
  if (!(await clientBelongsToOrg(parsed.data.client_id, membership.organization_id))) {
    return { errors: { client_id: "Pick a client from this workspace." }, values: raw };
  }


  // Re-interpret the datetime-local string using the org's timezone.
  // BookingSchema's transform used FALLBACK_TZ (falls back to a reasonable
  // default but can drift for orgs outside Eastern). Rewriting here uses
  // the authoritative per-org timezone.
  const orgTz = await getOrgTimezone(membership.organization_id);
  parsed.data.scheduled_at = localInputToUtcIso(raw.scheduled_at, orgTz);
  if (!runtimeKnowsZone(orgTz)) {
    // Converting a typed time into an instant needs this zone's rules for
    // that date. On stale rules the visit lands an hour off and nothing on
    // screen says so (Alberta, 2026-11-01). Refuse rather than store it.
    return {
      errors: {
        _form:
          "This server's time zone rules are out of date, so the booking time can't be saved reliably right now. Tell Brian.",
      },
      values: raw,
    };
  }

  {
    const err = futureStatusError(parsed.data.scheduled_at, parsed.data.status);
    if (err) return { errors: { status: err }, values: raw };
  }

  // Past dates are allowed — owners regularly need to back-fill historical
  // jobs when they're onboarding, switching from another tool, catching up
  // on last month, or reconstructing records. We intentionally do not
  // reject past scheduled_at. A previous version of this guard blocked
  // pending/confirmed/en_route status in the past to catch typos, but the
  // cost to legitimate catch-up use was too high. If the UI needs a soft
  // "are you sure?" for date-typo protection in the future, do it
  // client-side so it's an advisory, not a gate.

  if (!(await canCreateData(membership.organization_id))) {
    return {
      errors: {
        _form:
          "Your subscription has expired. Subscribe to create new bookings.",
      },
      values: raw,
    };
  }

  // Parse + validate split segments. Empty array = no split shift.
  // Invalid input (missing assigned_to, zero/negative duration, segments
  // without a UUID) is rejected with a form error rather than silently
  // accepted — previously the action would save a booking with
  // assigned_to="" and no crew notifications.
  const splitsJson = String(formData.get("splits") ?? "[]");
  let splitsRaw: unknown[] = [];
  try {
    splitsRaw = JSON.parse(splitsJson);
  } catch {
    splitsRaw = [];
  }
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
      ? splits.reduce((sum, s) => sum + (Number(s.duration_minutes) || 0), 0)
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
    splits.length > 0 ? segmentZeroAssignee : (parsed.data.assigned_to ?? null);

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
      assigned_to: effectiveAssignedTo,
      scheduled_at: parsed.data.scheduled_at,
      // The time as typed, in the org's zone: the truth scheduled_at is
      // derived from (scheduled-local.ts).
      ...wallClockColumns(raw.scheduled_at, orgTz),
      duration_minutes: parsed.data.duration_minutes,
      service_type: parsed.data.service_type,
      service_type_id: serviceExtras.service_type_id,
      service_type_label: serviceExtras.service_type_label,
      status: parsed.data.status,
      // Created as already done (a back-filled past job): that is a
      // person saying it's over, and closed_at is how the rules hear it.
      // Without it the first recompute would read "no shifts, window
      // open" and put the row back to confirmed.
      ...(parsed.data.status === "completed"
        ? { closed_at: new Date().toISOString(), closed_by: membership.id }
        : {}),
      // A free clean is zero by definition — trust the flag over a stale
      // number left in the box when the checkbox was ticked.
      total_cents: parsed.data.is_free ? 0 : parsed.data.total_cents,
      address: parsed.data.address ?? null,
      property_id: propertyId,
      notes: parsed.data.notes ?? null,
      divide_hours_evenly: parsed.data.divide_hours_evenly,
      is_free: parsed.data.is_free,
      splits: splits,
    })
    .select("id")
    .single();

  if (error) return { errors: { _form: error.message }, values: raw };

  // Additional crew (if any) — write to booking_assignees so the primary
  // + extras are all tracked consistently. For split shifts, pass the
  // segments array so each employee gets a row with offset/duration.
  const crewErr = await syncBookingAssignees(
    supabase,
    membership.organization_id,
    booking.id,
    effectiveAssignedTo,
    readAdditionalAssignees(formData),
    splits as SplitSegmentInput[],
  );
  if (crewErr) {
    const { error: cleanupErr } = await createSupabaseAdminClient()
      .from("bookings")
      .delete()
      .eq("id", booking.id)
      .eq("organization_id", membership.organization_id);
    return {
      errors: {
        _form: cleanupErr
          ? `${crewErr} The booking could not be removed after the crew save failed: ${cleanupErr.message}`
          : crewErr,
      },
      values: raw,
    };
  }

  // Email booking confirmation to client (fire-and-forget) — unless the
  // booking is Pending. sendBookingConfirmation never reads status, so an
  // unguarded call would email AND text the client "Booking confirmed" for a
  // job the owner just explicitly marked unconfirmed. Leaving pending is the
  // confirmation event; updateBookingAction sends it there.
  if (parsed.data.status !== "pending") {
    sendBookingConfirmation(booking.id);
  }

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
      notifyBookingAssignment(membership.organization_id, booking.id, mid, {
        clientName: labels.clientName ?? "A client",
        scheduledAt: parsed.data.scheduled_at,
        serviceType: parsed.data.service_type,
        address: parsed.data.address ?? null,
      });
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
    const allAssignees = Array.from(
      new Set([
        ...(parsed.data.assigned_to ? [parsed.data.assigned_to] : []),
        ...readAdditionalAssignees(formData),
        ...splitAssignees,
      ]),
    );
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

  // Scheduling work for someone means they said yes — promote them out of the
  // leads list so nobody has to remember to.
  const { convertLeadOnBooking } = await import("@/lib/lead-conversion");
  await convertLeadOnBooking(parsed.data.client_id);

  // Booking created via "Create booking" on a portal request → the booking
  // IS the response. Mark the request scheduled and link it, so it leaves
  // the Requests badge without a second manual "Mark scheduled" click.
  // Only claims a still-pending row: a request someone else already
  // declined or handled keeps its answer.
  const fromRequestId = String(formData.get("from_request") ?? "");
  if (fromRequestId) {
    const { error: reqErr } = await createSupabaseAdminClient()
      .from("booking_requests" as never)
      .update({
        status: "scheduled",
        booking_id: booking.id,
        responded_at: new Date().toISOString(),
        responded_by: membership.id,
      } as never)
      .eq("id" as never, fromRequestId as never)
      .eq("organization_id" as never, membership.organization_id as never)
      .eq("status" as never, "pending" as never)
      // The owner can retarget the form to a different client before
      // saving — that booking is NOT this request's answer, so the
      // request must stay pending rather than silently claim it.
      .eq("client_id" as never, parsed.data.client_id as never);
    if (reqErr) {
      console.error(
        "[booking] mark request scheduled failed:",
        reqErr.message,
      );
    }
    revalidatePath("/app/bookings/requests");
  }

  // "Book this job" from an estimate: stamp the link, so the estimate
  // page shows converted and nobody wonders whether the quote landed.
  // Same guards as the request claim — org-scoped, and the estimate must
  // belong to the client this booking was actually saved for.
  const fromEstimateId = String(formData.get("estimate_id") ?? "");
  if (fromEstimateId) {
    const estAdmin = createSupabaseAdminClient();
    const { data: est } = (await estAdmin
      .from("estimates")
      .select("client_id")
      .eq("id", fromEstimateId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle()) as unknown as { data: { client_id: string } | null };
    // Only when the estimate is real AND still matches the client the
    // booking was actually saved for — retargeting the form to a
    // different client must not claim the quote.
    if (est && est.client_id === parsed.data.client_id) {
      const { error: estErr } = await estAdmin
        .from("bookings")
        .update({ estimate_id: fromEstimateId } as never)
        .eq("id", booking.id)
        .eq("organization_id", membership.organization_id);
      if (estErr) {
        console.error("[booking] estimate link failed:", estErr.message);
      }
      revalidatePath("/app/estimates");
    }
  }

  revalidatePath("/app/bookings");
  revalidatePath("/app/calendar");
  revalidatePath("/app");
  revalidatePath("/app/leads");

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
  if (!parsed.ok)
    return { errors: parsed.errors as BookingFormState["errors"], values: raw };

  const { membership, supabase } = await getActionContext();

  // Validated before it touches a payload: the id came from a browser and
  // points at a row holding door codes, so it must be proved to belong to
  // THIS client in THIS org. A bad id degrades to null rather than failing
  // the save — the address the user typed is still written either way.
  const propertyId = await propertyBelongsToClient(
    createSupabaseAdminClient(),
    readPropertyId(formData),
    parsed.data.client_id,
    membership.organization_id,
  );
  if (!(await clientBelongsToOrg(parsed.data.client_id, membership.organization_id))) {
    return { errors: { client_id: "Pick a client from this workspace." }, values: raw };
  }


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
      errors: {
        _form:
          "Select at least one day of the week for custom weekly scheduling.",
      },
      values: raw,
    };
  }

  // Validate monthly_nth inputs
  if (
    parsed.data.recurrence_pattern === "monthly_nth" &&
    (parsed.data.monthly_nth == null || parsed.data.monthly_dow == null)
  ) {
    return {
      errors: {
        _form:
          "Pick both an ordinal (1st, 2nd, etc.) and a weekday for monthly scheduling.",
      },
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
      custom_days:
        parsed.data.recurrence_pattern === "custom_weekly"
          ? parsed.data.custom_days
          : null,
      monthly_nth:
        parsed.data.recurrence_pattern === "monthly_nth"
          ? (parsed.data.monthly_nth ?? null)
          : null,
      monthly_dow:
        parsed.data.recurrence_pattern === "monthly_nth"
          ? (parsed.data.monthly_dow ?? null)
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
      assigned_to: parsed.data.assigned_to ?? null,
      total_cents: parsed.data.total_cents,
      address: parsed.data.address ?? null,
      property_id: propertyId,
      notes: parsed.data.notes ?? null,
      // The whole crew, not just the selected cleaner, so the series can
      // extend with everyone on it. See lib/series-crew.ts. Spread through
      // `object` because `crew` is newer than the generated types — this keeps
      // every OTHER field above type-checked, which a cast on the whole
      // insert would quietly switch off.
      ...({
        crew: crewFromForm({
          primaryId: parsed.data.assigned_to ?? null,
          additionalIds: readAdditionalAssignees(formData),
          splits: [],
        }),
      } as object),
    })
    .select("id")
    .single() as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  });

  if (seriesErr || !series) {
    return {
      errors: { _form: seriesErr?.message ?? "Failed to create series" },
      values: raw,
    };
  }

  const cleanupFailedSeries = async () => {
    const admin = createSupabaseAdminClient();
    const cleanupErrors: string[] = [];
    const { error: bookingsDeleteErr } = await admin
      .from("bookings")
      .delete()
      .eq("organization_id", membership.organization_id)
      .eq("series_id", series.id);
    if (bookingsDeleteErr) cleanupErrors.push(bookingsDeleteErr.message);
    const { error: seriesDeleteErr } = await admin
      .from("booking_series")
      .delete()
      .eq("id", series.id)
      .eq("organization_id", membership.organization_id);
    if (seriesDeleteErr) cleanupErrors.push(seriesDeleteErr.message);
    return cleanupErrors;
  };

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

  const occurrences = generateOccurrences(
    rule,
    parsed.data.generate_ahead,
    null,
  );

  if (occurrences.length === 0) {
    // The template was inserted above; without visits it is an active series
    // the nightly extender can never pick up (it needs a latest visit to count
    // from). Take it back out rather than leave it.
    await supabase.from("booking_series").delete().eq("id", series.id);
    return {
      errors: {
        _form:
          "No occurrences could be generated from the recurrence rule. Check your start date and days.",
      },
      values: raw,
    };
  }

  // 3. Insert all booking instances (recurringServiceExtras declared above)
  const bookingRows = occurrences.map((scheduled_at) => ({
    organization_id: membership.organization_id,
    client_id: parsed.data.client_id,
    assigned_to: parsed.data.assigned_to ?? null,
    scheduled_at,
    // The series' own words for this visit — its date at its start time.
    ...wallClockColumns(`${zonedYmd(new Date(scheduled_at), orgTz)}T${parsed.data.start_time}`, orgTz),
    duration_minutes: parsed.data.duration_minutes,
    service_type: parsed.data.service_type,
    service_type_id: recurringServiceExtras.service_type_id,
    service_type_label: recurringServiceExtras.service_type_label,
    status: "confirmed" as const,
    total_cents: parsed.data.total_cents,
    address: parsed.data.address ?? null,
    property_id: propertyId,
    notes: parsed.data.notes
      ? `[Recurring] ${parsed.data.notes}`
      : "[Recurring]",
    series_id: series.id,
  }));

  // ignoreDuplicates against bookings_series_occurrence_uidx: the nightly
  // extend cron racing this exact window could otherwise double-insert the
  // same dates. Skipped rows are excluded from the returned set, so the
  // crew/calendar follow-ups below only touch what this call created.
  const { data: insertedBookings, error: bookingsErr } = await (supabase
    .from("bookings")
    .upsert(bookingRows, {
      onConflict: "series_id,scheduled_at",
      ignoreDuplicates: true,
    })
    .select("id, scheduled_at") as unknown as {
    data: { id: string; scheduled_at: string }[] | null;
    error: { message: string } | null;
  });

  if (bookingsErr) {
    const cleanupErrors = await cleanupFailedSeries();
    return {
      errors: {
        _form: cleanupErrors.length
          ? `${bookingsErr.message} Cleanup also failed: ${cleanupErrors.join("; ")}`
          : bookingsErr.message,
      },
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
      const seriesCrewErr = await syncBookingAssignees(
        supabase,
        membership.organization_id,
        b.id,
        parsed.data.assigned_to ?? null,
        additionalIds,
        [],
      );
      if (seriesCrewErr) {
        const cleanupErrors = await cleanupFailedSeries();
        return {
          errors: {
            _form: cleanupErrors.length
              ? `${seriesCrewErr} Cleanup also failed: ${cleanupErrors.join("; ")}`
              : seriesCrewErr,
          },
          values: raw,
        };
      }
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
        }).catch((err) => console.error("[gcal] recurring create:", err));
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

  // Tell the assigned cleaner about the new series — one push for the FIRST
  // occurrence (N pushes would be spam; the calendar sync carries the rest).
  // Recurring creation previously notified no one (audit B8), unlike
  // single-booking create.
  const firstOccurrence = insertedBookings?.[0];
  if (parsed.data.assigned_to && firstOccurrence) {
    const { data: clientRow } = (await supabase
      .from("clients")
      .select("name")
      .eq("id", parsed.data.client_id)
      .maybeSingle()) as unknown as { data: { name: string | null } | null };
    notifyBookingAssignment(
      membership.organization_id,
      firstOccurrence.id,
      parsed.data.assigned_to,
      {
        clientName: clientRow?.name ?? "A client",
        scheduledAt: firstOccurrence.scheduled_at,
        serviceType: parsed.data.service_type,
        address: parsed.data.address ?? null,
      },
    ).catch((e) =>
      console.error("[auto] recurring-create assignment notify failed:", e),
    );
  }

  // A recurring booking is the strongest possible "yes" — same promotion.
  const { convertLeadOnBooking: convertOnRecurring } = await import(
    "@/lib/lead-conversion"
  );
  await convertOnRecurring(parsed.data.client_id);

  // Same request-resolution as the single-booking path: a series created
  // from "Create booking" on a portal request answers it too. Bug-hunt
  // find — toggling Recurring on that form used to leave the request
  // pending forever. Linked to the earliest occurrence.
  {
    const seriesFromRequest = String(formData.get("from_request") ?? "");
    const earliest = [...(insertedBookings ?? [])].sort((a, b) =>
      a.scheduled_at < b.scheduled_at ? -1 : 1,
    )[0];
    if (seriesFromRequest && earliest) {
      const { error: reqErr } = await createSupabaseAdminClient()
        .from("booking_requests" as never)
        .update({
          status: "scheduled",
          booking_id: earliest.id,
          responded_at: new Date().toISOString(),
          responded_by: membership.id,
        } as never)
        .eq("id" as never, seriesFromRequest as never)
        .eq("organization_id" as never, membership.organization_id as never)
        .eq("status" as never, "pending" as never)
        .eq("client_id" as never, parsed.data.client_id as never);
      if (reqErr) {
        console.error(
          "[booking] mark request scheduled (series) failed:",
          reqErr.message,
        );
      }
      revalidatePath("/app/bookings/requests");
    }
  }

  revalidatePath("/app/bookings");
  revalidatePath("/app/calendar");
  revalidatePath("/app");
  revalidatePath("/app/leads");

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
  // The single-row update below fails SILENTLY for unauthorized roles (RLS
  // filters to 0 rows, no error), after which execution would still reach
  // the ADMIN-client series propagation — letting a field employee rewrite
  // prices, assignee, and schedule across a whole series. Gate up front.
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return {
      errors: { _form: "You don't have permission to edit bookings." },
      values: raw,
    };
  }

  // Validated before it touches a payload: the id came from a browser and
  // points at a row holding door codes, so it must be proved to belong to
  // THIS client in THIS org. A bad id degrades to null rather than failing
  // the save — the address the user typed is still written either way.
  const propertyId = await propertyBelongsToClient(
    createSupabaseAdminClient(),
    readPropertyId(formData),
    parsed.data.client_id,
    membership.organization_id,
  );
  if (!(await clientBelongsToOrg(parsed.data.client_id, membership.organization_id))) {
    return { errors: { client_id: "Pick a client from this workspace." }, values: raw };
  }


  // Re-interpret datetime-local with the org's tz (see createBookingAction).
  const orgTz = await getOrgTimezone(membership.organization_id);
  parsed.data.scheduled_at = localInputToUtcIso(raw.scheduled_at, orgTz);
  if (!runtimeKnowsZone(orgTz)) {
    // Converting a typed time into an instant needs this zone's rules for
    // that date. On stale rules the visit lands an hour off and nothing on
    // screen says so (Alberta, 2026-11-01). Refuse rather than store it.
    return {
      errors: {
        _form:
          "This server's time zone rules are out of date, so the booking time can't be saved reliably right now. Tell Brian.",
      },
      values: raw,
    };
  }

  {
    const err = futureStatusError(parsed.data.scheduled_at, parsed.data.status);
    if (err) return { errors: { status: err }, values: raw };
  }

  // Fetch the existing booking to detect assignee + scheduled_at + status changes.
  // service_type is pulled too so the "this and future" schedule-change
  // path can carry the original enum forward onto regenerated rows —
  // without it, the regenerate path silently rewrites the enum and
  // bypasses the immutability rule the field-only edit path enforces.
  const { data: existing } = (await supabase
    .from("bookings")
    .select(
      "google_calendar_event_id, assigned_to, scheduled_at, status, service_type, total_cents, duration_minutes, is_free",
    )
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      google_calendar_event_id: string | null;
      assigned_to: string | null;
      scheduled_at: string | null;
      status: string | null;
      service_type: string | null;
      total_cents: number | null;
      duration_minutes: number | null;
      is_free: boolean | null;
    } | null;
  };

  // The dropdown proves every move against the same shared rule; this
  // form wrote whatever status the <select> posted. Same door, no lock --
  // completed -> confirmed through here un-completes a job an invoice may
  // already bill, and cancelled -> anything quietly resurrects a booking the
  // client was told is off. Enforce the same table. Same-status saves skip
  // the check so a cancelled booking's notes stay editable.
  if (existing?.status && parsed.data.status !== existing.status) {
    // Judged against the date BEING SAVED, not the one on file. This is the
    // reschedule case exactly: dragging a job into next week and setting it
    // back to Pending is one save, and testing the old date would refuse the
    // move on the strength of where the booking used to be.
    const allowed = allowedTransitionsFor(
      existing.status,
      parsed.data.scheduled_at ?? existing.scheduled_at,
    );
    if (!allowed.includes(parsed.data.status)) {
      return {
        errors: {
          status: `Can't change a ${existing.status.replace("_", " ")} booking to ${parsed.data.status.replace("_", " ")} here.`,
        },
        values: raw,
      };
    }

  }

  // A completed job an invoice bills doesn't leave completed, move, or change
  // its hours or price from under that invoice: its line says when the job
  // was and what it cost. The status half is the twin of the dropdown's
  // guard; the terms half was missing here, in the API and on the scheduler
  // until 2026-11-07.
  if (existing?.status === "completed") {
    const leaves = parsed.data.status !== "completed";
    const moves =
      parsed.data.scheduled_at != null &&
      existing.scheduled_at != null &&
      new Date(parsed.data.scheduled_at).getTime() !== new Date(existing.scheduled_at).getTime();
    const repriced =
      (parsed.data.total_cents != null && parsed.data.total_cents !== existing.total_cents) ||
      (parsed.data.duration_minutes != null && parsed.data.duration_minutes !== existing.duration_minutes);
    if (leaves || moves || repriced) {
      const { resolveBilledBookings, billedRefusal } = await import("@/lib/billed-bookings");
      const billed = await resolveBilledBookings(supabase, [id]);
      const refusal = billedRefusal(
        billed.get(id),
        leaves ? "change the booking's status" : "change this job's time, hours or price",
      );
      if (refusal) return { errors: { [leaves ? "status" : "_form"]: refusal }, values: raw };
    }
  }

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
  try {
    updateSplitsRaw = JSON.parse(updateSplitsJson);
  } catch {
    updateSplitsRaw = [];
  }
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
  const bookingPatch: Record<string, Json> = {
    client_id: parsed.data.client_id,
    assigned_to: updateEffectiveAssignedTo,
    scheduled_at: parsed.data.scheduled_at,
    ...wallClockColumns(raw.scheduled_at, orgTz),
    duration_minutes: parsed.data.duration_minutes,
    service_type_id: updateServiceExtras.service_type_id,
    service_type_label: updateServiceExtras.service_type_label,
    status: parsed.data.status,
    // The human close, kept in step with the status picked on the form:
    // newly completed closes it now, leaving completed reopens it, and
    // an already-closed job keeps its original close.
    ...(parsed.data.status === "completed"
      ? existing?.status === "completed"
        ? {}
        : { closed_at: new Date().toISOString(), closed_by: membership.id }
      : { closed_at: null, closed_by: null }),
    total_cents: parsed.data.is_free ? 0 : parsed.data.total_cents,
    address: parsed.data.address ?? null,
    property_id: propertyId,
    notes: parsed.data.notes ?? null,
    divide_hours_evenly: parsed.data.divide_hours_evenly,
    is_free: parsed.data.is_free,
    splits: updateSplits,
  };
  const updateScope = String(formData.get("update_scope") ?? "this_only");
  const seriesId = String(formData.get("series_id") ?? "").trim();
  const seriesScheduledAt = String(
    formData.get("series_scheduled_at") ?? "",
  ).trim();
  const isSeriesPropagation =
    updateScope === "this_and_future" && !!seriesId && !!seriesScheduledAt;

  if (!isSeriesPropagation) {
    const updateCrewErr = await syncBookingAssignees(
      supabase,
      membership.organization_id,
      id,
      updateEffectiveAssignedTo,
      readAdditionalAssignees(formData),
      updateSplits as SplitSegmentInput[],
      bookingPatch,
    );
    if (updateCrewErr) return { errors: { _form: updateCrewErr }, values: raw };
  }

  // The edit form asks the owner whether the client should hear about a
  // time change ("Save & notify client" / "Save without notifying" — the
  // client's channel preference decides email vs text vs both). Absent
  // field = paths without the dialog ⇒ notify, preserving old behavior.
  const notifyClient = String(formData.get("notify_client") ?? "") !== "0";
  const syncEditedBookingCalendar = async () => {
    const labels = await getBookingLabels(
      supabase,
      parsed.data.client_id,
      parsed.data.assigned_to ?? null,
    );

    if (parsed.data.status === "cancelled") {
      if (existing?.google_calendar_event_id) {
        await deleteCalendarEvent(
          membership.organization_id,
          existing.google_calendar_event_id,
        ).catch((err) => console.error("[gcal] cancel cleanup failed:", err));
        await supabase
          .from("bookings")
          .update({ google_calendar_event_id: null })
          .eq("id", id);
      }
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
      return;
    }

    if (existing?.google_calendar_event_id) {
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
            .map((split) => split.assigned_to)
            .filter(Boolean),
        ).size,
      }).catch((err) => console.error("[gcal] sync error on update:", err));
    } else {
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
            .map((split) => split.assigned_to)
            .filter(Boolean),
        ).size,
      }).catch((err) => console.error("[gcal] sync error on create:", err));
    }

    const splitAssignees = (updateSplits as SplitSegmentInput[])
      .map((split) => split.assigned_to)
      .filter(Boolean);
    const allAssignees = Array.from(
      new Set([
        ...(parsed.data.assigned_to ? [parsed.data.assigned_to] : []),
        ...readAdditionalAssignees(formData),
        ...splitAssignees,
      ]),
    );
    syncMemberCalendarEvents(id, allAssignees, {
      id,
      scheduled_at: parsed.data.scheduled_at,
      duration_minutes: updateEffectiveDuration,
      service_type: parsed.data.service_type,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      client_name: labels.clientName,
    }).catch(() => {});
  };

  // "This and all future" propagation for recurring series.
  // We use the admin client for the bulk update because RLS on bookings can
  // silently drop bulk-UPDATE rows when the series_id column isn't in the
  // policy predicate — org isolation is still enforced via an explicit filter.
  if (isSeriesPropagation) {
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
      assigned_to: updateEffectiveAssignedTo,
      address: parsed.data.address ?? null,
      property_id: propertyId,
      notes: parsed.data.notes ?? null,
      splits: updateSplits,
    };

    // Check whether the owner is also changing the recurrence schedule.
    // The form signals this by including a hidden `series_update_schedule=1`
    // field, which is only injected when the schedule-edit section is visible.
    const updateScheduleRaw =
      String(formData.get("series_update_schedule") ?? "") === "1";

    // NO-OP DETECTION. The section being VISIBLE is not the schedule being
    // CHANGED: saving with "this and future" and an untouched schedule used
    // to delete + regenerate every future occurrence (new row ids, calendar
    // churn) and then email the client a "reschedule" whose old and new
    // times were identical — Brian hit exactly this doing a live demo.
    // Identical rule ⇒ plain field propagation, nothing destroyed, nobody
    // emailed.
    let updateSchedule = updateScheduleRaw;

    // Did THIS visit move to a different day? With "this and all future",
    // that is a schedule change in itself: the rest of the series should
    // follow it. Moving Helena Lane's Thu Nov 12 visit to Wed Nov 11 changed
    // nothing else on the form, so the save read as "same rule" and left
    // every later visit on Thursday.
    const editedOldDate = seriesScheduledAt
      ? zonedYmd(new Date(seriesScheduledAt), orgTz)
      : "";
    const seriesMove = resolveSeriesMove({
      oldDate: editedOldDate,
      newDate: zonedYmd(new Date(parsed.data.scheduled_at), orgTz),
      postedStartsAt: String(formData.get("series_starts_at") ?? "").trim(),
    });
    const visitDayMoved = seriesMove.visitDayMoved;

    if (updateScheduleRaw) {
      const probe = {
        pattern: String(formData.get("series_pattern") ?? "").trim(),
        startTime: String(formData.get("series_start_time") ?? "").trim(),
        startsAt: String(formData.get("series_starts_at") ?? "").trim(),
        endsAt: String(formData.get("series_ends_at") ?? "").trim() || null,
        customDays: String(formData.get("series_custom_days") ?? "").trim(),
        monthlyNth: String(formData.get("series_monthly_nth") ?? "").trim(),
        monthlyDow: String(formData.get("series_monthly_dow") ?? "").trim(),
      };
      const { data: currentRule } = (await admin
        .from("booking_series" as never)
        .select(
          "pattern, start_time, starts_at, ends_at, custom_days, monthly_nth, monthly_dow",
        )
        .eq("id" as never, seriesId as never)
        .eq("organization_id" as never, membership.organization_id as never)
        .maybeSingle()) as unknown as {
        data: {
          pattern: string;
          start_time: string | null;
          starts_at: string | null;
          ends_at: string | null;
          custom_days: number[] | null;
          monthly_nth: number | null;
          monthly_dow: number | null;
        } | null;
      };
      if (currentRule) {
        const normTime = (t: string | null) => (t ?? "").slice(0, 5);
        const normDays = (d: number[] | string | null) => {
          const arr = Array.isArray(d)
            ? d
            : String(d ?? "")
                .split(",")
                .map(Number)
                .filter((n) => Number.isFinite(n));
          return [...arr].sort().join(",");
        };
        const normNum = (v: number | string | null) => {
          const n = typeof v === "number" ? v : Number(v);
          return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
        };
        // The form pre-fills "starts" with THIS visit's date — it means
        // "regenerate from here", not a new anchor. Compared only against the
        // series' original start date, it differed on every visit but the
        // first, so a plain this-and-future save (crew, price, notes) rebuilt
        // every future visit — new row ids, calendar churn — and, because the
        // form saw no schedule change, it never asked whether to notify the
        // client. Patrick Hackett's series, 2026-10-07.
        const startsUnchanged =
          String(currentRule.starts_at ?? "") === probe.startsAt ||
          (editedOldDate !== "" && probe.startsAt === editedOldDate);
        const sameRule =
          currentRule.pattern === probe.pattern &&
          normTime(currentRule.start_time) === normTime(probe.startTime) &&
          startsUnchanged &&
          String(currentRule.ends_at ?? "") === String(probe.endsAt ?? "") &&
          normDays(currentRule.custom_days) === normDays(probe.customDays) &&
          normNum(currentRule.monthly_nth) === normNum(probe.monthlyNth) &&
          normNum(currentRule.monthly_dow) === normNum(probe.monthlyDow);
        if (sameRule && !visitDayMoved) updateSchedule = false;
      }
    }
    let scheduleFields: Record<string, unknown> = {};
    const seriesTemplateFields = (): Record<string, unknown> => {
      const fields: Record<string, unknown> = {
        ...propagatableFields,
        ...scheduleFields,
        crew: crewFromForm({
          primaryId: updateEffectiveAssignedTo,
          additionalIds: readAdditionalAssignees(formData),
          splits: updateSplits as SplitSegmentInput[],
        }),
      };
      delete fields.splits;
      return fields;
    };

    if (updateSchedule) {
      const newPattern = String(formData.get("series_pattern") ?? "").trim();
      const newStartTime = String(
        formData.get("series_start_time") ?? "",
      ).trim();
      // Where the visit now is, unless a different start was typed.
      const newStartsAt = seriesMove.startsAt;
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
        "weekly",
        "bi_weekly",
        "tri_weekly",
        "quad_weekly",
        "monthly",
        "custom_weekly",
        "monthly_nth",
        "every_2_months",
        "every_3_months",
        "every_6_months",
      ];

      if (!validPatterns.includes(newPattern) || !newStartTime || !newStartsAt) {
        return {
          errors: {
            _form: "The recurring schedule is incomplete or invalid. Review the frequency, start date, and time.",
          },
          values: raw,
        };
      }

      {
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

        // Capture existing event IDs before the transactional replacement;
        // only remove them after the database accepts the new occurrences.
        const { data: staleSiblings, error: staleSiblingsErr } = (await admin
          .from("bookings")
          .select("id")
          .eq("series_id", seriesId)
          .eq("organization_id", membership.organization_id)
          .neq("id", id)
          .gte("scheduled_at", seriesScheduledAt)
          // Match the transactional replacement — leave live jobs alone.
          .in("status", ["pending", "confirmed"])
          .order("scheduled_at", { ascending: true })) as unknown as {
          data: Array<{ id: string }> | null;
          error: { message: string } | null;
        };
        if (staleSiblingsErr) {
          return {
            errors: {
              _form: `Nothing was saved because future calendar events could not be loaded: ${staleSiblingsErr.message}`,
            },
            values: raw,
          };
        }
        const staleSiblingIds = (staleSiblings ?? []).map((sibling) => sibling.id);
        let staleMemberEvents: Array<{
          booking_id: string;
          membership_id: string;
          google_calendar_event_id: string;
        }> = [];
        if (staleSiblingIds.length > 0) {
          const { data: memberEvents, error: memberEventsErr } = (await admin
            .from("booking_member_calendar_events")
            .select("booking_id, membership_id, google_calendar_event_id")
            .in("booking_id", staleSiblingIds)) as unknown as {
            data: Array<{
              booking_id: string;
              membership_id: string;
              google_calendar_event_id: string;
            }> | null;
            error: { message: string } | null;
          };
          if (memberEventsErr) {
            return {
              errors: {
                _form: `Nothing was saved because future personal calendar events could not be loaded: ${memberEventsErr.message}`,
              },
              values: raw,
            };
          }
          staleMemberEvents = memberEvents ?? [];
        }

        // Generate new occurrences strictly after the edited visit — at its NEW
        // time. Stepping from the old time is what kept Lane on Thursdays
        // after her visit moved to a Wednesday: every later visit was counted
        // from where this one used to be.
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
          new Date(parsed.data.scheduled_at), // `after` — exclusive
        );

        const bookingRows = occurrences.map((scheduled_at) => ({
          client_id: parsed.data.client_id,
          // Segment-0 employee for splits; form primary otherwise.
          assigned_to: updateEffectiveAssignedTo,
          scheduled_at,
          duration_minutes: parsed.data.duration_minutes,
          service_type: seriesServiceTypeEnum,
          service_type_id: updateServiceExtras.service_type_id,
          service_type_label: updateServiceExtras.service_type_label,
          status: "confirmed" as const,
          total_cents: parsed.data.total_cents,
          address: parsed.data.address ?? null,
          property_id: propertyId,
          notes: parsed.data.notes ?? null,
          splits: updateSplits,
        }));

        // This transaction replaces rows and their crew together. Schedule
        // trigger failures roll it all back, leaving the old occurrences in
        // place; external calendar events are removed only after it commits.
        const currentAssignees = await syncBookingAssignees(
          supabase,
          membership.organization_id,
          id,
          updateEffectiveAssignedTo,
          readAdditionalAssignees(formData),
          updateSplits as SplitSegmentInput[],
          {},
          true,
        );
        if (typeof currentAssignees === "string") {
          return {
            errors: { _form: currentAssignees },
            values: raw,
          };
        }

        const { data: replacementRows, error: regenerationErr } = await admin.rpc(
          "update_booking_series_with_assignees",
          {
            p_organization_id: membership.organization_id,
            p_series_id: seriesId,
            p_current_booking_id: id,
            p_from: seriesScheduledAt,
            p_current_booking_patch: bookingPatch,
            p_current_assignees: currentAssignees as unknown as Json,
            p_sibling_booking_patch: propagatableFields as Json,
            p_series_patch: seriesTemplateFields() as Json,
            p_replace_schedule: true,
            p_booking_rows: bookingRows,
            p_additional_assignee_ids: readAdditionalAssignees(formData),
          },
        );
        if (regenerationErr) {
          return {
            errors: {
              _form: `Nothing was saved because the recurring update failed: ${regenerationErr.message}`,
            },
            values: raw,
          };
        }

        const allReplacementRows = replacementRows ?? [];
        const regenRows = allReplacementRows.filter(
          (row) => row.operation === "inserted",
        );
        const deletedSiblings = allReplacementRows
          .filter((row) => row.operation === "deleted")
          .sort(
            (left, right) =>
              new Date(left.scheduled_at).getTime() -
              new Date(right.scheduled_at).getTime(),
          );
        const deletedSiblingIds = new Set(
          deletedSiblings.map((sibling) => sibling.id),
        );

        for (const sib of deletedSiblings) {
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
        }
        for (const event of staleMemberEvents) {
          if (!deletedSiblingIds.has(event.booking_id)) continue;
          await deleteMemberCalendarEventById(
            event.membership_id,
            event.google_calendar_event_id,
          )
            .then((deleted) => {
              if (!deleted) {
                console.error(
                  "[gcal/member] stale series event could not be deleted:",
                  event.google_calendar_event_id,
                );
              }
            })
            .catch((err) =>
              console.error("[gcal/member] stale series cleanup failed:", err),
            );
        }

        // Create calendar events for each regenerated booking so the
        // rescheduled future occurrences actually land on the org calendar
        // (and any connected personal calendars).
        if (regenRows.length > 0) {
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

        // Audit B6: if the edited occurrence's own time did NOT change, the
        // reschedule notice further down never fires — the client's future
        // visits all silently moved. Announce ONE representative move: the
        // first regenerated occurrence (new time) vs the first deleted
        // sibling (old time). sendBookingRescheduled applies the client's
        // notification preference + org toggles internally.
        const editedTimeUnchanged =
          existing?.scheduled_at &&
          new Date(existing.scheduled_at).getTime() ===
            new Date(parsed.data.scheduled_at).getTime();
        const firstNew = regenRows[0];
        const firstOldAt = deletedSiblings[0]?.scheduled_at ?? null;
        if (
          editedTimeUnchanged &&
          firstNew &&
          firstOldAt &&
          new Date(firstNew.scheduled_at).getTime() !==
            new Date(firstOldAt).getTime() &&
          notifyClient
        ) {
          sendBookingRescheduled(firstNew.id, firstOldAt);
        }
      }
    } else {
      const currentAssignees = await syncBookingAssignees(
        supabase,
        membership.organization_id,
        id,
        updateEffectiveAssignedTo,
        readAdditionalAssignees(formData),
        updateSplits as SplitSegmentInput[],
        {},
        true,
      );
      if (typeof currentAssignees === "string") {
        return { errors: { _form: currentAssignees }, values: raw };
      }

      const { data: updatedRows, error: seriesUpdateErr } = await admin.rpc(
        "update_booking_series_with_assignees",
        {
          p_organization_id: membership.organization_id,
          p_series_id: seriesId,
          p_current_booking_id: id,
          p_from: seriesScheduledAt,
          p_current_booking_patch: bookingPatch,
          p_current_assignees: currentAssignees as unknown as Json,
          p_sibling_booking_patch: propagatableFields as Json,
          p_series_patch: seriesTemplateFields() as Json,
          p_replace_schedule: false,
          p_booking_rows: [],
          p_additional_assignee_ids: readAdditionalAssignees(formData),
        },
      );
      if (seriesUpdateErr) {
        return {
          errors: {
            _form: `Nothing was saved because the recurring update failed: ${seriesUpdateErr.message}`,
          },
          values: raw,
        };
      }
      for (const sibling of updatedRows ?? []) {
        if (
          sibling.status === "in_progress" ||
          sibling.status === "en_route"
        ) {
          await syncJob(sibling.id, "edit_form");
        }
      }
    }

    console.log(`[series-update] saved changes to series ${seriesId}`);
  }

  if (existing?.status && parsed.data.status !== existing.status) {
    await logAuditEvent({
      membership,
      action: "status_change",
      entity: "booking",
      entity_id: id,
      before: { status: existing.status },
      after: { status: parsed.data.status, via: "edit_form" },
    });
  }

  const termsChange = existing
    ? bookingTermsChange(existing, {
        duration_minutes: parsed.data.duration_minutes,
        total_cents: parsed.data.is_free ? 0 : parsed.data.total_cents,
        is_free: parsed.data.is_free,
      })
    : null;
  if (termsChange) {
    await logAuditEvent({
      membership,
      action: "terms_change",
      entity: "booking",
      entity_id: id,
      before: termsChange.before,
      after: { ...termsChange.after, via: "edit_form" },
    });
  }

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
    (assigneeId) => !previousAssigneeIds.has(assigneeId),
  );
  for (const assigneeId of newAssignees) {
    const labels = await getBookingLabels(
      supabase,
      parsed.data.client_id,
      assigneeId,
    );
    notifyBookingAssignment(membership.organization_id, id, assigneeId, {
      clientName: labels.clientName ?? "A client",
      scheduledAt: parsed.data.scheduled_at,
      serviceType: parsed.data.service_type,
      address: parsed.data.address ?? null,
    });
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
    // Re-arm the day-before reminder for the NEW date. The reminder is
    // "at most once ever" via client_reminder_sent_at — without clearing it,
    // a booking that was already reminded and then moved out weeks never got
    // a reminder for its new date (audit B5).
    // A person set this time. The series-drift check (series-drift.ts) leaves
    // such a visit alone instead of asking whether to restore the series'.
    await supabase
      .from("bookings")
      .update({ client_reminder_sent_at: null, time_set_by_hand_at: new Date().toISOString() } as never)
      .eq("id", id)
      .eq("organization_id", membership.organization_id);
    // Not for a booking the client has never been told about. Picking the
    // real date is the whole point of a pending placeholder — the estimate
    // conversion creates one — so "your job has been moved" would be the
    // first thing the client ever heard about it.
    if (existing.status !== "pending" && notifyClient) {
      sendBookingRescheduled(id, existing.scheduled_at);
    }
  }

  // Leaving Pending is the moment the client should hear about the job.
  // createBookingAction stays silent for a pending booking, and this is the
  // only other caller of sendBookingConfirmation in the codebase — without
  // this branch a booking that starts pending is never announced at all.
  // Scoped to pending → confirmed specifically: knocking a pending row
  // straight to completed must not email a client about a job already done.
  // Safe if it somehow runs twice — the automation dedupes on
  // confirmation_email_sent_at / confirmation_sms_sent_at.
  if (existing?.status === "pending" && parsed.data.status === "confirmed") {
    sendBookingConfirmation(id);
  }

  // If the status flipped TO cancelled (not already cancelled), push the
  // assigned employee AND email the client -- EXCEPT when un-completing.
  // Cancelling a job that already read "completed" is a bookkeeping
  // correction (nobody went, auto-complete lied); texting the client
  // "your cleaning has been cancelled" about a date weeks past would only
  // confuse. Same gate as setBookingStatusAction.
  if (
    existing?.status !== "cancelled" &&
    existing?.status !== "completed" &&
    parsed.data.status === "cancelled"
  ) {
    notifyBookingCancelledToEmployee(id);
    sendBookingCancelledToClient(id);
  }

  // Draft the invoice when this edit calls for it: the status flipped TO
  // completed (owners marking a job done here used to get no invoice at
  // all, which looked like the automation was broken), or a job already
  // done with no price just got one — the "needs a price" answer, which
  // used to leave the invoice to be made by hand. Awaited so the draft is
  // present by the time /app/invoices revalidates below. The automation
  // catches its own errors internally so this won't throw here.
  if (
    invoiceDraftDueOnEdit(
      { status: existing?.status, total_cents: existing?.total_cents },
      {
        status: parsed.data.status,
        total_cents: parsed.data.is_free ? 0 : parsed.data.total_cents,
      },
    )
  ) {
    await autoInvoiceOnJobComplete(id);
  }
  await syncJob(id, "edit_form");

  await syncEditedBookingCalendar();

  revalidatePath("/app/bookings");
  revalidatePath(`/app/bookings/${id}/edit`);
  revalidatePath("/app");
  revalidatePath("/app/invoices");
  // Back to wherever the editor was opened from — the scheduler week, the
  // calendar month, the filtered list — instead of always the bookings list.
  // redirectBack replaces rather than pushes, so the consumed edit page does
  // not sit on the history stack.
  redirectBack(formData, "/app/bookings");
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
      "id, organization_id, client_id, scheduled_at, duration_minutes, service_type, service_type_id, service_type_label, package_id, assigned_to, total_cents, hourly_rate_cents, address, notes, status, series_id, property_id",
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
      property_id: string | null;
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
      // Already proven to belong to this client when the source booking was
      // saved; dropping it here made every "make recurring" series (and all
      // its cron-generated occurrences) propertyless.
      property_id: booking.property_id,
    } as never)
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (seriesErr || !series) {
    return {
      ok: false,
      error: seriesErr?.message ?? "Couldn't create series.",
    };
  }

  const rollbackFailedConversion = async (reason: string) => {
    const admin = createSupabaseAdminClient();
    const cleanupErrors: string[] = [];
    const { error: bookingsDeleteErr } = await admin
      .from("bookings")
      .delete()
      .eq("organization_id", membership.organization_id)
      .eq("series_id", series.id)
      .neq("id", bookingId);
    if (bookingsDeleteErr) cleanupErrors.push(bookingsDeleteErr.message);
    const { error: unlinkErr } = await admin
      .from("bookings")
      .update({ series_id: null } as never)
      .eq("id", bookingId)
      .eq("organization_id", membership.organization_id)
      .eq("series_id", series.id);
    if (unlinkErr) cleanupErrors.push(unlinkErr.message);

    const { error: seriesDeleteErr } = await admin
      .from("booking_series")
      .delete()
      .eq("id", series.id)
      .eq("organization_id", membership.organization_id);
    if (seriesDeleteErr) cleanupErrors.push(seriesDeleteErr.message);

    return cleanupErrors.length
      ? `${reason} Cleanup also failed: ${cleanupErrors.join("; ")}`
      : reason;
  };

  // Link the existing booking as the first occurrence.
  const { error: linkErr } = await supabase
    .from("bookings")
    .update({ series_id: series.id } as never)
    .eq("id", bookingId);
  if (linkErr) {
    return {
      ok: false,
      error: await rollbackFailedConversion(linkErr.message),
    };
  }

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
  const occurrences = generateOccurrences(
    rule,
    8,
    new Date(booking.scheduled_at),
  );

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
      property_id: booking.property_id,
    }));

    // ignoreDuplicates: converting to recurring races the nightly extend
    // cron the moment the series row exists — same-date double inserts
    // must skip, not double-book (and double-invoice).
    const { data: inserted, error: insertErr } = (await supabase
      .from("bookings")
      .upsert(rows as never, {
        onConflict: "series_id,scheduled_at",
        ignoreDuplicates: true,
      })
      .select("id, scheduled_at")) as unknown as {
      data: Array<{ id: string; scheduled_at: string }> | null;
      error: { message: string } | null;
    };
    if (insertErr) {
      return {
        ok: false,
        error: await rollbackFailedConversion(insertErr.message),
      };
    }
    const newRows = inserted ?? [];
    const newIds = newRows.map((r) => r.id);

    if (newIds.length > 0) {
      const newCrewErr = await syncBookingAssigneesBulk(
        supabase,
        membership.organization_id,
        newIds,
        booking.assigned_to,
        [],
        [],
      );
      if (newCrewErr) {
        return {
          ok: false,
          error: await rollbackFailedConversion(newCrewErr),
        };
      }

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


// ─── Mark booking complete ────────────────────────────────────────────────────

/**
 * Quick-complete a booking without opening the full edit form.
 * Triggers the same auto-invoice logic as saving via the edit form.
 */
export async function markBookingCompleteAction(id: string) {
  const { membership, supabase } = await getActionContext();
  // The decision and its side effects live in lib/close-job.ts, shared with
  // the dashboard's "Close it". This action has no error channel — it
  // redirects either way, and the page shows the real status.
  await closeJob({ membership, supabase, bookingId: id });
  revalidatePath("/app/bookings");
  revalidatePath(`/app/bookings/${id}`);
  // Same URL we came from — pushing would add a duplicate history entry.
  redirect(`/app/bookings/${id}`, RedirectType.replace);
}

// ─── Quick status set (bookings-list dropdown) ────────────────────────────────

/**
 * Forward-only transitions offered by the list dropdown. completed + cancelled
 * are terminal (no entry) — reverting a completed booking isn't offered here.
 */

/**
 * Set a booking's status straight from the list. Enforces the forward+cancel
 * state machine and runs the SAME side-effects as the dedicated paths:
 * → completed auto-invoices; → cancelled cleans up the calendar events.
 */
export async function setBookingStatusAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const id = String(formData.get("id") ?? "").trim();
  const target = String(formData.get("status") ?? "").trim();
  if (!id) return { ok: false, error: "Missing booking." };
  // The SHARED list, not a fourth hand-written copy. This one was written
  // before `pending` became writable and never caught up, so the dropdown
  // offered Pending on a future-dated job and this line answered "Invalid
  // status." — while the edit form, which reads the shared list, saved the
  // same change happily. Two doors, two answers.
  if (!(WRITABLE_BOOKING_STATUSES as readonly string[]).includes(target)) {
    return {
      ok: false,
      error: `Invalid status. Allowed: ${WRITABLE_BOOKING_STATUS_LIST}.`,
    };
  }

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const { data: booking } = (await supabase
    .from("bookings")
    .select(
      "id, status, google_calendar_event_id, scheduled_at, duration_minutes, service_type, address, notes, client:clients ( name )",
    )
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      status: string;
      google_calendar_event_id: string | null;
      scheduled_at: string;
      duration_minutes: number;
      service_type: string;
      address: string | null;
      notes: string | null;
      client: { name: string } | null;
    } | null;
  };
  if (!booking) return { ok: false, error: "Booking not found." };

  if (booking.status === target) return { ok: true };

  // Un-completing is allowed, but not out from under an invoice. If a live
  // invoice bills this job, leaving `completed` would have the client charged
  // for a visit the system no longer says happened — the money has to be
  // undone first (void the draft, or refund), then the status follows.
  // ANY exit from completed, not just cancelling: future-dated bookings can
  // now go back to pending/confirmed too, and that is the same hole.
  if (booking.status === "completed" && target !== "completed") {
    const { resolveBilledBookings } = await import("@/lib/billed-bookings");
    const billed = await resolveBilledBookings(supabase, [id]);
    const inv = billed.get(id);
    if (inv) {
      return {
        ok: false,
        error: `Invoice ${inv.number ?? ""} (${inv.status}) bills this job. Void or fix that invoice first, then change the booking's status.`,
      };
    }
  }

  // Judged against WHEN the job sits: a future-dated booking is a plan, so
  // it can go back to any pre-work status. Past ones keep the strict ladder.
  const allowed = allowedTransitionsFor(booking.status, booking.scheduled_at);
  if (!allowed.includes(target)) {
    return {
      ok: false,
      error: `Can't change a ${booking.status.replace("_", " ")} booking to ${target.replace("_", " ")} here.`,
    };
  }

  // The transition table says confirmed → completed is fine, and it is — for a
  // job that has happened. One click here on a job scheduled for next week
  // reproduces a766d848 exactly, and completing also auto-invoices below.
  // scheduled_at is already loaded, so this costs nothing.
  const dateErr = futureStatusError(booking.scheduled_at, target);
  if (dateErr) return { ok: false, error: dateErr };

  const { error } = await supabase
    .from("bookings")
    .update({
      status: target as WritableBookingStatus,
      // Completed by hand is a close; anything else reopens it.
      closed_at: target === "completed" ? new Date().toISOString() : null,
      closed_by: target === "completed" ? membership.id : null,
    } as never)
    .eq("id", id)
    .eq("organization_id", membership.organization_id);
  if (error) return { ok: false, error: error.message };

  // Status is the booking's most consequential field (completed invoices;
  // cancelled notifies people) and this was the one write nobody could
  // trace afterwards.
  await logAuditEvent({
    membership,
    action: "status_change",
    entity: "booking",
    entity_id: id,
    before: { status: booking.status },
    after: { status: target },
  });

  if (target === "completed") {
    await autoInvoiceOnJobComplete(id);
  }
  await syncJob(id, "status_set");
  if (target === "cancelled") {
    // Calendar hygiene — mirror the edit-form cancellation cleanup so a
    // cancelled job doesn't linger on anyone's Google Calendar.
    if (booking.google_calendar_event_id) {
      await deleteCalendarEvent(
        membership.organization_id,
        booking.google_calendar_event_id,
      ).catch((e) => console.error("[gcal] status-cancel cleanup failed:", e));
      await supabase
        .from("bookings")
        .update({ google_calendar_event_id: null })
        .eq("id", id);
    }
    await syncMemberCalendarEvents(id, [], {
      id,
      scheduled_at: booking.scheduled_at,
      duration_minutes: booking.duration_minutes,
      service_type: booking.service_type,
      address: booking.address ?? null,
      notes: booking.notes ?? null,
      client_name: booking.client?.name ?? "",
    }).catch((e) =>
      console.error("[gcal/member] status-cancel cleanup failed:", e),
    );

    // Cancellation notices — the crew push and client notice previously only
    // fired from the edit-form path, so cancelling via this quick dropdown
    // sent NOTHING: the cleaner still drove out, the client was never told
    // (audit B2). Mirrors the edit-form calls; both are internally gated and
    // deduped.
    //
    // EXCEPT when un-completing. These notices exist so a cleaner doesn't
    // drive out and a client isn't left waiting — news about a visit that
    // ISN'T going to happen. A completed job already happened; flipping it to
    // cancelled is correcting the record (July 17: the cleaner was sick,
    // auto-complete stamped it done anyway), and texting the client "your
    // cleaning was cancelled" five weeks after the date would read as
    // nonsense at best and an accidental cancellation of something real at
    // worst. booking.status still holds the PRE-update status here.
    if (booking.status !== "completed") {
      notifyBookingCancelledToEmployee(id).catch((e) =>
        console.error("[auto] status-cancel employee push failed:", e),
      );
      sendBookingCancelledToClient(id).catch((e) =>
        console.error("[auto] status-cancel client notice failed:", e),
      );
    }
  }

  revalidatePath("/app/bookings");
  revalidatePath(`/app/bookings/${id}`);
  // Every board this status is visible on. The dropdown now lives on the
  // scheduler too, and a status changed there has to survive a navigation
  // away and back — router.refresh() only repaints the caller's own screen.
  revalidatePath("/app/scheduling");
  revalidatePath("/app/calendar");
  revalidatePath("/app");
  return { ok: true };
}

/** Most visits anyone can restatus in one go. A guard, not a policy. */
const SERIES_STATUS_CAP = 60;

/**
 * The same status change, applied to this visit and every later one in its
 * series.
 *
 * Svitlana was doing this by hand: the audit log for 2026-09-25 has eight
 * `confirmed -> pending` rows between 16:06:39 and 16:07:55, one every couple
 * of seconds, which is a person clicking down a list.
 *
 * It deliberately LOOPS setBookingStatusAction instead of issuing one bulk
 * UPDATE. That write carries the transition table, the future-date guard, the
 * billed-invoice refusal, the audit entry, the calendar teardown and the
 * crew/client cancellation notices — and the file already warns against
 * hand-writing "a fourth copy" of the status rules. Re-running the whole
 * action per booking costs an auth lookup each, which at these volumes is
 * nothing next to the guarantee that bulk and single behave identically.
 *
 * Partial success is the expected case, not an error: a completed visit with
 * a live invoice SHOULD refuse while the rest go through. Every refusal comes
 * back with its date and reason so the caller can say which ones and why.
 */
export async function setSeriesStatusAction(formData: FormData): Promise<{
  ok: boolean;
  error?: string;
  changed?: number;
  skipped?: Array<{ scheduled_at: string; reason: string }>;
}> {
  const id = String(formData.get("id") ?? "").trim();
  const target = String(formData.get("status") ?? "").trim();
  if (!id) return { ok: false, error: "Missing booking." };

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const { data: anchor } = (await supabase
    .from("bookings")
    .select("id, series_id, scheduled_at")
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: { id: string; series_id: string | null; scheduled_at: string } | null;
  };
  if (!anchor) return { ok: false, error: "Booking not found." };
  if (!anchor.series_id) {
    return { ok: false, error: "This booking isn't part of a series." };
  }

  const { data: siblings } = (await supabase
    .from("bookings")
    .select("id, scheduled_at")
    .eq("organization_id", membership.organization_id)
    .eq("series_id", anchor.series_id)
    .gte("scheduled_at", anchor.scheduled_at)
    .order("scheduled_at", { ascending: true })
    .limit(SERIES_STATUS_CAP)) as unknown as {
    data: Array<{ id: string; scheduled_at: string }> | null;
  };

  let changed = 0;
  const skipped: Array<{ scheduled_at: string; reason: string }> = [];
  for (const b of siblings ?? []) {
    const fd = new FormData();
    fd.set("id", b.id);
    fd.set("status", target);
    const res = await setBookingStatusAction(fd);
    if (res.ok) changed++;
    else {
      skipped.push({
        scheduled_at: b.scheduled_at,
        reason: res.error ?? "Refused.",
      });
    }
  }

  return { ok: true, changed, skipped };
}

export async function deleteBookingAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const cascade = String(formData.get("cascade_series") ?? "") === "true";
  const { membership, supabase } = await getActionContext();
  // Server actions are POST endpoints any signed-in member can invoke —
  // the UI hiding the button is not a gate. The single-delete branch below
  // is protected by RLS, but the cascade branch runs on the ADMIN client,
  // so without this check a field employee could wipe a whole series.
  if (!["owner", "admin", "manager"].includes(membership.role)) return;

  // Fetch the Google Calendar event ID + series_id + this occurrence's time
  // before deleting. scheduled_at bounds the cascade so we never touch PAST
  // occurrences (see below).
  const { data: existing } = (await supabase
    .from("bookings")
    .select("google_calendar_event_id, series_id, scheduled_at")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      google_calendar_event_id: string | null;
      series_id: string | null;
      scheduled_at: string;
    } | null;
  };

  // A billed booking is evidence, not clutter. Deleting it severs
  // invoice_line_items.booking_id — manufacturing exactly the stripped-link
  // damage this codebase has spent a week paying down — and leaves an invoice
  // billing a visit the system no longer remembers. Same rule as
  // un-completing: undo the money first, then the record can move.
  {
    const { resolveBilledBookings } = await import("@/lib/billed-bookings");
    const billed = await resolveBilledBookings(supabase, [id]);
    const inv = billed.get(id);
    if (inv) {
      // Refuse LOUDLY. This used to console.warn and silently return — the
      // owner clicked delete, nothing happened, no explanation. The rule
      // stands (deleting a billed booking manufactures stripped links), but
      // a rule that won't say its own name is just a broken button.
      redirect(
        `/app/bookings/${id}/edit?delete_error=${encodeURIComponent(
          `Invoice ${inv.number ?? inv.id.slice(0, 8)} (${inv.status}) bills this job. Void or delete that invoice first — then this booking can be deleted.`,
        )}`,
      );
    }
  }

  // Cascade: remove THIS occurrence and every FUTURE one in the series, but
  // KEEP past/completed visits — they're the client's history and may be
  // unbilled. (The UI only ever promises "every future occurrence"; a prior
  // version deleted the whole series including past visits, which silently
  // wiped completed jobs — the bug this scoping fixes.) We already verified
  // the booking belongs to the user's org via the RLS-bound fetch above. Use
  // the admin client for the bulk delete because RLS on bookings can silently
  // drop bulk-DELETE rows when the filter column (series_id) isn't in the
  // policy's predicate shape — we still enforce org isolation with an explicit
  // .eq("organization_id", ...).
  if (cascade && existing?.series_id) {
    const admin = createSupabaseAdminClient();
    // Lower bound for the cascade delete: this occurrence and everything after
    // it — but NEVER earlier than now. Past/completed visits are historical
    // records and are protected from deletion everywhere in the app. If the
    // booking being deleted is itself in the past, the clamp means only its
    // FUTURE siblings are removed and the past ones (including this one) stay.
    const nowIso = new Date().toISOString();
    const fromTs =
      existing.scheduled_at > nowIso ? existing.scheduled_at : nowIso;

    // Collect the Google Calendar event ids for the occurrences we're about to
    // delete (this one + future) so we can unsync them after the row delete.
    const { data: siblings } = (await admin
      .from("bookings")
      .select("id, google_calendar_event_id")
      .eq("series_id", existing.series_id)
      .eq("organization_id", membership.organization_id)
      .gte("scheduled_at", fromTs)) as unknown as {
      data: Array<{
        id: string;
        google_calendar_event_id: string | null;
      }> | null;
    };

    const { error: delBookingsErr, count: delBookingsCount } = await admin
      .from("bookings")
      .delete({ count: "exact" })
      .eq("series_id", existing.series_id)
      .eq("organization_id", membership.organization_id)
      .gte("scheduled_at", fromTs);
    if (delBookingsErr) {
      console.error(
        "[cascade-delete] bulk booking delete failed:",
        delBookingsErr.message,
      );
      throw delBookingsErr;
    }
    console.log(
      `[cascade-delete] removed ${delBookingsCount ?? 0} current+future booking(s) from series ${existing.series_id} (past visits kept)`,
    );

    // DEACTIVATE the series rather than deleting its row — any surviving past
    // occurrences still reference series_id, and deactivating stops the nightly
    // extend cron from regenerating future dates.
    const { error: deactivateErr } = (await admin
      .from("booking_series")
      .update({ active: false })
      .eq("id", existing.series_id)
      .eq("organization_id", membership.organization_id)) as unknown as {
      error: { message: string } | null;
    };
    if (deactivateErr) {
      console.error(
        "[cascade-delete] series deactivate failed:",
        deactivateErr.message,
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
    // Past visits are deletable since 4269b17 — Brian's ruling: "I don't
    // mind the recommendation, but it must be removable." The client-side
    // wall was removed then; THIS was its server-side twin, still bouncing
    // every past-booking delete to the detail page with no explanation —
    // "it kind of just broke the page and didn't delete the booking." The
    // protections that remain are the right ones: the billed guard above
    // (loud, with the unlock), and the cascade clamp that keeps past
    // SIBLINGS out of series deletes.

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
  // The booking no longer exists. Pushing would strand a history entry
  // pointing at /app/bookings/{id}/edit, which now renders notFound().
  redirect("/app/bookings", RedirectType.replace);
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

  // PROTECT PAST VISITS: "skip" deletes the occurrence row, so refuse it for a
  // past date. Skipping only makes sense for an upcoming visit (holiday, client
  // away); a past occurrence already happened and is a kept record.
  if (booking.scheduled_at < new Date().toISOString()) {
    // Loud, not a silent bounce: skip is the wrong tool for a past date and
    // the refusal should say so — Delete works on past visits now.
    redirect(
      `/app/bookings/${id}/edit?delete_error=${encodeURIComponent(
        "That visit already happened — skip is for upcoming dates (holidays, client away). To remove a past visit from the records, use Delete instead.",
      )}`,
      RedirectType.replace,
    );
  }

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
  // The occurrence is gone — do not leave a history entry pointing at it.
  redirect("/app/bookings", RedirectType.replace);
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
  // Ending a client's standing series is an office decision. The RLS
  // update policy admits any crew member of a row for status, so without
  // this a cleaner on one visit could cancel every future one.
  if (!["owner", "admin", "manager"].includes(membership.role)) return;
  const now = new Date().toISOString();

  // Deactivate the series — explicit org filter guards against series_id
  // spoofing even though the supabase client applies RLS.
  await (supabase
    .from("booking_series")
    .update({ active: false })
    .eq("id", seriesId)
    .eq(
      "organization_id",
      membership.organization_id,
    ) as unknown as Promise<unknown>);

  // Pull the affected occurrences FIRST so we have their event IDs.
  // After the status flip the booking rows still exist but their GCal
  // events need explicit DELETE calls — calendar API knows nothing about
  // booking.status.
  const { data: affected } = (await supabase
    .from("bookings")
    .select("id, status, google_calendar_event_id, scheduled_at")
    .eq("series_id", seriesId)
    .eq("organization_id", membership.organization_id)
    .in("status", ["pending", "confirmed"])
    .gte("scheduled_at", now)) as unknown as {
    data: Array<{
      id: string;
      status: string;
      google_calendar_event_id: string | null;
      scheduled_at: string;
    }> | null;
  };

  // Flip status to cancelled.
  await (supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("series_id", seriesId)
    .eq("organization_id", membership.organization_id)
    .in("status", ["pending", "confirmed"])
    .gte("scheduled_at", now) as unknown as Promise<unknown>);

  // One audit row and one recompute per visit, like the status dropdown
  // gives a single cancel. Cancelled is terminal to the rules, so the
  // recompute agrees; the audit row is what a cancelled series had none of.
  for (const r of affected ?? []) {
    await logAuditEvent({
      membership,
      action: "status_change",
      entity: "booking",
      entity_id: r.id,
      before: { status: r.status },
      after: { status: "cancelled", via: "cancel_series" },
    });
    await syncJob(r.id, "status_set");
  }

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

    // Notices — series cancel previously sent NOTHING for any occurrence
    // (audit B3): cleaners' only signal was a vanished calendar event.
    // Push every affected occurrence's crew; tell the client ONCE, about the
    // nearest upcoming visit (per-booking dedup would otherwise allow N
    // emails for what the client sees as one decision).
    for (const r of affected) {
      notifyBookingCancelledToEmployee(r.id).catch((e) =>
        console.error("[auto] series-cancel employee push failed:", e),
      );
    }
    const nearest = [...affected].sort((a, b) =>
      a.scheduled_at.localeCompare(b.scheduled_at),
    )[0];
    if (nearest) {
      sendBookingCancelledToClient(nearest.id).catch((e) =>
        console.error("[auto] series-cancel client notice failed:", e),
      );
    }
  }

  revalidatePath("/app/bookings");
  revalidatePath("/app");
  // Series cancelled; the page behind us is stale.
  redirect("/app/bookings", RedirectType.replace);
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
  // The page hides this button without the capability; this is the same rule
  // stated where it's actually enforced, so the button being hidden is a
  // courtesy rather than the whole guard.
  if (!can(membership, "invoicing")) {
    return {
      error: "Invoicing isn't part of your access. Ask an owner to turn it on.",
    };
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

  const updateScope = String(formData.get("update_scope") ?? "this_only");
  const seriesId = String(formData.get("series_id") ?? "").trim();
  const seriesScheduledAt = String(
    formData.get("series_scheduled_at") ?? "",
  ).trim();
  const updateSeries =
    updateScope === "this_and_future" && !!seriesId && !!seriesScheduledAt;

  if (updateSeries) {
    const currentAssignees = await syncBookingAssignees(
      supabase,
      membership.organization_id,
      id,
      primaryId,
      additionalIds,
      [],
      {},
      true,
    );
    if (typeof currentAssignees === "string") {
      return { error: currentAssignees };
    }

    const { data: updatedRows, error: seriesUpdateErr } =
      await createSupabaseAdminClient().rpc(
        "update_booking_series_with_assignees",
        {
          p_organization_id: membership.organization_id,
          p_series_id: seriesId,
          p_current_booking_id: id,
          p_from: seriesScheduledAt,
          p_current_booking_patch: { assigned_to: primaryId },
          p_current_assignees: currentAssignees as unknown as Json,
          p_sibling_booking_patch: { assigned_to: primaryId },
          p_series_patch: {
            assigned_to: primaryId,
            crew: crewFromForm({
              primaryId,
              additionalIds,
              splits: [],
            }),
          },
          p_replace_schedule: false,
          p_booking_rows: [],
          p_additional_assignee_ids: additionalIds,
        },
      );
    if (seriesUpdateErr) {
      return {
        error: `Nothing was saved because the recurring crew update failed: ${seriesUpdateErr.message}`,
      };
    }
    for (const sibling of updatedRows ?? []) {
      if (sibling.status === "in_progress" || sibling.status === "en_route") {
        await syncJob(sibling.id, "crew_changed");
      }
    }
  } else {
    const assignCrewErr = await syncBookingAssignees(
      supabase,
      membership.organization_id,
      id,
      primaryId,
      additionalIds,
      [], // no splits from the quick-assign crew dialog (guarded above)
      { assigned_to: primaryId },
    );
    if (assignCrewErr) return { error: assignCrewErr };
  }

  // Update personal calendars for all newly assigned members (and remove
  // events for unassigned ones). Fire-and-forget.
  if (existing) {
    const allAssignees = [primaryId, ...additionalIds].filter(
      Boolean,
    ) as string[];
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

  // Refresh the ORG-level Google Calendar event after ANY crew change — not
  // just a primary swap. Two reasons: the "Assigned to: <name>" line must name
  // the current primary, AND the event duration must recompute when the crew
  // COUNT changes (divide-hours shortens the window as cleaners are added or
  // removed). booking_assignees was just synced above, so updateCalendarEvent's
  // internal division sees the new crew count.
  {
    const { data: gcal } = (await supabase
      .from("bookings")
      .select("google_calendar_event_id, client_id")
      .eq("id", id)
      .maybeSingle()) as unknown as {
      data: {
        google_calendar_event_id: string | null;
        client_id: string | null;
      } | null;
    };
    if (gcal?.google_calendar_event_id) {
      const labels = await getBookingLabels(
        supabase,
        gcal.client_id ?? "",
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
    notifyBookingAssignment(membership.organization_id, id, primaryId, {
      clientName: existing.client?.name ?? "A client",
      scheduledAt: existing.scheduled_at,
      serviceType: existing.service_type,
      address: existing.address ?? null,
    });
  }

  // The crew IS the job's shape: a fourth person shortens a divided window,
  // removing the one who never came may make a finished job done.
  await syncJob(id, "crew_changed");

  revalidatePath("/app/bookings");
  revalidatePath(`/app/bookings/${id}`);
  revalidatePath("/app/scheduling");
  revalidatePath("/app");
  return { ok: true };
}

/**
 * The office writes a client's words into the SAME per-visit channel the
 * portal uses. Clients who aren't on the app phone their instructions in,
 * and those deserve the identical highlighted card the cleaner already
 * watches — not a rewrite of bookings.notes, which a "this and future"
 * edit promotes to the series note and turns "just this week" into a
 * standing instruction.
 *
 * The row is inserted exactly as the portal inserts it (resolved,
 * auto_applied — nothing to triage) so every downstream surface treats
 * both identically; resolved_by alone records that the office relayed it.
 */
export async function relayVisitNoteAction(formData: FormData): Promise<void> {
  const bookingId = String(formData.get("booking_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!bookingId) return;

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) return;

  // Keep the scheduler breadcrumb through the round-trip — without it,
  // adding a note from a scheduler-opened booking lost the way back to
  // the board.
  const returnTo = String(formData.get("_return") ?? "");
  const back = returnTo
    ? `/app/bookings/${bookingId}?_return=${encodeURIComponent(returnTo)}`
    : `/app/bookings/${bookingId}`;
  const refuse = (msg: string): never =>
    redirect(
      `${back}${back.includes("?") ? "&" : "?"}note_error=${encodeURIComponent(msg)}`,
    );

  if (!body) refuse("Write the note first.");
  if (body.length > 1000) refuse("Keep it under 1,000 characters.");
  if (detectCardNumber(body)) refuse(CARD_DETECTED_MESSAGE);

  const { data: noteBooking } = (await supabase
    .from("bookings")
    .select(
      "id, organization_id, client_id, series_id, scheduled_at, assigned_to, client:clients ( name )",
    )
    .eq("id", bookingId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      client_id: string;
      series_id: string | null;
      scheduled_at: string;
      assigned_to: string | null;
      client: { name: string | null } | null;
    } | null;
  };
  if (!noteBooking) {
    refuse("This booking no longer exists.");
    return;
  }
  // The after() closure below doesn't inherit narrowing — hand it an
  // already-proved const instead.
  const nb = noteBooking;

  const tz = await getOrgTimezone(membership.organization_id);
  const admin = createSupabaseAdminClient();
  const { error } = (await admin.from("client_job_requests" as never).insert({
    organization_id: nb.organization_id,
    client_id: nb.client_id,
    booking_id: nb.id,
    series_id: nb.series_id,
    occurrence_date: occurrenceDate(nb.scheduled_at, tz),
    kind: "job_note",
    body,
    status: "resolved",
    resolved_at: new Date().toISOString(),
    resolved_by: membership.id,
    auto_applied: true,
  } as never)) as unknown as { error: { message: string } | null };
  if (error) refuse(error.message);

  // Crew gets the same push a portal note sends. No org-management echo —
  // the office just typed it themselves.
  after(async () => {
    const clientName = nb.client?.name ?? "the client";
    const excerpt = `${body.slice(0, 160)}${body.length > 160 ? "…" : ""}`;
    const when = formatDateTime(nb.scheduled_at, tz);
    const { data: crewRows } = (await admin
      .from("booking_assignees")
      .select("membership_id")
      .eq("booking_id", nb.id)) as unknown as {
      data: Array<{ membership_id: string }> | null;
    };
    const ids = new Set((crewRows ?? []).map((r) => r.membership_id));
    if (nb.assigned_to) ids.add(nb.assigned_to);
    for (const membershipId of ids) {
      await notify({
        organizationId: nb.organization_id,
        audience: "membership",
        membershipId,
        type: "client_request",
        title: `Note from ${clientName}`,
        body: `${excerpt} — for ${when}.`,
        href: `/field/jobs/${nb.id}`,
      });
    }
  });

  revalidatePath(back);
  revalidatePath(`/field/jobs/${nb.id}`);
  redirect(back);
}

"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireClient } from "@/lib/client-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgTimezone } from "@/lib/org-timezone";
import { detectCardNumber, CARD_DETECTED_MESSAGE } from "@/lib/card-detection";
import { notify } from "@/lib/notify";
import { formatDateTime } from "@/lib/format";
import {
  clientBookingActions,
  occurrenceDate,
} from "@/lib/client-job-requests";

export type ClientJobActionState = { ok?: boolean; error?: string };

/**
 * Everything a portal client can do to a booking they already have.
 *
 * Both actions use the admin client after requireClient(), matching the rule
 * the booking-request flow already documents: the portal writes through server
 * actions only, never through client-side RLS. There is deliberately no client
 * INSERT policy on client_job_requests — Postgres RLS has no OLD/NEW pair, so
 * a client UPDATE policy would grant every column on every row it admits, and
 * eligibility here is time-dependent anyway, which is imperative logic rather
 * than a predicate.
 *
 * Ownership is therefore proven in code, twice: requireClient() resolves the
 * session to one clients row, and every query is scoped by that client_id.
 */

const MAX_NOTE = 1000;

/** Load the booking and prove this client owns it. Returns null otherwise. */
async function ownedBooking(bookingId: string, clientId: string) {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("bookings")
    .select(
      "id, organization_id, client_id, series_id, scheduled_at, status, archived_at, assigned_to, address, service_type_label, service_type",
    )
    .eq("id", bookingId)
    .eq("client_id", clientId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      client_id: string;
      series_id: string | null;
      scheduled_at: string;
      status: string;
      archived_at: string | null;
      assigned_to: string | null;
      address: string | null;
      service_type_label: string | null;
      service_type: string;
    } | null;
  };
  return data;
}

/** Everyone assigned to this visit — primary plus crew. */
async function assigneeIds(bookingId: string, primary: string | null) {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("booking_assignees")
    .select("membership_id")
    .eq("booking_id", bookingId)) as unknown as {
    data: Array<{ membership_id: string }> | null;
  };
  const ids = new Set((data ?? []).map((r) => r.membership_id));
  if (primary) ids.add(primary);
  return [...ids];
}

/**
 * A note for one visit — "skip the bathroom this week".
 *
 * Goes to the crew, not to the office. The cleaner is the one who has to act
 * on it, and a note about a bathroom is exactly the kind of thing the portal
 * exists to keep off the owner's phone. It still appears on the booking for
 * the office, silently.
 */
export async function leaveJobNoteAction(
  _prev: ClientJobActionState,
  formData: FormData,
): Promise<ClientJobActionState> {
  const client = await requireClient();
  const bookingId = String(formData.get("booking_id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!bookingId) return { error: "Missing job." };
  if (!body) return { error: "Write a note first." };
  if (body.length > MAX_NOTE) {
    return { error: `Keep it under ${MAX_NOTE} characters.` };
  }
  // Same guard the booking-request form uses — clients do sometimes type a
  // card number into a free-text box, and it must not land in the database.
  if (detectCardNumber(body)) return { error: CARD_DETECTED_MESSAGE };

  const booking = await ownedBooking(bookingId, client.id);
  if (!booking) return { error: "Job not found." };

  const state = clientBookingActions(booking);
  if (!state.canNote) {
    return { error: state.reason ?? "You can't add a note to this job." };
  }

  const admin = createSupabaseAdminClient();
  const tz = await getOrgTimezone(booking.organization_id);

  // `as never` because client_job_requests postdates the generated Supabase
  // types — the same idiom booking_requests uses in the sibling action.
  const { error } = (await admin.from("client_job_requests" as never).insert({
    organization_id: booking.organization_id,
    client_id: client.id,
    booking_id: booking.id,
    series_id: booking.series_id,
    occurrence_date: occurrenceDate(booking.scheduled_at, tz),
    kind: "job_note",
    body,
    // A note is not a decision anyone has to make, so it never sits in the
    // office queue waiting to be actioned.
    status: "resolved",
    resolved_at: new Date().toISOString(),
    auto_applied: true,
  } as never)) as unknown as { error: { message: string } | null };
  if (error) return { error: error.message };

  // The crew, not the office. Deferred so the client's tap returns straight
  // away — notify() sends a push, and none of that is theirs to wait for.
  after(async () => {
    const crew = await assigneeIds(booking.id, booking.assigned_to);
    if (crew.length === 0) return;
    const when = formatDateTime(booking.scheduled_at, tz);
    for (const membershipId of crew) {
      await notify({
        organizationId: booking.organization_id,
        audience: "membership",
        membershipId,
        type: "client_request",
        title: `Note from ${client.name}`,
        body: `${body.slice(0, 160)}${body.length > 160 ? "…" : ""} — for ${when}.`,
        href: `/field/jobs/${booking.id}`,
      });
    }
  });

  revalidatePath(`/client/jobs/${booking.id}`);
  revalidatePath(`/field/jobs/${booking.id}`);
  revalidatePath(`/app/bookings/${booking.id}`);
  return { ok: true };
}

/**
 * Skip one visit.
 *
 * Far enough out and it simply happens — the office is told, not asked. Close
 * in, the crew is already committed and the slot is hard to refill, so it
 * becomes a request a human answers. The boundary lives in
 * SKIP_AUTO_APPLY_HOURS so the button the client sees and the rule the server
 * applies can never disagree.
 */
export async function requestSkipAction(
  _prev: ClientJobActionState,
  formData: FormData,
): Promise<ClientJobActionState> {
  const client = await requireClient();
  const bookingId = String(formData.get("booking_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!bookingId) return { error: "Missing job." };
  if (reason && detectCardNumber(reason))
    return { error: CARD_DETECTED_MESSAGE };

  const booking = await ownedBooking(bookingId, client.id);
  if (!booking) return { error: "Job not found." };

  const state = clientBookingActions(booking);
  if (!state.canSkip) {
    return { error: state.reason ?? "This visit can't be skipped here." };
  }

  const admin = createSupabaseAdminClient();
  const tz = await getOrgTimezone(booking.organization_id);
  const nowIso = new Date().toISOString();
  const autoApplies = state.skipAutoApplies;

  const { error: reqErr } = (await admin
    .from("client_job_requests" as never)
    .insert({
      organization_id: booking.organization_id,
      client_id: client.id,
      booking_id: booking.id,
      series_id: booking.series_id,
      occurrence_date: occurrenceDate(booking.scheduled_at, tz),
      kind: "skip_occurrence",
      body: reason || null,
      // An auto-applied skip has already happened, so it is not a decision
      // anyone has to make — the office queue only holds open questions.
      status: autoApplies ? "resolved" : "open",
      resolved_at: autoApplies ? nowIso : null,
      auto_applied: autoApplies,
    } as never)) as unknown as { error: { message: string } | null };
  if (reqErr) return { error: reqErr.message };

  if (autoApplies) {
    // Cancel rather than delete. skipBookingOccurrenceAction hard-deletes and
    // writes booking_series.skip_dates, which is right when an OWNER edits a
    // schedule — but it would erase the record of what the client asked for,
    // and it permanently removes this date from the standing series. A client
    // skipping one week has not changed their contract.
    const { error: cancelErr } = await admin
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", booking.id)
      .eq("client_id", client.id);
    if (cancelErr) return { error: cancelErr.message };
  }

  after(async () => {
    const when = formatDateTime(booking.scheduled_at, tz);
    const service = booking.service_type_label ?? booking.service_type;

    // The office. On an auto-applied skip this is the only signal they get,
    // so it is not optional — but it is information, not a task.
    await notify({
      organizationId: booking.organization_id,
      audience: "org-management",
      type: "client_request",
      title: autoApplies
        ? `${client.name} skipped a visit`
        : `${client.name} asked to skip a visit`,
      body: autoApplies
        ? `${service} on ${when} is cancelled at the client's request.${reason ? ` They said: “${reason}”.` : ""}`
        : `${service} on ${when} — too close to auto-cancel, so it needs your call.${reason ? ` They said: “${reason}”.` : ""}`,
      href: `/app/bookings/${booking.id}`,
      // A skip inside the window is time-critical; one far out is not.
      channels: autoApplies ? undefined : { email: true },
    });

    // The crew only when it actually happened. Telling a cleaner about a
    // request that may be declined would have them plan around a visit that
    // is still going ahead.
    if (autoApplies) {
      const crew = await assigneeIds(booking.id, booking.assigned_to);
      for (const membershipId of crew) {
        await notify({
          organizationId: booking.organization_id,
          audience: "membership",
          membershipId,
          type: "client_request",
          title: "A job was cancelled",
          body: `${client.name} on ${when} — the client skipped this visit.`,
          href: "/field/shifts",
        });
      }
    }
  });

  revalidatePath(`/client/jobs/${booking.id}`);
  revalidatePath("/client/jobs");
  revalidatePath("/client");
  revalidatePath(`/app/bookings/${booking.id}`);
  revalidatePath("/app/bookings");
  return { ok: true };
}

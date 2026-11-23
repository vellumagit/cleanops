import "server-only";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cancelJobs } from "@/lib/cancel-jobs";
import { getOrgTimezone } from "@/lib/org-timezone";
import { detectCardNumber, CARD_DETECTED_MESSAGE } from "@/lib/card-detection";
import { notify } from "@/lib/notify";
import { formatDateTime } from "@/lib/format";
import { clientBookingActions, occurrenceDate } from "@/lib/client-job-requests";

/**
 * What a client can ask about one of their visits: leave a note, skip it,
 * ask to move it. One set of rules for both doors a client comes through:
 * signed in to their client area (app/client/(portal)/jobs/[id]/actions.ts),
 * or holding the private link from a booking email (app/v/[token]).
 *
 * Whoever calls these has already proven the visit is this client's: the
 * signed-in door by the session, the link door by the token. Nothing here
 * decides that.
 *
 * Everything is written with the admin client. There is deliberately no
 * client INSERT policy on client_job_requests: eligibility is time-dependent,
 * which is logic and not a row predicate.
 */
export type ClientJobActionState = { ok?: boolean; error?: string };

export type RequestClient = { id: string; name: string };

export type RequestVisit = {
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
};

const MAX_NOTE = 1000;

/** Everyone assigned to this visit: primary plus crew. */
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

/** The pages that show this visit, refreshed after a change. */
function refresh(bookingId: string) {
  revalidatePath(`/client/jobs/${bookingId}`);
  revalidatePath("/client/jobs");
  revalidatePath("/client");
  revalidatePath(`/field/jobs/${bookingId}`);
  revalidatePath(`/app/bookings/${bookingId}`);
  revalidatePath("/app/bookings");
  revalidatePath("/app/bookings/requests");
}

/**
 * A note for one visit: "skip the bathroom this week".
 *
 * Goes to the crew AND to the office. The cleaner is the one who has to act
 * on it, so their push carries the field link. The office gets an FYI with
 * the booking link: an owner who finds out at invoice time that a visit was
 * quietly renegotiated trusts the portal less, not more.
 */
export async function leaveVisitNote(client: RequestClient, booking: RequestVisit, bodyRaw: string): Promise<ClientJobActionState> {
  const body = bodyRaw.trim();
  if (!body) return { error: "Write a note first." };
  if (body.length > MAX_NOTE) return { error: `Keep it under ${MAX_NOTE} characters.` };
  // Clients do sometimes type a card number into a free-text box, and it
  // must not land in the database.
  if (detectCardNumber(body)) return { error: CARD_DETECTED_MESSAGE };

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

  // Deferred so the client's tap returns straight away — notify() sends
  // pushes, and none of that is theirs to wait for.
  after(async () => {
    const when = formatDateTime(booking.scheduled_at, tz);
    const service =
      booking.service_type_label ?? booking.service_type.replace(/_/g, " ");
    const excerpt = `${body.slice(0, 160)}${body.length > 160 ? "…" : ""}`;

    // The crew acts on it — their link opens the field job.
    const crew = await assigneeIds(booking.id, booking.assigned_to);
    for (const membershipId of crew) {
      await notify({
        organizationId: booking.organization_id,
        audience: "membership",
        membershipId,
        type: "client_request",
        title: `Note from ${client.name}`,
        body: `${excerpt} — for ${when}.`,
        href: `/field/jobs/${booking.id}`,
      });
    }

    // The office hears about it — their link opens the booking. Also the
    // only alert anyone gets when the visit has no crew assigned yet, in
    // which case somebody in the office HAS to carry the note forward.
    await notify({
      organizationId: booking.organization_id,
      audience: "org-management",
      topic: "clients",
      type: "client_request",
      title: `New note from ${client.name}`,
      body: `"${excerpt}" — ${service} on ${when}.`,
      href: `/app/bookings/${booking.id}`,
    });
  });

  refresh(booking.id);
  return { ok: true };
}

/**
 * Skip one visit.
 *
 * Far enough out and it simply happens: the office is told, not asked. Close
 * in, the crew is already committed and the slot is hard to refill, so it
 * becomes a request a human answers. The boundary is SKIP_AUTO_APPLY_HOURS,
 * so the button the client sees and the rule applied here can never disagree.
 */
export async function skipVisit(client: RequestClient, booking: RequestVisit, reasonRaw: string): Promise<ClientJobActionState> {
  const reason = reasonRaw.trim();
  if (reason && detectCardNumber(reason)) return { error: CARD_DETECTED_MESSAGE };
  if (reason.length > MAX_NOTE) return { error: `Keep it under ${MAX_NOTE} characters.` };

  const state = clientBookingActions(booking);
  if (!state.canSkip) {
    return { error: state.reason ?? "This visit can't be skipped here." };
  }

  const admin = createSupabaseAdminClient();
  const tz = await getOrgTimezone(booking.organization_id);
  const nowIso = new Date().toISOString();
  const autoApplies = state.skipAutoApplies;

  // Recorded OPEN first, and marked resolved only once the booking is
  // actually cancelled. Written resolved up front, a failed cancel left the
  // portal saying "Cancelled" over a visit still on the schedule; an open
  // request at least reaches the office queue.
  const { data: req, error: reqErr } = (await admin
    .from("client_job_requests" as never)
    .insert({
      organization_id: booking.organization_id,
      client_id: client.id,
      booking_id: booking.id,
      series_id: booking.series_id,
      occurrence_date: occurrenceDate(booking.scheduled_at, tz),
      kind: "skip_occurrence",
      body: reason || null,
      status: "open",
      resolved_at: null,
      auto_applied: false,
    } as never)
    .select("id")
    .single()) as unknown as { data: { id: string } | null; error: { message: string } | null };
  if (reqErr || !req) return { error: reqErr?.message ?? "Couldn't record the request." };

  if (autoApplies) {
    // Cancel rather than delete. skipBookingOccurrenceAction hard-deletes and
    // writes booking_series.skip_dates, which is right when an OWNER edits a
    // schedule — but it would erase the record of what the client asked for,
    // and it permanently removes this date from the standing series. A client
    // skipping one week has not changed their contract.
    // Through the one cancel path. The client is the actor, so the history
    // row has no member on it and says "client_skip". Own wording for the
    // office and crew below, so no standard notices. Calendars after the
    // response: the visit comes off the cleaners' and the company's Google
    // Calendars without the client waiting on Google.
    const res = await cancelJobs({
      organizationId: booking.organization_id,
      bookingIds: [booking.id],
      clientId: client.id,
      fromStatuses: ["pending", "confirmed"],
      via: "client_skip",
      syncReason: "client_skip",
      actorId: null,
      calendars: "all",
      notices: "none",
      defer: true,
    });
    if (res.error) return { error: res.error };
    if (res.cancelled.length === 0) {
      return { error: "This visit changed a moment ago and can't be skipped here now. Reload the page." };
    }
    // An auto-applied skip has happened, so it is not a decision anyone has
    // to make — the office queue only holds open questions.
    const { error: resolveErr } = await admin
      .from("client_job_requests" as never)
      .update({ status: "resolved", resolved_at: nowIso, auto_applied: true } as never)
      .eq("id", req.id);
    if (resolveErr) {
      console.error("[portal] skip applied but its request stayed open:", resolveErr.message);
    }
  }

  after(async () => {
    const when = formatDateTime(booking.scheduled_at, tz);
    const service = booking.service_type_label ?? booking.service_type;

    // The office. On an auto-applied skip this is the only signal they get,
    // so it is not optional — but it is information, not a task.
    await notify({
      organizationId: booking.organization_id,
      audience: "org-management",
      topic: "clients",
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

  refresh(booking.id);
  return { ok: true };
}

/**
 * Ask to move a visit to another time.
 *
 * A request, never a change: only the office knows who is free when. It
 * lands in the office's requests inbox as an open question, with the
 * client's own words, and the office is told at once. The crew is not: the
 * visit is still going ahead as booked until someone moves it.
 *
 * (Picking a new time themselves comes once the app can work out open
 * times: docs/online-booking-roadmap.md, phases 2 and 4.)
 */
export async function askToMoveVisit(client: RequestClient, booking: RequestVisit, wishRaw: string): Promise<ClientJobActionState> {
  const wish = wishRaw.trim();
  if (!wish) return { error: "Tell us when would suit you better." };
  if (wish.length > MAX_NOTE) return { error: `Keep it under ${MAX_NOTE} characters.` };
  if (detectCardNumber(wish)) return { error: CARD_DETECTED_MESSAGE };

  const state = clientBookingActions(booking);
  if (!state.canNote) return { error: state.reason ?? "This visit can't be changed here." };

  const admin = createSupabaseAdminClient();
  const tz = await getOrgTimezone(booking.organization_id);
  const when = formatDateTime(booking.scheduled_at, tz);

  const { error } = (await admin.from("client_job_requests" as never).insert({
    organization_id: booking.organization_id,
    client_id: client.id,
    booking_id: booking.id,
    series_id: booking.series_id,
    occurrence_date: occurrenceDate(booking.scheduled_at, tz),
    kind: "job_note",
    body: `Asked to move their visit on ${when}. They said: "${wish}"`,
    // Open: somebody has to answer it. It shows in the office's requests
    // inbox until they do.
    status: "open",
    resolved_at: null,
    auto_applied: false,
  } as never)) as unknown as { error: { message: string } | null };
  if (error) return { error: error.message };

  after(async () => {
    const service = booking.service_type_label ?? booking.service_type.replace(/_/g, " ");
    const excerpt = `${wish.slice(0, 200)}${wish.length > 200 ? "…" : ""}`;
    await notify({
      organizationId: booking.organization_id,
      audience: "org-management",
      topic: "clients",
      type: "client_request",
      title: `${client.name} asked to move a visit`,
      body: `${service} on ${when}. They said: "${excerpt}". The visit stays as booked until you move it.`,
      href: `/app/bookings/${booking.id}`,
      // Somebody is waiting on an answer.
      channels: { email: true },
    });
  });

  refresh(booking.id);
  return { ok: true };
}

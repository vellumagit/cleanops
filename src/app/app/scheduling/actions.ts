"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getActionContext } from "@/lib/actions";
import { getOrgTimezone } from "@/lib/org-timezone";
import { futureStatusError } from "@/lib/booking-status";
import { planCrewMove, type CrewMovePlan } from "./drag-crew";
import { membersOffOn } from "@/lib/unavailability-notice";
import { scheduleFromWallClock } from "@/lib/scheduled-local";
import { resyncBookingCalendars } from "@/lib/booking-calendar-sync";
import { memberDisplayName } from "@/lib/member-display";
import {
  notifyBookingAssignment,
  sendBookingRescheduled,
} from "@/lib/automations";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type RescheduleResult =
  /** notice: saved, but worth a second look (someone's off that day). */
  | { ok: true; notice?: string }
  | { ok: false; error: string };

/**
 * Mark a cleaner's "take me off the recurring client" request as handled.
 * Owner/admin/manager only (also enforced by RLS on shift_change_requests).
 */
export async function resolveShiftRequestAction(
  requestId: string,
): Promise<RescheduleResult> {
  if (!requestId) return { ok: false, error: "Missing request id" };
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not allowed." };
  }
  const { error } = await (supabase
    .from("shift_change_requests" as never)
    .update({
      status: "resolved",
      resolved_by: membership.id,
      resolved_at: new Date().toISOString(),
    } as never)
    .eq("id" as never, requestId as never)
    .eq("status" as never, "open" as never) as unknown as Promise<{
    error: { message: string } | null;
  }>);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/scheduling", "page");
  return { ok: true };
}

/**
 * Move a booking to a new (employee, day, optional time) slot.
 *
 *   - `assignedTo: null` drops into the unassigned tray.
 *   - `targetDate` is required (YYYY-MM-DD in org tz).
 *   - `newTimeLocal` is optional (HH:MM). Omit in Week view — the
 *     booking's existing hour-of-day is preserved. Provide in Dispatch
 *     view so a drop onto a specific 30-min slot actually changes the
 *     start time to whatever the cursor landed on.
 *
 * Returns a structured result instead of throwing so the client can show
 * a toast on conflicts without nuking the optimistic UI.
 *
 * Fixes a timezone bug in the prior version: the hour-extraction used
 * FALLBACK_TZ (app-wide fallback) rather than the ORG's tz. An Edmonton
 * org with a booking at 08:00 Edmonton got round-tripped through
 * America/New_York and ended up at 06:00 Edmonton after the drop.
 */
export async function rescheduleBookingAction(
  id: string,
  assignedTo: string | null,
  /** Target date in YYYY-MM-DD form (local). */
  targetDate: string,
  /** Optional new start time in HH:MM form (24h) for Dispatch-view drops. */
  newTimeLocal?: string,
  /**
   * Whose card was dragged — the lane it came FROM. null = the unassigned
   * tray. Omitted by callers that can't say, which are treated as having
   * dragged the first person's card. See drag-crew.ts: without this, grabbing
   * a team job from a non-lead's lane wiped the rest of the crew.
   */
  fromMember?: string | null,
): Promise<RescheduleResult> {
  if (!id) return { ok: false, error: "Missing booking id" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return { ok: false, error: "Invalid target date" };
  }
  if (newTimeLocal && !/^\d{2}:\d{2}$/.test(newTimeLocal)) {
    return { ok: false, error: "Invalid target time" };
  }

  const { membership, supabase } = await getActionContext();
  if (membership.role !== "owner" && membership.role !== "admin") {
    return { ok: false, error: "Only owners and admins can reschedule" };
  }

  const orgTz = await getOrgTimezone(membership.organization_id);

  // Pull the current booking so we can preserve hour-of-day + duration
  // when no explicit newTimeLocal is provided. Also fetch splits so we
  // can detect split-shift bookings and avoid wiping their assignees.
  const { data: current, error: fetchError } = (await supabase
    .from("bookings")
    .select("id, scheduled_at, duration_minutes, assigned_to, splits, status")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      scheduled_at: string;
      duration_minutes: number;
      assigned_to: string | null;
      status: string;
      splits: Array<{ assigned_to?: string; duration_minutes?: number }> | null;
    } | null;
    error: { message: string } | null;
  };
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!current) return { ok: false, error: "Booking not found" };

  // Who is on the job now, and what this drag does to them. Split bookings
  // keep their crew and offsets untouched (only the start moves), as before.
  const { data: crewRows, error: crewError } = (await supabase
    .from("booking_assignees" as never)
    .select(
      "membership_id, split_start_offset_minutes, split_duration_minutes",
    )
    .eq("booking_id" as never, id as never)) as unknown as {
    data: Array<{
      membership_id: string;
      split_start_offset_minutes: number | null;
      split_duration_minutes: number | null;
    }> | null;
    error: { message: string } | null;
  };
  if (crewError) return { ok: false, error: crewError.message };
  const hasSplits =
    (Array.isArray(current.splits) && current.splits.length > 0) ||
    (crewRows ?? []).some(
      (row) =>
        row.split_start_offset_minutes != null ||
        row.split_duration_minutes != null,
    );
  const crewNow = Array.from(
    new Set([
      ...(current.assigned_to ? [current.assigned_to] : []),
      ...(crewRows ?? []).map((r) => r.membership_id),
    ]),
  );
  const plan: CrewMovePlan = hasSplits
    ? { kind: "unchanged" }
    : planCrewMove({
        crew: crewNow,
        lead: current.assigned_to,
        mover: fromMember === undefined ? current.assigned_to : fromMember,
        target: assignedTo,
      });
  if (plan.kind === "already_on") {
    return {
      ok: false,
      error:
        "That cleaner is already on this job. To change the day or time, drag the card along its own row. To take someone off, drop their card on Unassigned.",
    };
  }

  let targetHour: number;
  let targetMin: number;
  if (newTimeLocal) {
    const [h, m] = newTimeLocal.split(":").map(Number);
    targetHour = h;
    targetMin = m;
  } else {
    const previous = new Date(current.scheduled_at);
    const prevParts = new Intl.DateTimeFormat("en-US", {
      timeZone: orgTz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(previous);
    targetHour = Number(prevParts.find((p) => p.type === "hour")?.value ?? 0);
    targetMin = Number(prevParts.find((p) => p.type === "minute")?.value ?? 0);
  }

  // The wall clock the owner dropped the card on, and the instant it means
  // in the org's zone. (This used to re-parse a formatted string with
  // `new Date(...)`, which reads it in the SERVER's zone — right only while
  // the server runs in UTC.)
  const pad = (n: number) => String(n).padStart(2, "0");
  const wall = scheduleFromWallClock(`${targetDate}T${pad(targetHour)}:${pad(targetMin)}`, orgTz);
  const next = new Date(wall.scheduled_at);

  // Overlaps are refused by the database (the overlap guard, migration
  // 20261108060000), which reads crew windows the way the app does — shared
  // hours divided, a split segment on its own times — and refuses only an
  // overlap this move creates. A pre-check here used to apply its own,
  // stricter rule, so the two disagreed; the refusal now comes back from the
  // update below with one message.

  // For split-shift bookings, only move the start time — never touch
  // assigned_to or booking_assignees. The segments stay with the same
  // crew, just shifted to the new slot (segment offsets are relative).
  // Otherwise assigned_to follows the crew plan, and only when it changed.
  // Did the actual INSTANT move? (A drag within the same slot can be a pure
  // reassignment.) Drives the reminder re-arm + rescheduled notices below.
  const instantChanged =
    new Date(current.scheduled_at).getTime() !== next.getTime();

  // The status/date rule has a second direction nobody guards: instead of
  // marking a future job completed, drag a completed job into the future.
  // futureStatusError is keyed on (date, status), so every writer that moves
  // the DATE is structurally outside a check that only fires on status writes.
  // Svit drags constantly — ~243 bookings a week — so this path matters.
  const dateErr = futureStatusError(next.toISOString(), current.status);
  if (dateErr) return { ok: false, error: dateErr };

  // A finished job an invoice bills doesn't move: the invoice's line says
  // when it was. Same rule as the edit form and the API.
  if (current.status === "completed" && instantChanged) {
    const { resolveBilledBookings, billedRefusal } = await import("@/lib/billed-bookings");
    const billed = await resolveBilledBookings(supabase, [id]);
    const refusal = billedRefusal(billed.get(id), "move this job");
    if (refusal) return { ok: false, error: refusal };
  }

  const assigneeIds = plan.kind === "changed" ? plan.crew : null;
  const { error: updateError } = await createSupabaseAdminClient().rpc(
    "reschedule_booking_with_assignees",
    {
      p_organization_id: membership.organization_id,
      p_booking_id: id,
      p_scheduled_at: wall.scheduled_at,
      p_scheduled_local: wall.scheduled_local,
      p_scheduled_tz: wall.scheduled_tz,
      p_set_assigned_to: plan.kind === "changed",
      p_assigned_to: plan.kind === "changed" ? plan.lead : null,
      p_reset_client_reminder: instantChanged,
      p_time_set_by_hand_at: instantChanged ? new Date().toISOString() : null,
      p_assignee_ids: assigneeIds,
    },
  );
  if (updateError) {
    const overlap = updateError.code === "23P01" || updateError.message.includes("overlapping booking");
    return {
      ok: false,
      error: overlap
        ? "A cleaner on this job is already booked at that time. Move the other job first or pick a different slot."
        : updateError.message,
    };
  }

  // Rescheduled notices — drag-drop is the highest-traffic reschedule path
  // and previously notified NO ONE (audit B1): the client showed up on the
  // old time, the crew's only signal was a moved calendar event. Same call
  // the edit form makes; it emails/texts the client per their notification
  // preference and pushes the assigned employee, all internally gated.
  if (instantChanged) {
    sendBookingRescheduled(id, current.scheduled_at).catch((e) =>
      console.error("[scheduler] rescheduled notice failed:", e),
    );
  }

  // Tell the person who was just added to the job. Previously drag-drop moved
  // jobs to a new cleaner without any push, so they had no idea.
  if (plan.kind === "changed" && plan.added) {
    const addedId = plan.added;
    const { data: bookingForNotify } = (await supabase
      .from("bookings")
      .select("service_type, address, client:clients ( name )")
      .eq("id", id)
      .maybeSingle()) as unknown as {
      data: {
        service_type: string;
        address: string | null;
        client: { name: string | null } | null;
      } | null;
    };
    if (bookingForNotify) {
      notifyBookingAssignment(membership.organization_id, id, addedId, {
        clientName: bookingForNotify.client?.name ?? "A client",
        scheduledAt: next.toISOString(),
        serviceType: bookingForNotify.service_type,
        address: bookingForNotify.address,
      });
    }
  }

  // Did this land on a day someone on the job said they're off? The move
  // stands — the owner may know something the calendar doesn't — but they hear
  // about it now, not when the cleaner doesn't show. The board's warning dot
  // says the same thing afterwards.
  let notice: string | undefined;
  try {
    const crewAfter = plan.kind === "changed" ? plan.crew : crewNow;
    const off = await membersOffOn(
      membership.organization_id,
      crewAfter,
      targetDate,
    );
    if (off.length > 0) {
      const { data: people } = (await supabase
        .from("memberships")
        .select("id, display_name, profile:profiles ( full_name )")
        .in("id", off)) as unknown as {
        data: Array<{
          id: string;
          display_name: string | null;
          profile: { full_name: string | null } | null;
        }> | null;
      };
      const names = (people ?? []).map((p) => memberDisplayName(p));
      notice = `Moved — but ${
        names.length > 0 ? names.join(" and ") : "someone on this job"
      } ${names.length > 1 ? "are" : "is"} off that day.`;
    }
  } catch (err) {
    console.error("[reschedule] day-off check failed:", err);
  }

  // A move changes the window, and a crew swap changes who is rostered:
  // both are inputs to the job's state. The edit form recomputes; the
  // calendar drag — Svit's busiest reschedule path — didn't.
  {
    const { syncJob } = await import("@/lib/job-sync");
    await syncJob(id, "rescheduled");
  }

  // The calendars. This path never told Google Calendar anything: a dragged
  // job sat at its old time on the org calendar and on every cleaner's phone
  // until the nightly reconcile, and a same-day move never caught up. After
  // the response so the drop still feels instant.
  if (instantChanged || plan.kind === "changed") {
    after(() => resyncBookingCalendars(id));
  }

  revalidatePath("/app/scheduling");
  revalidatePath("/app/bookings");
  revalidatePath("/app");
  return { ok: true, notice };
}

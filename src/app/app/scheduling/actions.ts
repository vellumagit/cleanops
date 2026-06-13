"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { getOrgTimezone } from "@/lib/org-timezone";
import { notifyBookingAssignment } from "@/lib/automations";

export type RescheduleResult =
  | { ok: true }
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
 * DEFAULT_TZ (app-wide fallback) rather than the ORG's tz. An Edmonton
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
    .select("id, scheduled_at, duration_minutes, assigned_to, splits")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data:
      | {
          id: string;
          scheduled_at: string;
          duration_minutes: number;
          assigned_to: string | null;
          splits: Array<{ assigned_to?: string; duration_minutes?: number }> | null;
        }
      | null;
    error: { message: string } | null;
  };
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!current) return { ok: false, error: "Booking not found" };

  const hasSplits =
    Array.isArray(current.splits) && current.splits.length > 0;

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
    targetHour = Number(
      prevParts.find((p) => p.type === "hour")?.value ?? 0,
    );
    targetMin = Number(
      prevParts.find((p) => p.type === "minute")?.value ?? 0,
    );
  }

  // Build the new datetime and convert to UTC via the org's timezone.
  const pad = (n: number) => String(n).padStart(2, "0");
  const naiveStr = `${targetDate}T${pad(targetHour)}:${pad(targetMin)}:00Z`;
  const naiveMs = new Date(naiveStr).getTime();
  const inTz = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: orgTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(naiveStr)),
  );
  const offsetMs = inTz.getTime() - naiveMs;
  const next = new Date(naiveMs - offsetMs);
  const nextEnd = new Date(
    next.getTime() + current.duration_minutes * 60_000,
  );

  // Hard-conflict check: same employee can't be in two places. Different
  // employees overlapping is legit (two-person jobs) and isn't blocked
  // here. The Dispatch view separately paints informational red borders
  // so the owner sees overlaps at a glance.
  //
  // SPLIT BOOKINGS: skip the drop-target conflict check entirely. The
  // booking's crew + offsets are preserved on reschedule (see below),
  // so the drop target's `assignedTo` is irrelevant — the booking will
  // never touch that lane. A proper per-segment conflict check is a
  // follow-up; for now the dispatch grid's visual conflict ring covers
  // most cases.
  if (assignedTo && !hasSplits) {
    const [y, m, d] = targetDate.split("-").map(Number);
    const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
    const dayEnd = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
    const { data: sameDay, error: conflictError } = await supabase
      .from("bookings")
      .select("id, scheduled_at, duration_minutes")
      .eq("assigned_to", assignedTo)
      .gte("scheduled_at", dayStart.toISOString())
      .lt("scheduled_at", dayEnd.toISOString())
      .neq("id", id)
      .limit(50);
    if (conflictError) return { ok: false, error: conflictError.message };

    const overlap = (sameDay ?? []).find((other) => {
      const oStart = new Date(other.scheduled_at);
      const oEnd = new Date(
        oStart.getTime() + other.duration_minutes * 60_000,
      );
      return oStart < nextEnd && oEnd > next;
    });
    if (overlap) {
      return {
        ok: false,
        error:
          "That cleaner is already booked at this time. Move the other job first or pick a different slot.",
      };
    }
  }

  // For split-shift bookings, only move the start time — never touch
  // assigned_to or booking_assignees. The segments stay with the same
  // crew, just shifted to the new slot (segment offsets are relative).
  // For non-split bookings, allow reassignment as before.
  const bookingUpdate: Record<string, unknown> = {
    scheduled_at: next.toISOString(),
  };
  if (!hasSplits) {
    bookingUpdate.assigned_to = assignedTo;
  }

  const { error: updateError } = await supabase
    .from("bookings")
    .update(bookingUpdate)
    .eq("id", id);
  if (updateError) return { ok: false, error: updateError.message };

  // Sync booking_assignees so all_assignee_ids in the scheduler grid
  // reflects only the new primary. Without this, stale secondary-crew
  // rows from a previous multi-person assignment stay in the junction
  // table, causing the card to appear in every old assignee's column as
  // well as the new one — the "duplicate booking" bug.
  //
  // SPLIT BOOKINGS: preserve booking_assignees entirely. The crew + their
  // segment offsets/durations belong with the booking; rescheduling
  // (which only changes scheduled_at above) doesn't affect them.
  if (!hasSplits) {
    await (supabase
      .from("booking_assignees" as never)
      .delete()
      .eq("booking_id" as never, id as never)) as unknown as Promise<unknown>;

    if (assignedTo) {
      await (supabase
        .from("booking_assignees" as never)
        .insert({
          organization_id: membership.organization_id,
          booking_id: id,
          membership_id: assignedTo,
          is_primary: true,
        } as never)) as unknown as Promise<unknown>;
    }
  }

  // Notify the newly-assigned cleaner when reassignment actually happens
  // (non-split bookings only — split crew doesn't change on reschedule).
  // Previously drag-drop silently moved jobs to a new cleaner without
  // any push, so the new owner had no idea they were on the hook.
  if (
    !hasSplits &&
    assignedTo &&
    assignedTo !== current.assigned_to
  ) {
    const { data: bookingForNotify } = (await supabase
      .from("bookings")
      .select(
        "service_type, address, client:clients ( name )",
      )
      .eq("id", id)
      .maybeSingle()) as unknown as {
      data: {
        service_type: string;
        address: string | null;
        client: { name: string | null } | null;
      } | null;
    };
    if (bookingForNotify) {
      notifyBookingAssignment(
        membership.organization_id,
        id,
        assignedTo,
        {
          clientName: bookingForNotify.client?.name ?? "A client",
          scheduledAt: next.toISOString(),
          serviceType: bookingForNotify.service_type,
          address: bookingForNotify.address,
        },
      );
    }
  }

  revalidatePath("/app/scheduling");
  revalidatePath("/app/bookings");
  revalidatePath("/app");
  return { ok: true };
}

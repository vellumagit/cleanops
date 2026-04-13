"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";

export type RescheduleResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Move a booking to a new (employee, day) slot. The hour-of-day is preserved
 * from the booking's existing scheduled_at; only the calendar date and the
 * assignee change. Pass `assignedTo: null` to drop into the unassigned tray.
 *
 * Returns a structured result instead of throwing so the client can show a
 * toast on conflicts without nuking the optimistic UI.
 */
export async function rescheduleBookingAction(
  id: string,
  assignedTo: string | null,
  /** Target date in YYYY-MM-DD form (local). */
  targetDate: string,
): Promise<RescheduleResult> {
  if (!id) return { ok: false, error: "Missing booking id" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return { ok: false, error: "Invalid target date" };
  }

  const { membership, supabase } = await getActionContext();
  if (membership.role !== "owner" && membership.role !== "admin") {
    return { ok: false, error: "Only owners and admins can reschedule" };
  }

  // Pull the current booking so we can preserve hour-of-day + duration.
  const { data: current, error: fetchError } = await supabase
    .from("bookings")
    .select("id, scheduled_at, duration_minutes, assigned_to")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!current) return { ok: false, error: "Booking not found" };

  const previous = new Date(current.scheduled_at);
  const [y, m, d] = targetDate.split("-").map(Number);
  const next = new Date(
    y,
    m - 1,
    d,
    previous.getHours(),
    previous.getMinutes(),
    0,
    0,
  );
  const nextEnd = new Date(
    next.getTime() + current.duration_minutes * 60_000,
  );

  // Conflict check: only when there's an actual assignee — unassigned drops
  // are always allowed.
  if (assignedTo) {
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

  const { error: updateError } = await supabase
    .from("bookings")
    .update({
      scheduled_at: next.toISOString(),
      assigned_to: assignedTo,
    })
    .eq("id", id);
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/app/scheduling");
  revalidatePath("/app/bookings");
  revalidatePath("/app");
  return { ok: true };
}

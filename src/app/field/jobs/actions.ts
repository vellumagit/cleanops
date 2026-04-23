"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { autoInvoiceOnJobComplete } from "@/lib/automations";

export type JobActionResult = { ok: true } | { ok: false; error: string };

function parseCoord(value: FormDataEntryValue | null): number | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (s.length === 0) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Start a job: flip the booking to in_progress and open a time entry tied to
 * it. Idempotent — calling twice doesn't double-clock.
 */
export async function startJobAction(
  formData: FormData,
): Promise<JobActionResult> {
  const bookingId = String(formData.get("booking_id") ?? "");
  if (!bookingId) return { ok: false, error: "Missing booking id" };
  const lat = parseCoord(formData.get("lat"));
  const lng = parseCoord(formData.get("lng"));

  const { membership, supabase } = await getActionContext();

  const { data: booking, error: fetchError } = await supabase
    .from("bookings")
    .select("id, assigned_to, status")
    .eq("id", bookingId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!booking) return { ok: false, error: "Job not found" };
  if (booking.assigned_to !== membership.id) {
    // Multi-crew: allow any assignee via booking_assignees junction.
    const { data: crewRow } = (await supabase
      .from("booking_assignees" as never)
      .select("id")
      .eq("booking_id" as never, bookingId as never)
      .eq("membership_id" as never, membership.id as never)
      .maybeSingle()) as unknown as { data: { id: string } | null };
    if (!crewRow) {
      return { ok: false, error: "This job isn't assigned to you" };
    }
  }

  // Update status if it's not already started or finished.
  if (booking.status !== "in_progress" && booking.status !== "completed") {
    const { error: updateError } = await supabase
      .from("bookings")
      .update({ status: "in_progress" })
      .eq("id", bookingId);
    if (updateError) return { ok: false, error: updateError.message };
  }

  // Only open a new time entry if there isn't already an open one for this job.
  const { data: openEntry } = await supabase
    .from("time_entries")
    .select("id")
    .eq("employee_id", membership.id)
    .eq("booking_id", bookingId)
    .is("clock_out_at", null)
    .limit(1)
    .maybeSingle();

  if (!openEntry) {
    const { error: insertError } = await supabase.from("time_entries").insert({
      organization_id: membership.organization_id,
      employee_id: membership.id,
      booking_id: bookingId,
      clock_in_at: new Date().toISOString(),
      clock_in_lat: lat,
      clock_in_lng: lng,
    });
    if (insertError) return { ok: false, error: insertError.message };
  }

  revalidatePath("/field/jobs");
  revalidatePath(`/field/jobs/${bookingId}`);
  revalidatePath("/field/clock");
  return { ok: true };
}

/**
 * Complete a job: flip the booking to completed and close any open time entry
 * tied to it.
 */
export async function completeJobAction(
  formData: FormData,
): Promise<JobActionResult> {
  const bookingId = String(formData.get("booking_id") ?? "");
  if (!bookingId) return { ok: false, error: "Missing booking id" };
  const lat = parseCoord(formData.get("lat"));
  const lng = parseCoord(formData.get("lng"));

  const { membership, supabase } = await getActionContext();

  const { data: booking, error: fetchError } = await supabase
    .from("bookings")
    .select("id, assigned_to")
    .eq("id", bookingId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!booking) return { ok: false, error: "Job not found" };
  if (booking.assigned_to !== membership.id) {
    // Multi-crew: allow any assignee via booking_assignees junction.
    const { data: crewRow } = (await supabase
      .from("booking_assignees" as never)
      .select("id")
      .eq("booking_id" as never, bookingId as never)
      .eq("membership_id" as never, membership.id as never)
      .maybeSingle()) as unknown as { data: { id: string } | null };
    if (!crewRow) {
      return { ok: false, error: "This job isn't assigned to you" };
    }
  }

  const now = new Date().toISOString();
  const { error: updateBookingError } = await supabase
    .from("bookings")
    .update({ status: "completed" })
    .eq("id", bookingId);
  if (updateBookingError) {
    return { ok: false, error: updateBookingError.message };
  }

  // Close any open time entry for this job.
  const { error: closeEntryError } = await supabase
    .from("time_entries")
    .update({
      clock_out_at: now,
      clock_out_lat: lat,
      clock_out_lng: lng,
    })
    .eq("employee_id", membership.id)
    .eq("booking_id", bookingId)
    .is("clock_out_at", null);
  if (closeEntryError) return { ok: false, error: closeEntryError.message };

  // Fire-and-forget: auto-generate a draft invoice for the completed job
  autoInvoiceOnJobComplete(bookingId).catch(() => {});

  revalidatePath("/field/jobs");
  revalidatePath(`/field/jobs/${bookingId}`);
  revalidatePath("/field/clock");
  revalidatePath("/app/invoices");
  return { ok: true };
}

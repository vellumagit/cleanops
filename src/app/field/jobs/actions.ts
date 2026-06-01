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

  // Refuse clock-in on a cancelled booking. A cleaner could be
  // holding a bookmarked /field/jobs/[id] for a job that got
  // cancelled while the page was open. Without this check, tapping
  // "Clock in" would create a time entry against the dead booking
  // and feed payroll for work that never happened.
  if (booking.status === "cancelled") {
    return {
      ok: false,
      error:
        "This job was cancelled. Talk to your manager if you think this is a mistake.",
    };
  }

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

  // Check for ANY open time entry for this employee, not just for this booking.
  // Without this, starting a new job while already clocked in elsewhere creates
  // two simultaneous open entries, which breaks payroll calculations.
  const { data: anyOpenEntry } = await supabase
    .from("time_entries")
    .select("id, booking_id")
    .eq("employee_id", membership.id)
    .is("clock_out_at", null)
    .limit(1)
    .maybeSingle();

  // Snapshot the employee's current pay rate for the new time entry
  // (only needed when we're about to insert one). Read paths prefer
  // this snapshot so historical hours don't retroactively re-price if
  // the employee's rate changes later. Fetched once up-front so both
  // insert branches use the same value.
  const { data: rateRow } = (await supabase
    .from("memberships")
    .select("pay_rate_cents")
    .eq("id", membership.id)
    .maybeSingle()) as unknown as {
    data: { pay_rate_cents: number | null } | null;
  };
  const payRateSnapshot = rateRow?.pay_rate_cents ?? null;

  if (anyOpenEntry) {
    if ((anyOpenEntry as { booking_id: string | null }).booking_id === bookingId) {
      // Already clocked in on this exact job — idempotent, nothing to do.
    } else {
      // Clocked in on a different job or a standalone clock-in — close it first
      // so the employee is never double-counted on payroll.
      const { error: closeError } = await supabase
        .from("time_entries")
        .update({
          clock_out_at: new Date().toISOString(),
          clock_out_lat: lat,
          clock_out_lng: lng,
        })
        .eq("id", anyOpenEntry.id)
        .eq("employee_id", membership.id);
      if (closeError) return { ok: false, error: closeError.message };

      const { error: insertError } = await supabase.from("time_entries").insert({
        organization_id: membership.organization_id,
        employee_id: membership.id,
        booking_id: bookingId,
        clock_in_at: new Date().toISOString(),
        clock_in_lat: lat,
        clock_in_lng: lng,
        pay_rate_cents_snapshot: payRateSnapshot,
      } as never);
      if (insertError) {
        const code = (insertError as { code?: string }).code;
        if (code === "23505") {
          return { ok: false, error: "You're already clocked in." };
        }
        return { ok: false, error: insertError.message };
      }
    }
  } else {
    // No open entry anywhere — create one for this job.
    const { error: insertError } = await supabase.from("time_entries").insert({
      organization_id: membership.organization_id,
      employee_id: membership.id,
      booking_id: bookingId,
      clock_in_at: new Date().toISOString(),
      clock_in_lat: lat,
      clock_in_lng: lng,
      pay_rate_cents_snapshot: payRateSnapshot,
    } as never);
    if (insertError) {
      const code = (insertError as { code?: string }).code;
      if (code === "23505") {
        return { ok: false, error: "You're already clocked in." };
      }
      return { ok: false, error: insertError.message };
    }
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

  // Auto-generate a draft invoice for the completed job. Awaited (not
  // fire-and-forget) so the draft is present by the time /app/invoices
  // revalidates and the owner reloads — previously users reported "I
  // finished a job and no invoice appeared" because the response
  // returned before the insert ran. The automation catches its own
  // errors internally, so awaiting it won't throw here.
  await autoInvoiceOnJobComplete(bookingId);

  revalidatePath("/field/jobs");
  revalidatePath(`/field/jobs/${bookingId}`);
  revalidatePath("/field/clock");
  revalidatePath("/app/invoices");
  return { ok: true };
}

/**
 * Record that the employee has acknowledged the GPS location-tracking notice.
 * Sets memberships.gps_consent_accepted_at to now, dismissing the sticky
 * banner shown by GpsConsentBanner for the rest of the session and all future
 * sessions on any device.
 */
export async function acceptGpsConsentAction(): Promise<void> {
  const { membership, supabase } = await getActionContext();
  await supabase
    .from("memberships")
    .update({ gps_consent_accepted_at: new Date().toISOString() } as never)
    .eq("id", membership.id);
  revalidatePath("/field", "layout");
}

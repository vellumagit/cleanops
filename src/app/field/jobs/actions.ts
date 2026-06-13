"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { autoInvoiceOnJobComplete } from "@/lib/automations";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deleteMemberCalendarEvent } from "@/lib/google-calendar";
import { sendPushToMembership } from "@/lib/push";

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

  // Snapshot the employee's current pay rate for the new time entry.
  // RLS lockdown (migration 20260601040000): pay_rate_cents is no
  // longer SELECT-able via end-user JWT. Use admin client scoped
  // strictly to this employee's own row in their own org.
  const adminForRate = createSupabaseAdminClient();
  const { data: rateRow } = (await adminForRate
    .from("memberships")
    .select("pay_rate_cents")
    .eq("id", membership.id)
    .eq("organization_id", membership.organization_id)
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

// ── Shift acceptance ───────────────────────────────────────────────
// Every assigned cleaner must confirm their shift. The booking_assignees
// row starts 'pending'; accepting flips it to 'accepted'. Declining
// removes them from the job and flags it unfilled (+ alerts the owner).

/** Confirm the current member's assignment to a booking. */
export async function acceptShiftAction(
  bookingId: string,
): Promise<JobActionResult> {
  if (!bookingId) return { ok: false, error: "Missing booking id" };
  const { membership } = await getActionContext();
  // Admin client: there's no member-level UPDATE policy on booking_assignees,
  // and we scope the write to this member's own row, so it's safe.
  const admin = createSupabaseAdminClient();
  const { error } = (await admin
    .from("booking_assignees" as never)
    .update({
      acceptance_status: "accepted",
      responded_at: new Date().toISOString(),
    } as never)
    .eq("booking_id" as never, bookingId as never)
    .eq("membership_id" as never, membership.id as never)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/field/jobs/${bookingId}`, "page");
  revalidatePath("/field/jobs", "page");
  revalidatePath("/field", "layout");
  return { ok: true };
}

/**
 * Decline a shift: remove the member from the job, clear the primary
 * assignment if it was theirs (so it surfaces as unfilled), drop their
 * calendar event, and alert the org's owners/admins to reassign.
 */
export async function declineShiftAction(
  bookingId: string,
): Promise<JobActionResult> {
  if (!bookingId) return { ok: false, error: "Missing booking id" };
  const { membership } = await getActionContext();
  const admin = createSupabaseAdminClient();

  const { data: booking } = (await admin
    .from("bookings")
    .select(
      "id, organization_id, assigned_to, scheduled_at, service_type, address, client:clients ( name )",
    )
    .eq("id", bookingId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      assigned_to: string | null;
      scheduled_at: string;
      service_type: string;
      address: string | null;
      client: { name: string | null } | null;
    } | null;
  };
  if (!booking) return { ok: false, error: "Job not found" };

  // Remove this cleaner from the crew.
  await (admin
    .from("booking_assignees" as never)
    .delete()
    .eq("booking_id" as never, bookingId as never)
    .eq("membership_id" as never, membership.id as never) as unknown as Promise<unknown>);

  // If they were the primary, clear it so the job reads as unfilled.
  if (booking.assigned_to === membership.id) {
    await (admin
      .from("bookings")
      .update({ assigned_to: null } as never)
      .eq("id", bookingId) as unknown as Promise<unknown>);
  }

  // Pull their personal calendar event for this job.
  deleteMemberCalendarEvent(membership.id, bookingId).catch(() => {});

  // Who declined (for the owner alert).
  const { data: me } = (await admin
    .from("memberships")
    .select("display_name, profile:profiles ( full_name )")
    .eq("id", membership.id)
    .maybeSingle()) as unknown as {
    data: {
      display_name: string | null;
      profile: { full_name: string | null } | null;
    } | null;
  };
  const who =
    me?.display_name ?? me?.profile?.full_name ?? "A cleaner";

  const { data: org } = (await admin
    .from("organizations")
    .select("timezone")
    .eq("id", booking.organization_id)
    .maybeSingle()) as unknown as { data: { timezone: string | null } | null };
  const when = new Date(booking.scheduled_at).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: org?.timezone ?? "America/Edmonton",
  });
  const title = "Shift declined — needs reassignment";
  const body = `${who} can't make ${booking.client?.name ?? "a job"} on ${when}${booking.address ? ` — ${booking.address}` : ""}.`;

  // Alert every owner/admin/manager so someone can re-cover it.
  const { data: managers } = (await admin
    .from("memberships")
    .select("id")
    .eq("organization_id", booking.organization_id)
    .in("role", ["owner", "admin", "manager"])
    .eq("status", "active")) as unknown as {
    data: Array<{ id: string }> | null;
  };
  const recipients = managers ?? [];
  if (recipients.length > 0) {
    await (admin.from("notifications" as never).insert(
      recipients.map((r) => ({
        organization_id: booking.organization_id,
        recipient_membership_id: r.id,
        type: "general",
        title,
        body,
        href: `/app/bookings/${bookingId}`,
      })) as never,
    ) as unknown as Promise<unknown>);
    await Promise.allSettled(
      recipients.map((r) =>
        sendPushToMembership(r.id, {
          title,
          body,
          href: `/app/bookings/${bookingId}`,
        }),
      ),
    );
  }

  revalidatePath(`/field/jobs/${bookingId}`, "page");
  revalidatePath("/field/jobs", "page");
  revalidatePath("/field", "layout");
  return { ok: true };
}

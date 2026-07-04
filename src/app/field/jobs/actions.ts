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

  // Authorization + acceptance in one lookup. The caller must be assigned to
  // this job, and (when tracked via the junction) must have ACCEPTED their
  // shift first. The UI hides Start for a pending cleaner, but a server action
  // is a POST endpoint that can be invoked directly — enforce it here too.
  // Note: fetch the junction row even for the primary (assigned_to), otherwise
  // a pending PRIMARY would slip past the acceptance gate.
  const isPrimary = booking.assigned_to === membership.id;
  const { data: crewRow } = (await supabase
    .from("booking_assignees")
    .select("id, acceptance_status")
    .eq("booking_id", bookingId)
    .eq("membership_id", membership.id)
    .maybeSingle()) as unknown as {
    data: { id: string; acceptance_status: string | null } | null;
  };
  if (!isPrimary && !crewRow) {
    return { ok: false, error: "This job isn't assigned to you" };
  }
  if (crewRow?.acceptance_status === "pending") {
    return { ok: false, error: "Please accept this shift before starting it." };
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
      });
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
    });
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
    .select("id, assigned_to, status")
    .eq("id", bookingId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!booking) return { ok: false, error: "Job not found" };

  // Don't resurrect a cancelled job. Without this, a cleaner tapping "Complete"
  // on a stale page (or a replayed request) after the owner cancelled would
  // flip it back to completed AND fire a draft invoice for work called off.
  if (booking.status === "cancelled") {
    return {
      ok: false,
      error:
        "This job was cancelled. Talk to your manager if you think this is a mistake.",
    };
  }

  // Authorization + acceptance (see startJobAction). Fetch the junction row
  // even for the primary so a pending primary can't complete either.
  const isPrimary = booking.assigned_to === membership.id;
  const { data: crewRow } = (await supabase
    .from("booking_assignees")
    .select("id, acceptance_status")
    .eq("booking_id", bookingId)
    .eq("membership_id", membership.id)
    .maybeSingle()) as unknown as {
    data: { id: string; acceptance_status: string | null } | null;
  };
  if (!isPrimary && !crewRow) {
    return { ok: false, error: "This job isn't assigned to you" };
  }
  if (crewRow?.acceptance_status === "pending") {
    return { ok: false, error: "Please accept this shift first." };
  }

  const now = new Date().toISOString();

  // Mark THIS cleaner's own segment complete, and close their open time entry.
  // (completed_at is cast around — it isn't in the generated types yet.)
  await (supabase
    .from("booking_assignees")
    .update({ completed_at: now } as never)
    .eq("booking_id", bookingId)
    .eq("membership_id", membership.id) as unknown as Promise<unknown>);

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

  // A split shift is a hand-off between people (2+ segments, each with its own
  // duration). Don't finish (or invoice) the booking until EVERY segment is
  // done — otherwise the first cleaner tapping Complete ends the job and bills
  // the full duration while later cleaners still have to work. Team/solo jobs
  // (no split segments) keep completing on the first tap.
  const { data: allAssignees } = (await supabase
    .from("booking_assignees" as never)
    .select("membership_id, split_duration_minutes, completed_at")
    .eq("booking_id" as never, bookingId as never)) as unknown as {
    data: Array<{
      membership_id: string;
      split_duration_minutes: number | null;
      completed_at: string | null;
    }> | null;
  };
  const rows = allAssignees ?? [];
  const isSplit =
    rows.filter((r) => r.split_duration_minutes != null).length >= 2;
  if (isSplit) {
    // `rows` was read before our completed_at write landed, so count the caller
    // as done and require every OTHER segment to already be complete.
    const allDone = rows.every(
      (r) => r.membership_id === membership.id || r.completed_at != null,
    );
    if (!allDone) {
      // The caller's part is done; the booking stays open for the rest.
      revalidatePath("/field/jobs");
      revalidatePath(`/field/jobs/${bookingId}`);
      revalidatePath("/field/clock");
      return { ok: true };
    }
  }

  const { error: updateBookingError } = await supabase
    .from("bookings")
    .update({ status: "completed" })
    .eq("id", bookingId);
  if (updateBookingError) {
    return { ok: false, error: updateBookingError.message };
  }

  // Auto-generate a draft invoice for the completed job. Awaited (not
  // fire-and-forget) so the draft is present by the time /app/invoices
  // revalidates and the owner reloads. The automation catches its own errors
  // internally, so awaiting it won't throw here.
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
    .update({ gps_consent_accepted_at: new Date().toISOString() })
    .eq("id", membership.id);
  revalidatePath("/field", "layout");
}

// ── Shift acceptance ───────────────────────────────────────────────
// Every assigned cleaner must confirm their shift. The booking_assignees
// row starts 'pending'; accepting flips it to 'accepted'. Declining
// removes them from the job and flags it unfilled (+ alerts the owner).

/** Confirm the current member's assignment to a booking. */
/**
 * Email the org's owners/admins/managers when a cleaner accepts or declines a
 * shift — "the account(s) that sent the job". Best-effort: a failure never
 * blocks the accept/decline. Internal email (sendEmail), so it bypasses the
 * client-facing CLIENT_EMAILS_PAUSED switch.
 */
async function emailShiftResponse(opts: {
  orgId: string;
  employeeName: string;
  action: "accepted" | "declined";
  clientName: string;
  whenStr: string;
  address: string | null;
  reason?: string | null;
  orgName: string | null;
  brandColor?: string | null;
}): Promise<void> {
  try {
    const { getOrgManagementRecipients } = await import("@/lib/org-recipients");
    const { sendEmail } = await import("@/lib/email");
    const { shiftResponseEmail } = await import("@/lib/email-templates");
    const recipients = await getOrgManagementRecipients(opts.orgId);
    if (recipients.length === 0) return;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
    for (const r of recipients) {
      const template = shiftResponseEmail({
        recipientName: r.fullName ?? "there",
        employeeName: opts.employeeName,
        action: opts.action,
        clientName: opts.clientName,
        whenStr: opts.whenStr,
        address: opts.address,
        reason: opts.reason ?? null,
        orgName: opts.orgName ?? "your team",
        dashboardUrl: `${siteUrl}/app/bookings`,
        brandColor: opts.brandColor ?? undefined,
      });
      await sendEmail({
        to: r.email,
        toName: r.fullName ?? undefined,
        ...template,
      });
    }
  } catch (err) {
    console.error("[shift-response] email failed:", err);
  }
}

export async function acceptShiftAction(
  bookingId: string,
): Promise<JobActionResult> {
  if (!bookingId) return { ok: false, error: "Missing booking id" };
  const { membership } = await getActionContext();
  // Admin client: there's no member-level UPDATE policy on booking_assignees,
  // and we scope the write to this member's own row, so it's safe.
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { error } = (await admin
    .from("booking_assignees")
    .update({
      acceptance_status: "accepted",
      responded_at: now,
    })
    .eq("booking_id", bookingId)
    .eq("membership_id", membership.id)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };

  // Option 2: confirming a recurring shift confirms the whole standing
  // series at once — the cleaner vouches for the client, not every visit.
  // Auto-accept all their other pending occurrences in the same series.
  const { data: bk } = (await admin
    .from("bookings")
    .select("series_id")
    .eq("id", bookingId)
    .maybeSingle()) as unknown as { data: { series_id: string | null } | null };
  if (bk?.series_id) {
    const { data: sibs } = (await admin
      .from("bookings")
      .select("id")
      .eq("series_id", bk.series_id)
      .gte("scheduled_at", now)) as unknown as {
      data: Array<{ id: string }> | null;
    };
    const ids = (sibs ?? []).map((b) => b.id);
    if (ids.length > 0) {
      await (admin
        .from("booking_assignees")
        .update({ acceptance_status: "accepted", responded_at: now })
        .eq("membership_id", membership.id)
        .eq("acceptance_status", "pending")
        .in("booking_id", ids) as unknown as Promise<unknown>);
    }
  }

  // Email the management accounts that this cleaner accepted (best-effort).
  try {
    const { data: bkInfo } = (await admin
      .from("bookings")
      .select("scheduled_at, address, organization_id, client:clients ( name )")
      .eq("id", bookingId)
      .maybeSingle()) as unknown as {
      data: {
        scheduled_at: string;
        address: string | null;
        organization_id: string;
        client: { name: string | null } | null;
      } | null;
    };
    if (bkInfo) {
      const { data: meInfo } = (await admin
        .from("memberships")
        .select("display_name, profile:profiles ( full_name )")
        .eq("id", membership.id)
        .maybeSingle()) as unknown as {
        data: {
          display_name: string | null;
          profile: { full_name: string | null } | null;
        } | null;
      };
      const { data: orgInfo } = (await admin
        .from("organizations")
        .select("name, brand_color, timezone")
        .eq("id", bkInfo.organization_id)
        .maybeSingle()) as unknown as {
        data: {
          name: string | null;
          brand_color: string | null;
          timezone: string | null;
        } | null;
      };
      const whoName =
        meInfo?.display_name ?? meInfo?.profile?.full_name ?? "A cleaner";
      const whenStr = new Date(bkInfo.scheduled_at).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: orgInfo?.timezone ?? "America/Edmonton",
      });
      await emailShiftResponse({
        orgId: bkInfo.organization_id,
        employeeName: whoName,
        action: "accepted",
        clientName: bkInfo.client?.name ?? "a client",
        whenStr,
        address: bkInfo.address,
        orgName: orgInfo?.name ?? null,
        brandColor: orgInfo?.brand_color,
      });
    }
  } catch (err) {
    console.error("[shift-response] accept email failed:", err);
  }

  revalidatePath(`/field/jobs/${bookingId}`, "page");
  revalidatePath("/field/jobs", "page");
  revalidatePath("/field", "layout");
  return { ok: true };
}

/**
 * Shared core for a cleaner dropping a shift: remove them from the job,
 * clear the primary assignment if it was theirs (so it surfaces as
 * unfilled), drop their calendar event, and alert owners/admins/managers.
 *
 * `reason` (when given) and `seriesStopRequest` shape the owner alert.
 * seriesStopRequest = the cleaner is also asking to be taken off the
 * standing recurring client going forward (their FUTURE occurrences are
 * intentionally left in place for the owner to reassign).
 */
async function dropShift(
  membershipId: string,
  bookingId: string,
  opts: { titleVerb: string; reason?: string; seriesStopRequest?: boolean },
): Promise<JobActionResult> {
  const admin = createSupabaseAdminClient();

  const { data: booking } = (await admin
    .from("bookings")
    .select(
      "id, organization_id, assigned_to, scheduled_at, service_type, address, series_id, client:clients ( name )",
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
      series_id: string | null;
      client: { name: string | null } | null;
    } | null;
  };
  if (!booking) return { ok: false, error: "Job not found" };

  // Authorization: the caller must actually be on this booking (an assignee
  // row, or the primary). dropShift runs on the admin client against ANY
  // booking id, so without this a cleaner could drop / alert managers on a
  // booking in another org entirely.
  const { data: myRow } = (await admin
    .from("booking_assignees")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("membership_id", membershipId)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  const wasPrimary = booking.assigned_to === membershipId;
  if (!myRow && !wasPrimary) {
    return { ok: false, error: "This shift isn't assigned to you." };
  }

  // Remove this cleaner from THIS occurrence only.
  await (admin
    .from("booking_assignees")
    .delete()
    .eq("booking_id", bookingId)
    .eq("membership_id", membershipId) as unknown as Promise<unknown>);

  // If they were the primary, promote a remaining crew member so a job
  // that still has crew doesn't read as "unfilled". Only null it out when
  // nobody is left.
  if (wasPrimary) {
    const { data: remaining } = (await admin
      .from("booking_assignees")
      .select("membership_id")
      .eq("booking_id", bookingId)
      .order("split_index", {
        ascending: true,
        nullsFirst: true,
      })
      .limit(1)) as unknown as {
      data: Array<{ membership_id: string }> | null;
    };
    const next = remaining?.[0]?.membership_id ?? null;
    await (admin
      .from("bookings")
      .update({ assigned_to: next })
      .eq("id", bookingId) as unknown as Promise<unknown>);
    if (next) {
      await (admin
        .from("booking_assignees")
        .update({ is_primary: true })
        .eq("booking_id", bookingId)
        .eq("membership_id", next) as unknown as Promise<unknown>);
    }
  }

  deleteMemberCalendarEvent(membershipId, bookingId).catch(() => {});

  const { data: me } = (await admin
    .from("memberships")
    .select("display_name, profile:profiles ( full_name )")
    .eq("id", membershipId)
    .maybeSingle()) as unknown as {
    data: {
      display_name: string | null;
      profile: { full_name: string | null } | null;
    } | null;
  };
  const who = me?.display_name ?? me?.profile?.full_name ?? "A cleaner";

  const { data: org } = (await admin
    .from("organizations")
    .select("timezone, name, brand_color")
    .eq("id", booking.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      timezone: string | null;
      name: string | null;
      brand_color: string | null;
    } | null;
  };
  const when = new Date(booking.scheduled_at).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: org?.timezone ?? "America/Edmonton",
  });
  const client = booking.client?.name ?? "a job";
  const title = opts.seriesStopRequest
    ? "Shift cancelled + recurring change request"
    : `Shift ${opts.titleVerb} — needs reassignment`;
  let body = `${who} can't make ${client} on ${when}${booking.address ? ` — ${booking.address}` : ""}.`;
  if (opts.reason) body += ` Reason: “${opts.reason}”.`;
  if (opts.seriesStopRequest) {
    body += ` They're also requesting to be taken off the recurring ${client} going forward — please reassign the series.`;
  }

  const { data: managers } = (await admin
    .from("memberships")
    .select("id")
    .eq("organization_id", booking.organization_id)
    .in("role", ["owner", "admin", "manager"])
    .eq("status", "active")) as unknown as {
    data: Array<{ id: string }> | null;
  };
  const recipients = managers ?? [];
  const href = `/app/bookings/${bookingId}`;
  if (recipients.length > 0) {
    await (admin.from("notifications").insert(
      recipients.map((r) => ({
        organization_id: booking.organization_id,
        recipient_membership_id: r.id,
        type: "general" as const,
        title,
        body,
        href,
      })),
    ) as unknown as Promise<unknown>);
    await Promise.allSettled(
      recipients.map((r) => sendPushToMembership(r.id, { title, body, href })),
    );
  }

  // Email the management accounts that this cleaner declined (best-effort).
  await emailShiftResponse({
    orgId: booking.organization_id,
    employeeName: who,
    action: "declined",
    clientName: booking.client?.name ?? "a client",
    whenStr: when,
    address: booking.address ?? null,
    reason: opts.reason ?? null,
    orgName: org?.name ?? null,
    brandColor: org?.brand_color,
  });

  revalidatePath(`/field/jobs/${bookingId}`, "page");
  revalidatePath("/field/jobs", "page");
  revalidatePath("/field", "layout");
  return { ok: true };
}

/**
 * Decline a still-pending shift (cleaner hadn't accepted yet). Quick, no
 * reason required.
 */
export async function declineShiftAction(
  bookingId: string,
): Promise<JobActionResult> {
  if (!bookingId) return { ok: false, error: "Missing booking id" };
  const { membership } = await getActionContext();
  return dropShift(membership.id, bookingId, { titleVerb: "declined" });
}

/**
 * Cancel a shift the cleaner had already ACCEPTED. Reason required.
 * Cancels only this occurrence.
 */
export async function cancelShiftAction(
  bookingId: string,
  reason: string,
): Promise<JobActionResult> {
  if (!bookingId) return { ok: false, error: "Missing booking id" };
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 3) {
    return { ok: false, error: "Please add a short reason for cancelling." };
  }
  const { membership } = await getActionContext();
  return dropShift(membership.id, bookingId, {
    titleVerb: "cancelled",
    reason: trimmed,
  });
}

/**
 * Cancel this occurrence now AND request to be taken off the recurring
 * client going forward. Future occurrences stay assigned until the owner
 * reassigns the series. Reason required.
 */
export async function requestSeriesStopAction(
  bookingId: string,
  reason: string,
): Promise<JobActionResult> {
  if (!bookingId) return { ok: false, error: "Missing booking id" };
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 3) {
    return { ok: false, error: "Please add a short reason." };
  }
  const { membership } = await getActionContext();

  // Drop first — dropShift authorizes that the caller is actually on this
  // booking. Only then record the persistent request (so a forged booking
  // id can't inject a request row into another org's coverage panel).
  const result = await dropShift(membership.id, bookingId, {
    titleVerb: "cancelled",
    reason: trimmed,
    seriesStopRequest: true,
  });
  if (!result.ok) return result;

  const admin = createSupabaseAdminClient();
  const { data: bk } = (await admin
    .from("bookings")
    .select("organization_id, series_id")
    .eq("id", bookingId)
    .maybeSingle()) as unknown as {
    data: { organization_id: string; series_id: string | null } | null;
  };
  if (bk) {
    await (admin.from("shift_change_requests").insert({
      organization_id: bk.organization_id,
      membership_id: membership.id,
      booking_id: bookingId,
      series_id: bk.series_id,
      kind: "series_stop",
      reason: trimmed,
      status: "open",
    }) as unknown as Promise<unknown>);
  }

  return result;
}

/**
 * Call in sick for a shift — same removal + owner alert as a cancel, but the
 * reason is pre-filled so it's a one-tap action for the cleaner.
 */
export async function callInSickAction(
  bookingId: string,
): Promise<JobActionResult> {
  if (!bookingId) return { ok: false, error: "Missing booking id" };
  const { membership } = await getActionContext();
  return dropShift(membership.id, bookingId, {
    titleVerb: "cancelled (sick)",
    reason: "Called in sick",
  });
}

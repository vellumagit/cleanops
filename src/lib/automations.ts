/**
 * Internal automations — fire-and-forget side effects that make the
 * platform feel alive. Every function here swallows errors so it
 * can never break the primary action.
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToMembership, sendPushToOrg } from "@/lib/push";

const admin = () => createSupabaseAdminClient();

/**
 * Check whether a named automation is enabled for an org. Absent setting =
 * enabled (matches the default semantics of /app/settings/automations).
 */
async function isAutomationEnabled(
  organizationId: string,
  key: string,
): Promise<boolean> {
  try {
    const { data } = await admin()
      .from("organizations")
      .select("automation_settings")
      .eq("id", organizationId)
      .maybeSingle() as unknown as {
      data: { automation_settings: Record<string, { enabled?: boolean }> | null } | null;
    };
    return data?.automation_settings?.[key]?.enabled !== false;
  } catch {
    // If we can't read the setting, default to enabled — same posture as the
    // settings page. Never block a primary action on a toggle lookup.
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────
// 1. Auto-generate a draft invoice when a job is completed
// ─────────────────────────────────────────────────────────────────

export async function autoInvoiceOnJobComplete(bookingId: string) {
  try {
    const db = admin();

    // Fetch the completed booking with client info
    const { data: booking } = await db
      .from("bookings")
      .select("id, organization_id, client_id, total_cents, service_type, address, duration_minutes, scheduled_at")
      .eq("id", bookingId)
      .maybeSingle();

    if (!booking || !booking.client_id) return;

    // Check if an invoice already exists for this booking
    const { data: existing } = await db
      .from("invoices")
      .select("id")
      .eq("booking_id", booking.id)
      .limit(1)
      .maybeSingle();

    if (existing) return; // already invoiced

    // Get the next invoice number for this org
    const { count } = await db
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", booking.organization_id);

    const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, "0")}`;

    const scheduledDate = new Date(booking.scheduled_at);
    const dueDate = new Date(scheduledDate);
    dueDate.setDate(dueDate.getDate() + 14); // Net 14

    await (db.from("invoices").insert({
      organization_id: booking.organization_id,
      client_id: booking.client_id,
      booking_id: booking.id,
      invoice_number: invoiceNumber,
      status: "draft",
      amount_cents: booking.total_cents,
      due_date: dueDate.toISOString().split("T")[0],
      line_items: [
        {
          description: `${humanize(booking.service_type)} — ${booking.address ?? "on site"}`,
          quantity: 1,
          unit_price_cents: booking.total_cents,
        },
      ],
    } as never) as unknown as Promise<unknown>);

    console.log(`[auto] Draft invoice ${invoiceNumber} created for booking ${bookingId}`);
  } catch (err) {
    console.error("[auto] autoInvoiceOnJobComplete failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 2. Notify employee about upcoming job (called by cron)
// ─────────────────────────────────────────────────────────────────

export async function notifyUpcomingJobs() {
  try {
    const db = admin();
    const now = new Date();
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);

    // Find jobs starting in the next hour that are assigned
    const { data: jobs } = await db
      .from("bookings")
      .select(`
        id, organization_id, assigned_to, scheduled_at, service_type, address,
        client:clients ( name )
      `)
      .not("assigned_to", "is", null)
      .gte("scheduled_at", now.toISOString())
      .lte("scheduled_at", in1h.toISOString())
      .in("status", ["pending", "confirmed"]);

    if (!jobs || jobs.length === 0) return 0;

    // Dedupe — check what's already been notified
    const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: existingNotifs } = (await db
      .from("notifications" as never)
      .select("href")
      .eq("type" as never, "general" as never)
      .gte("created_at" as never, cutoff as never)
      .limit(500)) as unknown as {
      data: Array<{ href: string | null }> | null;
    };

    const alreadyNotified = new Set(
      (existingNotifs ?? []).map((n) => (n.href ?? "").split("/").pop()),
    );

    const rows = jobs
      .filter((j) => !alreadyNotified.has(j.id))
      .map((j) => {
        const clientName = (j.client as unknown as { name: string } | null)?.name ?? "a client";
        const when = new Date(j.scheduled_at).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        });
        return {
          organization_id: j.organization_id,
          recipient_membership_id: j.assigned_to,
          type: "general" as const,
          title: "Job starting soon",
          body: `${humanize(j.service_type)} for ${clientName} at ${when}${j.address ? ` — ${j.address}` : ""}`,
          href: `/field/jobs/${j.id}`,
        };
      });

    if (rows.length === 0) return 0;

    await (db.from("notifications" as never).insert(rows as never) as unknown as Promise<unknown>);

    // Fire push notifications to each assigned employee
    await Promise.allSettled(
      rows.map((r) =>
        r.recipient_membership_id
          ? sendPushToMembership(r.recipient_membership_id, {
              title: r.title,
              body: r.body,
              href: r.href,
            })
          : Promise.resolve(),
      ),
    );

    return rows.length;
  } catch (err) {
    console.error("[auto] notifyUpcomingJobs failed:", err);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────
// 3. Auto-assign training modules to new team members
// ─────────────────────────────────────────────────────────────────

export async function autoAssignTraining(
  organizationId: string,
  membershipId: string,
) {
  try {
    const db = admin();

    // Get all published training modules for this org
    const { data: modules } = await (db
      .from("training_modules")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("status" as never, "published" as never) as unknown as Promise<{
      data: Array<{ id: string }> | null;
    }>);

    if (!modules || modules.length === 0) return;

    // Check which ones are already assigned
    const { data: existing } = await db
      .from("training_assignments")
      .select("module_id")
      .eq("employee_id", membershipId)
      .limit(500);

    const assignedIds = new Set((existing ?? []).map((a) => a.module_id));
    const toAssign = modules.filter((m) => !assignedIds.has(m.id));

    if (toAssign.length === 0) return;

    const rows = toAssign.map((m) => ({
      organization_id: organizationId,
      employee_id: membershipId,
      module_id: m.id,
      completed_step_ids: [],
    }));

    await (db.from("training_assignments").insert(rows as never) as unknown as Promise<unknown>);
    console.log(`[auto] Assigned ${toAssign.length} training modules to new member ${membershipId}`);
  } catch (err) {
    console.error("[auto] autoAssignTraining failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 4. Auto-create booking when estimate is approved
// ─────────────────────────────────────────────────────────────────

export async function autoBookingOnEstimateApproval(estimateId: string) {
  try {
    const db = admin();

    const { data: estimate } = await db
      .from("estimates")
      .select("id, organization_id, client_id, total_cents, service_description, notes")
      .eq("id", estimateId)
      .maybeSingle();

    if (!estimate) return;

    // Check if a booking already exists linked to this estimate via proper FK
    const { data: existing } = await db
      .from("bookings")
      .select("id")
      .eq("estimate_id" as never, estimateId as never)
      .limit(1)
      .maybeSingle();

    if (existing) return; // already converted

    // Infer service_type from the estimate's description
    const serviceType = inferServiceType(estimate.service_description);

    // Create a pending booking — manager still needs to set date/time/assignment
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    const { data: newBooking } = (await (db.from("bookings").insert({
      organization_id: estimate.organization_id,
      client_id: estimate.client_id,
      estimate_id: estimateId,
      scheduled_at: tomorrow.toISOString(),
      duration_minutes: 120,
      service_type: serviceType,
      status: "pending",
      total_cents: estimate.total_cents,
      notes: estimate.service_description ?? "",
    } as never).select("id").single() as unknown as Promise<{
      data: { id: string } | null;
    }>));

    const bookingHref = newBooking
      ? `/app/bookings/${newBooking.id}`
      : "/app/bookings";

    // Create a notification for the org
    const notifPayload = {
      title: "Estimate approved — booking created",
      body: `A new pending ${humanize(serviceType).toLowerCase()} booking was auto-created. Set the date and assign a cleaner.`,
      href: bookingHref,
    };

    await (db.from("notifications" as never).insert({
      organization_id: estimate.organization_id,
      type: "general",
      ...notifPayload,
    } as never) as unknown as Promise<unknown>);

    // Push to all org members (org-wide notification)
    sendPushToOrg(estimate.organization_id, notifPayload).catch(() => {});

    console.log(`[auto] Booking created from approved estimate ${estimateId}`);
  } catch (err) {
    console.error("[auto] autoBookingOnEstimateApproval failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 5. Alert on stale estimates (called by cron)
// ─────────────────────────────────────────────────────────────────

export async function alertStaleEstimates() {
  try {
    const db = admin();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Find estimates that have been "sent" for 7+ days without a decision
    const { data: stale } = await db
      .from("estimates")
      .select("id, organization_id, total_cents, client:clients ( name )")
      .eq("status", "sent")
      .lte("sent_at", sevenDaysAgo.toISOString())
      .is("decided_at", null);

    if (!stale || stale.length === 0) return 0;

    // Dedupe — don't re-notify for the same estimate within 7 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    const { data: existingNotifs } = (await db
      .from("notifications" as never)
      .select("href")
      .eq("type" as never, "general" as never)
      .gte("created_at" as never, cutoff.toISOString() as never)
      .ilike("title" as never, "%stale estimate%" as never)
      .limit(500)) as unknown as {
      data: Array<{ href: string | null }> | null;
    };

    const alreadyNotified = new Set(
      (existingNotifs ?? []).map((n) => (n.href ?? "").split("/").pop()),
    );

    const toNotify = stale.filter((e) => !alreadyNotified.has(e.id));
    if (toNotify.length === 0) return 0;

    const rows = toNotify.map((e) => {
      const clientName = (e.client as unknown as { name: string } | null)?.name ?? "a client";
      return {
        organization_id: e.organization_id,
        type: "general" as const,
        title: "Stale estimate — needs follow-up",
        body: `Estimate for ${clientName} ($${((e.total_cents ?? 0) / 100).toFixed(0)}) has been pending for 7+ days.`,
        href: `/app/estimates/${e.id}/edit`,
      };
    });

    await (db.from("notifications" as never).insert(rows as never) as unknown as Promise<unknown>);

    // Push to each org (org-wide notifications)
    const orgIds = [...new Set(rows.map((r) => r.organization_id))];
    await Promise.allSettled(
      orgIds.map((orgId) => {
        const orgRows = rows.filter((r) => r.organization_id === orgId);
        return sendPushToOrg(orgId, {
          title: `${orgRows.length} stale estimate${orgRows.length > 1 ? "s" : ""} need follow-up`,
          body: orgRows.map((r) => r.body).join(" · "),
          href: "/app/estimates",
        });
      }),
    );

    return rows.length;
  } catch (err) {
    console.error("[auto] alertStaleEstimates failed:", err);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────
// 6. Post system events to the feed
// ─────────────────────────────────────────────────────────────────

export async function postSystemFeedEvent(
  organizationId: string,
  /** The membership that "authored" the event — usually the actor */
  authorMembershipId: string,
  message: string,
) {
  try {
    const db = admin();
    await (db.from("feed_posts" as never).insert({
      organization_id: organizationId,
      author_id: authorMembershipId,
      body: message,
    } as never) as unknown as Promise<unknown>);
  } catch (err) {
    console.error("[auto] postSystemFeedEvent failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 7a. Send booking confirmation email to client on booking creation
// ─────────────────────────────────────────────────────────────────

export async function sendBookingConfirmation(bookingId: string) {
  try {
    const db = admin();
    const { sendOrgEmail } = await import("@/lib/email");
    const { bookingConfirmationEmail } = await import("@/lib/email-templates");

    const { data: booking } = await db
      .from("bookings")
      .select(`
        id, organization_id, scheduled_at, service_type, address,
        client:clients ( name, email )
      `)
      .eq("id", bookingId)
      .maybeSingle();

    if (!booking || !booking.client?.email) return;

    if (!(await isAutomationEnabled(booking.organization_id, "booking_confirmation_email"))) {
      console.log(`[auto] Booking confirmation paused for org ${booking.organization_id}`);
      return;
    }

    const { data: org } = await db
      .from("organizations")
      .select("name, brand_color, logo_url")
      .eq("id", booking.organization_id)
      .maybeSingle() as unknown as {
      data: { name: string; brand_color: string | null; logo_url: string | null } | null;
    };

    const dateTime = new Date(booking.scheduled_at).toLocaleString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const template = bookingConfirmationEmail({
      clientName: booking.client.name ?? "there",
      orgName: org?.name ?? "your service provider",
      serviceName: humanize(booking.service_type),
      dateTime,
      address: booking.address ?? "(address to be confirmed)",
      brandColor: org?.brand_color ?? undefined,
      logoUrl: org?.logo_url ?? undefined,
    });

    sendOrgEmail(booking.organization_id, {
      to: booking.client.email,
      toName: booking.client.name ?? undefined,
      ...template,
    });

    console.log(`[auto] Booking confirmation sent to ${booking.client.email}`);
  } catch (err) {
    console.error("[auto] sendBookingConfirmation failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 7. Notify employee when they're assigned to a booking
// ─────────────────────────────────────────────────────────────────

export async function notifyBookingAssignment(
  organizationId: string,
  bookingId: string,
  assignedTo: string,
  meta: { clientName: string; scheduledAt: string; serviceType: string; address: string | null },
) {
  try {
    const db = admin();
    const when = new Date(meta.scheduledAt).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const title = "You've been assigned a job";
    const body = `${humanize(meta.serviceType)} for ${meta.clientName} on ${when}${meta.address ? ` — ${meta.address}` : ""}`;

    await (db.from("notifications" as never).insert({
      organization_id: organizationId,
      recipient_membership_id: assignedTo,
      type: "general",
      title,
      body,
      href: `/field/jobs/${bookingId}`,
    } as never) as unknown as Promise<unknown>);

    sendPushToMembership(assignedTo, { title, body, href: `/field/jobs/${bookingId}` }).catch(() => {});
    console.log(`[auto] Notified ${assignedTo} about booking assignment ${bookingId}`);
  } catch (err) {
    console.error("[auto] notifyBookingAssignment failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 8. Auto-send review request + receipt when invoice is fully paid
// ─────────────────────────────────────────────────────────────────

export async function autoOnInvoicePaid(invoiceId: string) {
  try {
    const db = admin();
    const { sendOrgEmail } = await import("@/lib/email");
    const { reviewRequestEmail, paymentReceiptEmail } = await import("@/lib/email-templates");
    const { formatCurrencyCents } = await import("@/lib/format");
    const { getOrgCurrency } = await import("@/lib/org-currency");
    const { generateClaimToken } = await import("@/lib/claim-token");

    const { data: invoice } = await db
      .from("invoices")
      .select(`
        id, number, organization_id, amount_cents, public_token, paid_at, booking_id,
        client:clients ( id, name, email )
      `)
      .eq("id", invoiceId)
      .maybeSingle();

    if (!invoice || !invoice.client?.email) return;

    if (!(await isAutomationEnabled(invoice.organization_id, "invoice_paid_receipt"))) {
      console.log(`[auto] Receipt + review request paused for org ${invoice.organization_id}`);
      return;
    }

    const { data: orgData } = await db
      .from("organizations")
      .select("name, brand_color, logo_url")
      .eq("id", invoice.organization_id)
      .maybeSingle() as unknown as {
      data: { name: string; brand_color: string | null; logo_url: string | null } | null;
    };

    const orgName = orgData?.name ?? "Your service provider";
    const brandColor = orgData?.brand_color ?? undefined;
    const logoUrl = orgData?.logo_url ?? undefined;
    const currency = await getOrgCurrency(invoice.organization_id);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

    // A) Send payment receipt
    const receiptTemplate = paymentReceiptEmail({
      clientName: invoice.client.name ?? "there",
      orgName,
      invoiceNumber: invoice.number ?? invoiceId.slice(0, 8).toUpperCase(),
      amountFormatted: formatCurrencyCents(invoice.amount_cents, currency),
      paidDate: new Date(invoice.paid_at ?? new Date()).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      publicUrl: invoice.public_token ? `${siteUrl}/i/${invoice.public_token}` : siteUrl,
      brandColor,
      logoUrl,
    });

    sendOrgEmail(invoice.organization_id, {
      to: invoice.client.email,
      toName: invoice.client.name ?? undefined,
      ...receiptTemplate,
    });

    // B) Auto-generate review token and send review request
    // Check if review_token already exists
    const { data: existing } = (await db
      .from("invoices")
      .select("review_token")
      .eq("id", invoiceId)
      .maybeSingle()) as unknown as {
      data: { review_token: string | null } | null;
    };

    let reviewToken = existing?.review_token ?? null;
    if (!reviewToken) {
      reviewToken = generateClaimToken();
      await db
        .from("invoices")
        .update({ review_token: reviewToken } as never)
        .eq("id", invoiceId);
    }

    const reviewTemplate = reviewRequestEmail({
      clientName: invoice.client.name ?? "there",
      orgName,
      reviewUrl: `${siteUrl}/review/${reviewToken}`,
      brandColor,
      logoUrl,
    });

    // Delay review request by ~2 seconds so it doesn't arrive in the
    // same instant as the receipt (looks spammy). Fire-and-forget.
    setTimeout(() => {
      sendOrgEmail(invoice.organization_id, {
        to: invoice.client.email!,
        toName: invoice.client.name ?? undefined,
        ...reviewTemplate,
      });
    }, 2000);

    console.log(`[auto] Receipt + review request sent for invoice ${invoiceId}`);
  } catch (err) {
    console.error("[auto] autoOnInvoicePaid failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 9. Notify admin(s) when a review is submitted
// ─────────────────────────────────────────────────────────────────

export async function notifyReviewSubmitted(
  organizationId: string,
  review: { rating: number; clientName: string; employeeName: string | null; reviewId: string },
) {
  try {
    const db = admin();
    const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
    const title = `New ${review.rating}-star review`;
    const body = `${review.clientName} left a ${stars} review${review.employeeName ? ` for ${review.employeeName}` : ""}.`;

    await (db.from("notifications" as never).insert({
      organization_id: organizationId,
      type: "general",
      title,
      body,
      href: `/app/reviews`,
    } as never) as unknown as Promise<unknown>);

    sendPushToOrg(organizationId, { title, body, href: "/app/reviews" }).catch(() => {});
    console.log(`[auto] Review notification sent for ${organizationId}`);
  } catch (err) {
    console.error("[auto] notifyReviewSubmitted failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 10. Auto-extend recurring booking series (called by cron)
// ─────────────────────────────────────────────────────────────────

export async function autoExtendRecurringSeries(): Promise<number> {
  try {
    const db = admin();
    const { generateOccurrences } = await import("@/lib/recurrence");
    const { createCalendarEvent } = await import("@/lib/google-calendar");

    // Find active series where the latest generated booking is within
    // 2 weeks — meaning we're running low and need to generate more.
    const { data: series } = (await db
      .from("booking_series" as never)
      .select("*")
      .eq("active" as never, true as never)) as unknown as {
      data: Array<{
        id: string;
        organization_id: string;
        client_id: string;
        pattern: string;
        custom_days: number[] | null;
        monthly_nth: number | null;
        monthly_dow: number | null;
        start_time: string;
        starts_at: string;
        ends_at: string | null;
        generate_ahead: number;
        duration_minutes: number;
        service_type: string;
        package_id: string | null;
        assigned_to: string | null;
        total_cents: number;
        hourly_rate_cents: number | null;
        address: string | null;
        notes: string | null;
      }> | null;
    };

    if (!series || series.length === 0) return 0;

    let totalGenerated = 0;

    for (const s of series) {
      // Find the latest booking in this series
      const { data: latest } = await db
        .from("bookings")
        .select("scheduled_at")
        .eq("series_id" as never, s.id as never)
        .order("scheduled_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latest) continue;

      const latestDate = new Date(latest.scheduled_at);
      const twoWeeksOut = new Date();
      twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

      // If the latest booking is more than 2 weeks out, no need to generate
      if (latestDate > twoWeeksOut) continue;

      // Generate next batch
      const occurrences = generateOccurrences(
        {
          pattern: s.pattern as import("@/lib/recurrence").RecurrencePattern,
          custom_days: s.custom_days,
          monthly_nth: s.monthly_nth,
          monthly_dow: s.monthly_dow,
          start_time: s.start_time,
          starts_at: s.starts_at,
          ends_at: s.ends_at,
          generate_ahead: s.generate_ahead,
        },
        s.generate_ahead,
        latestDate,
      );

      if (occurrences.length === 0) continue;

      const rows = occurrences.map((scheduled_at) => ({
        organization_id: s.organization_id,
        client_id: s.client_id,
        package_id: s.package_id,
        assigned_to: s.assigned_to,
        scheduled_at,
        duration_minutes: s.duration_minutes,
        service_type: s.service_type,
        status: "confirmed" as const,
        total_cents: s.total_cents,
        hourly_rate_cents: s.hourly_rate_cents,
        address: s.address,
        notes: s.notes ? `[Recurring] ${s.notes}` : "[Recurring]",
        series_id: s.id,
      }));

      const { data: inserted } = (await (db
        .from("bookings")
        .insert(rows as never)
        .select("id, scheduled_at") as unknown as Promise<{
        data: Array<{ id: string; scheduled_at: string }> | null;
      }>));

      // Sync to calendar
      if (inserted) {
        for (const b of inserted) {
          createCalendarEvent(s.organization_id, {
            id: b.id,
            scheduled_at: b.scheduled_at,
            duration_minutes: s.duration_minutes,
            service_type: s.service_type,
            address: s.address,
            notes: s.notes,
            client_name: undefined,
            employee_name: undefined,
          }).catch(() => {});
        }
      }

      totalGenerated += occurrences.length;
      console.log(`[auto] Extended series ${s.id}: +${occurrences.length} bookings`);
    }

    return totalGenerated;
  } catch (err) {
    console.error("[auto] autoExtendRecurringSeries failed:", err);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────
// 11. Auto-compute review bonuses (called by weekly cron)
// ─────────────────────────────────────────────────────────────────

export async function autoComputeReviewBonuses(): Promise<number> {
  try {
    const db = admin();

    // Find every org with an enabled review bonus rule
    const { data: rules } = await db
      .from("bonus_rules")
      .select("*")
      .eq("enabled", true);

    if (!rules || rules.length === 0) return 0;

    let totalCreated = 0;

    for (const rule of rules) {
      const r = rule as {
        organization_id: string;
        period_days: number;
        min_avg_rating: number;
        min_reviews_count: number;
        amount_cents: number;
      };

      const periodEnd = new Date();
      const periodStart = new Date(periodEnd);
      periodStart.setUTCDate(periodStart.getUTCDate() - r.period_days);
      const periodStartIso = periodStart.toISOString();
      const periodStartDate = periodStartIso.slice(0, 10);
      const periodEndDate = periodEnd.toISOString().slice(0, 10);

      const { data: reviews } = await db
        .from("reviews")
        .select("employee_id, rating")
        .eq("organization_id", r.organization_id)
        .gte("submitted_at", periodStartIso)
        .not("employee_id", "is", null)
        .limit(5000);

      if (!reviews || reviews.length === 0) continue;

      const byEmployee = new Map<string, { sum: number; count: number }>();
      for (const rv of reviews) {
        if (!rv.employee_id) continue;
        const b = byEmployee.get(rv.employee_id) ?? { sum: 0, count: 0 };
        b.sum += rv.rating;
        b.count += 1;
        byEmployee.set(rv.employee_id, b);
      }

      // Dedupe — don't re-award for the same period
      const { data: existing } = await db
        .from("bonuses")
        .select("employee_id")
        .eq("organization_id", r.organization_id)
        .eq("period_start", periodStartDate)
        .eq("period_end", periodEndDate);
      const alreadyAwarded = new Set(
        (existing ?? []).map((b) => b.employee_id),
      );

      const toCreate: unknown[] = [];
      for (const [employeeId, bucket] of byEmployee.entries()) {
        if (bucket.count < r.min_reviews_count) continue;
        const avg = bucket.sum / bucket.count;
        if (avg < r.min_avg_rating) continue;
        if (alreadyAwarded.has(employeeId)) continue;

        toCreate.push({
          organization_id: r.organization_id,
          employee_id: employeeId,
          period_start: periodStartDate,
          period_end: periodEndDate,
          amount_cents: r.amount_cents,
          reason: `Avg ${avg.toFixed(2)} across ${bucket.count} reviews (last ${r.period_days}d)`,
          bonus_type: "review",
        });
      }

      if (toCreate.length > 0) {
        await (db.from("bonuses").insert(toCreate as never) as unknown as Promise<unknown>);
        totalCreated += toCreate.length;

        // Notify the org that bonuses were computed
        sendPushToOrg(r.organization_id, {
          title: "Bonuses computed",
          body: `${toCreate.length} new bonus${toCreate.length > 1 ? "es" : ""} awarded from recent reviews.`,
          href: "/app/bonuses",
        }).catch(() => {});
      }
    }

    return totalCreated;
  } catch (err) {
    console.error("[auto] autoComputeReviewBonuses failed:", err);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function humanize(s: string | null | undefined): string {
  if (!s) return "Cleaning";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Infer service_type enum from free-text estimate description. */
function inferServiceType(
  description: string | null | undefined,
): "standard" | "deep" | "move_out" | "recurring" {
  if (!description) return "standard";
  const d = description.toLowerCase();
  if (d.includes("move out") || d.includes("move-out") || d.includes("moveout") || d.includes("end of tenancy"))
    return "move_out";
  if (d.includes("deep clean") || d.includes("deep-clean") || d.includes("spring clean"))
    return "deep";
  if (d.includes("recurring") || d.includes("weekly") || d.includes("bi-weekly") || d.includes("monthly"))
    return "recurring";
  return "standard";
}

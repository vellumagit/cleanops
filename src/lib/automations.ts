/**
 * Internal automations — fire-and-forget side effects that make the
 * platform feel alive. Every function here swallows errors so it
 * can never break the primary action.
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToMembership, sendPushToOrg } from "@/lib/push";
import type { CurrencyCode } from "@/lib/format";

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
// Helper: fetch all owner/admin recipients for an org
//
// Mirrors the pattern in /api/cron/trial-expiring — pulls owner + admin
// memberships, then their email via the Supabase admin API (emails live
// on auth.users, not profiles). Used by every admin-facing automation.
// ─────────────────────────────────────────────────────────────────

type AdminRecipient = {
  profileId: string;
  fullName: string | null;
  email: string;
};

/**
 * Fetch one membership's email + display name. Used when an event is
 * scoped to a single employee (PTO status, payroll paid, training
 * assigned, certification expiry).
 */
async function getMembershipRecipient(
  membershipId: string,
): Promise<AdminRecipient | null> {
  const db = admin();
  const { data: m } = await db
    .from("memberships")
    .select("profile_id, organization_id")
    .eq("id", membershipId)
    .maybeSingle() as unknown as {
    data: { profile_id: string; organization_id: string } | null;
  };
  if (!m) return null;

  const { data: profile } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", m.profile_id)
    .maybeSingle() as unknown as {
    data: { full_name: string | null } | null;
  };

  const userRes = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${m.profile_id}`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    },
  );
  if (!userRes.ok) return null;
  const userData = (await userRes.json()) as { email?: string };
  if (!userData.email) return null;

  return {
    profileId: m.profile_id,
    fullName: profile?.full_name ?? null,
    email: userData.email,
  };
}

async function getOrgAdminRecipients(
  orgId: string,
): Promise<AdminRecipient[]> {
  const db = admin();
  const { data: owners } = await db
    .from("memberships")
    .select("profile_id")
    .eq("organization_id", orgId)
    .in("role", ["owner", "admin"])
    .eq("status", "active");

  if (!owners || owners.length === 0) return [];

  const recipients: AdminRecipient[] = [];
  for (const o of owners as Array<{ profile_id: string }>) {
    const { data: profile } = await db
      .from("profiles")
      .select("full_name")
      .eq("id", o.profile_id)
      .maybeSingle() as unknown as {
      data: { full_name: string | null } | null;
    };

    // Email lives on auth.users — pull via the admin API.
    const userRes = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${o.profile_id}`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        },
      },
    );
    if (!userRes.ok) continue;
    const userData = (await userRes.json()) as { email?: string };
    if (!userData.email) continue;

    recipients.push({
      profileId: o.profile_id,
      fullName: profile?.full_name ?? null,
      email: userData.email,
    });
  }

  return recipients;
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

    // Insert + return ids so we can fire a per-assignment email for each.
    const { data: inserted } = await (db
      .from("training_assignments")
      .insert(rows as never)
      .select("id") as unknown as Promise<{
      data: Array<{ id: string }> | null;
    }>);

    console.log(
      `[auto] Assigned ${toAssign.length} training modules to new member ${membershipId}`,
    );

    // Fire-and-forget email per assignment. Gated by the
    // training_assigned_notify toggle inside notifyTrainingAssigned.
    for (const row of inserted ?? []) {
      notifyTrainingAssigned(row.id).catch(() => {});
    }
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
// 7b. Email the client when a booking is rescheduled (scheduled_at changed)
// ─────────────────────────────────────────────────────────────────

export async function sendBookingRescheduled(
  bookingId: string,
  oldScheduledAt: string,
) {
  try {
    const db = admin();
    const { sendOrgEmail } = await import("@/lib/email");
    const { bookingRescheduledEmail } = await import("@/lib/email-templates");

    const { data: booking } = await db
      .from("bookings")
      .select(`
        id, organization_id, scheduled_at, service_type, address,
        client:clients ( name, email )
      `)
      .eq("id", bookingId)
      .maybeSingle();

    if (!booking || !booking.client?.email) return;

    if (!(await isAutomationEnabled(booking.organization_id, "booking_rescheduled_email"))) {
      console.log(`[auto] Booking rescheduled email paused for org ${booking.organization_id}`);
      return;
    }

    const { data: org } = await db
      .from("organizations")
      .select("name, brand_color, logo_url")
      .eq("id", booking.organization_id)
      .maybeSingle() as unknown as {
      data: { name: string; brand_color: string | null; logo_url: string | null } | null;
    };

    const fmt = (iso: string) =>
      new Date(iso).toLocaleString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

    const template = bookingRescheduledEmail({
      clientName: booking.client.name ?? "there",
      orgName: org?.name ?? "your service provider",
      serviceName: humanize(booking.service_type),
      oldDateTime: fmt(oldScheduledAt),
      newDateTime: fmt(booking.scheduled_at),
      address: booking.address ?? "(address on file)",
      brandColor: org?.brand_color ?? undefined,
      logoUrl: org?.logo_url ?? undefined,
    });

    sendOrgEmail(booking.organization_id, {
      to: booking.client.email,
      toName: booking.client.name ?? undefined,
      ...template,
    });

    console.log(`[auto] Booking rescheduled email sent to ${booking.client.email}`);
  } catch (err) {
    console.error("[auto] sendBookingRescheduled failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 7c. Overdue invoice reminder cron — runs daily, sends once per 7 days per invoice
// ─────────────────────────────────────────────────────────────────

export async function sendOverdueReminders(): Promise<{
  considered: number;
  sent: number;
  skipped: number;
}> {
  const db = admin();
  const { sendOrgEmail } = await import("@/lib/email");
  const { invoiceOverdueReminderEmail } = await import("@/lib/email-templates");
  const { formatCurrencyCents } = await import("@/lib/format");
  const { getOrgCurrency } = await import("@/lib/org-currency");

  // Find every overdue, unpaid invoice whose last reminder is either null
  // or older than 7 days. Uses the partial index from migration
  // 20260418030000_invoice_overdue_reminders.sql.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates } = await db
    .from("invoices")
    .select(`
      id, number, organization_id, amount_cents, due_date, public_token,
      overdue_reminder_sent_at,
      client:clients ( name, email )
    `)
    .eq("status", "overdue")
    .is("paid_at", null)
    .or(`overdue_reminder_sent_at.is.null,overdue_reminder_sent_at.lt.${sevenDaysAgo}`) as unknown as {
    data: Array<{
      id: string;
      number: string | null;
      organization_id: string;
      amount_cents: number;
      due_date: string | null;
      public_token: string | null;
      overdue_reminder_sent_at: string | null;
      client: { name: string | null; email: string | null } | null;
    }> | null;
  };

  const considered = candidates?.length ?? 0;
  let sent = 0;
  let skipped = 0;

  if (!candidates || candidates.length === 0) {
    return { considered, sent, skipped };
  }

  // Cache org lookups — many invoices share the same org.
  const orgCache = new Map<
    string,
    { name: string; brand_color: string | null; logo_url: string | null; enabled: boolean; currency: CurrencyCode } | null
  >();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  for (const inv of candidates) {
    if (!inv.client?.email || !inv.due_date) {
      skipped += 1;
      continue;
    }

    let cached = orgCache.get(inv.organization_id);
    if (cached === undefined) {
      const enabled = await isAutomationEnabled(inv.organization_id, "invoice_overdue_reminder");
      const { data: orgData } = await db
        .from("organizations")
        .select("name, brand_color, logo_url")
        .eq("id", inv.organization_id)
        .maybeSingle() as unknown as {
        data: { name: string; brand_color: string | null; logo_url: string | null } | null;
      };
      const currency = await getOrgCurrency(inv.organization_id);
      cached = orgData
        ? { ...orgData, enabled, currency }
        : null;
      orgCache.set(inv.organization_id, cached);
    }

    if (!cached) {
      skipped += 1;
      continue;
    }

    if (!cached.enabled) {
      console.log(`[auto] Overdue reminder paused for org ${inv.organization_id}`);
      skipped += 1;
      continue;
    }

    const dueDate = new Date(inv.due_date);
    const daysOverdue = Math.max(
      1,
      Math.floor((Date.now() - dueDate.getTime()) / (24 * 60 * 60 * 1000)),
    );

    const template = invoiceOverdueReminderEmail({
      clientName: inv.client.name ?? "there",
      invoiceNumber: inv.number ?? inv.id.slice(0, 8).toUpperCase(),
      amountFormatted: formatCurrencyCents(inv.amount_cents, cached.currency),
      dueDate: dueDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      daysOverdue,
      publicUrl: inv.public_token ? `${siteUrl}/i/${inv.public_token}` : siteUrl,
      orgName: cached.name,
      brandColor: cached.brand_color ?? undefined,
      logoUrl: cached.logo_url ?? undefined,
    });

    // Send first, stamp second — if the send throws we'll retry tomorrow.
    const ok = await sendOrgEmail(inv.organization_id, {
      to: inv.client.email,
      toName: inv.client.name ?? undefined,
      ...template,
    });

    if (ok) {
      await db
        .from("invoices")
        .update({ overdue_reminder_sent_at: new Date().toISOString() } as never)
        .eq("id", inv.id);
      sent += 1;
      console.log(`[auto] Overdue reminder sent for invoice ${inv.id} to ${inv.client.email}`);
    } else {
      skipped += 1;
    }
  }

  return { considered, sent, skipped };
}

// ─────────────────────────────────────────────────────────────────
// 7d. Client-facing 24-hour booking reminder (daily cron)
//
// Runs daily. Finds bookings scheduled between ~18h and ~30h from now
// that haven't been client-reminded yet, and emails the client. The
// window straddles 24h so clients get a consistent "day before" cadence
// regardless of the exact time-of-day the job is booked for.
//
// Gated three ways:
//   1. Platform kill switch via sendOrgEmail (CLIENT_EMAILS_PAUSED)
//   2. Per-org automation toggle `booking_reminder_client_email`
//   3. Dedup by bookings.client_reminder_sent_at — each booking is
//      reminded at most once, ever.
// ─────────────────────────────────────────────────────────────────

export async function sendUpcomingBookingReminders(): Promise<{
  considered: number;
  sent: number;
  skipped: number;
}> {
  const db = admin();
  const { sendOrgEmail } = await import("@/lib/email");
  const { bookingReminderEmail } = await import("@/lib/email-templates");

  const now = Date.now();
  const windowStart = new Date(now + 18 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now + 30 * 60 * 60 * 1000).toISOString();

  const { data: candidates } = await db
    .from("bookings")
    .select(`
      id, organization_id, scheduled_at, service_type, address,
      client:clients ( name, email )
    `)
    .is("client_reminder_sent_at" as never, null as never)
    .in("status", ["pending", "confirmed"])
    .gte("scheduled_at", windowStart)
    .lte("scheduled_at", windowEnd) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      scheduled_at: string;
      service_type: string;
      address: string | null;
      client: { name: string | null; email: string | null } | null;
    }> | null;
  };

  const considered = candidates?.length ?? 0;
  let sent = 0;
  let skipped = 0;

  if (!candidates || candidates.length === 0) {
    return { considered, sent, skipped };
  }

  // Cache org lookups (toggle + branding) across the batch.
  const orgCache = new Map<
    string,
    { name: string; brand_color: string | null; logo_url: string | null; enabled: boolean } | null
  >();

  for (const booking of candidates) {
    if (!booking.client?.email) {
      skipped += 1;
      continue;
    }

    let cached = orgCache.get(booking.organization_id);
    if (cached === undefined) {
      const enabled = await isAutomationEnabled(
        booking.organization_id,
        "booking_reminder_client_email",
      );
      const { data: orgData } = await db
        .from("organizations")
        .select("name, brand_color, logo_url")
        .eq("id", booking.organization_id)
        .maybeSingle() as unknown as {
        data: { name: string; brand_color: string | null; logo_url: string | null } | null;
      };
      cached = orgData ? { ...orgData, enabled } : null;
      orgCache.set(booking.organization_id, cached);
    }

    if (!cached) {
      skipped += 1;
      continue;
    }
    if (!cached.enabled) {
      console.log(`[auto] Booking reminder paused for org ${booking.organization_id}`);
      skipped += 1;
      continue;
    }

    const dateTime = new Date(booking.scheduled_at).toLocaleString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const template = bookingReminderEmail({
      clientName: booking.client.name ?? "there",
      orgName: cached.name,
      serviceName: humanize(booking.service_type),
      dateTime,
      address: booking.address ?? "(address on file)",
      brandColor: cached.brand_color ?? undefined,
      logoUrl: cached.logo_url ?? undefined,
    });

    const ok = await sendOrgEmail(booking.organization_id, {
      to: booking.client.email,
      toName: booking.client.name ?? undefined,
      ...template,
    });

    if (ok) {
      await db
        .from("bookings")
        .update({ client_reminder_sent_at: new Date().toISOString() } as never)
        .eq("id", booking.id);
      sent += 1;
      console.log(
        `[auto] Booking reminder sent for booking ${booking.id} to ${booking.client.email}`,
      );
    } else {
      // sendOrgEmail returned false — either the kill switch is on, email
      // isn't configured, or Resend rejected. Don't stamp — we'll retry
      // on the next cron tick.
      skipped += 1;
    }
  }

  return { considered, sent, skipped };
}

// ─────────────────────────────────────────────────────────────────
// 7e. Send an estimate to the client (user-initiated from the admin UI)
//
// Generates a public_token + expires_at on first send if not already
// present, then emails the client with a link to /e/<token>. Idempotent:
// re-sending bumps client_email_sent_at but keeps the existing token.
//
// Gated by the platform kill switch (via sendOrgEmail) and by the per-org
// `estimate_sent_email` toggle.
// ─────────────────────────────────────────────────────────────────

export async function sendEstimateToClient(estimateId: string): Promise<{
  ok: boolean;
  publicToken: string | null;
  error?: string;
}> {
  try {
    const db = admin();
    const { sendOrgEmail } = await import("@/lib/email");
    const { estimateSentEmail } = await import("@/lib/email-templates");
    const { formatCurrencyCents } = await import("@/lib/format");
    const { getOrgCurrency } = await import("@/lib/org-currency");
    const { generateClaimToken } = await import("@/lib/claim-token");

    const { data: estimate } = await db
      .from("estimates")
      .select(`
        id, organization_id, service_description, total_cents,
        public_token, expires_at,
        client:clients ( name, email )
      `)
      .eq("id", estimateId)
      .maybeSingle() as unknown as {
      data: {
        id: string;
        organization_id: string;
        service_description: string | null;
        total_cents: number;
        public_token: string | null;
        expires_at: string | null;
        client: { name: string | null; email: string | null } | null;
      } | null;
    };

    if (!estimate) return { ok: false, publicToken: null, error: "Estimate not found" };
    if (!estimate.client?.email) {
      return { ok: false, publicToken: null, error: "Client has no email on file" };
    }

    if (!(await isAutomationEnabled(estimate.organization_id, "estimate_sent_email"))) {
      console.log(
        `[auto] Estimate send paused for org ${estimate.organization_id}`,
      );
      return {
        ok: false,
        publicToken: null,
        error: "Estimate emails are paused for this organization",
      };
    }

    // Lazily mint a public token + 30-day expiry on first send.
    let publicToken = estimate.public_token;
    let expiresAt = estimate.expires_at;
    if (!publicToken) {
      publicToken = generateClaimToken();
      expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await db
        .from("estimates")
        .update({
          public_token: publicToken,
          expires_at: expiresAt,
        } as never)
        .eq("id", estimateId);
    }

    const { data: orgData } = await db
      .from("organizations")
      .select("name, brand_color, logo_url")
      .eq("id", estimate.organization_id)
      .maybeSingle() as unknown as {
      data: { name: string; brand_color: string | null; logo_url: string | null } | null;
    };

    const orgName = orgData?.name ?? "Your service provider";
    const currency = await getOrgCurrency(estimate.organization_id);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

    const expiresOn = expiresAt
      ? new Date(expiresAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;

    const template = estimateSentEmail({
      clientName: estimate.client.name ?? "there",
      orgName,
      amountFormatted: formatCurrencyCents(estimate.total_cents, currency),
      serviceDescription: estimate.service_description ?? "",
      publicUrl: `${siteUrl}/e/${publicToken}`,
      expiresOn,
      brandColor: orgData?.brand_color ?? undefined,
      logoUrl: orgData?.logo_url ?? undefined,
    });

    const sendOk = await sendOrgEmail(estimate.organization_id, {
      to: estimate.client.email,
      toName: estimate.client.name ?? undefined,
      ...template,
    });

    if (sendOk) {
      await db
        .from("estimates")
        .update({
          client_email_sent_at: new Date().toISOString(),
          // Also stamp `sent_at` + bump status so the admin UI reflects send.
          sent_at: new Date().toISOString(),
          status:
            // Don't downgrade approved/declined if they re-send.
            undefined,
        } as never)
        .eq("id", estimateId);
    }

    return { ok: sendOk, publicToken };
  } catch (err) {
    console.error("[auto] sendEstimateToClient failed:", err);
    return {
      ok: false,
      publicToken: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
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
  review: {
    rating: number;
    clientName: string;
    employeeName: string | null;
    reviewId: string;
    reviewText?: string | null;
  },
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

    // Email alert for low ratings (≤3★). Fires only when there's a real
    // service-recovery opportunity — not on every 4/5-star review.
    if (review.rating <= 3) {
      const enabled = await isAutomationEnabled(
        organizationId,
        "low_review_alert",
      );
      if (enabled) {
        const { sendEmail } = await import("@/lib/email");
        const { lowReviewAlertEmail } = await import("@/lib/email-templates");

        const { data: org } = await db
          .from("organizations")
          .select("name")
          .eq("id", organizationId)
          .maybeSingle() as unknown as {
          data: { name: string } | null;
        };
        const orgName = org?.name ?? "your organization";

        const recipients = await getOrgAdminRecipients(organizationId);
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
        for (const r of recipients) {
          const template = lowReviewAlertEmail({
            recipientName: r.fullName ?? "there",
            orgName,
            clientName: review.clientName,
            employeeName: review.employeeName,
            rating: review.rating,
            reviewText: review.reviewText ?? null,
            reviewUrl: `${siteUrl}/app/reviews`,
          });
          await sendEmail({
            to: r.email,
            toName: r.fullName ?? undefined,
            ...template,
          });
        }
        console.log(
          `[auto] Low review alert sent for ${organizationId} (rating ${review.rating})`,
        );
      }
    }
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
// ADMIN AUTOMATIONS
//
// These email the owner/admin of an org, not the end client. They use
// sendEmail() directly (not sendOrgEmail), so the CLIENT_EMAILS_PAUSED
// kill switch does NOT silence them — that kill switch is scoped to
// org→client traffic only.
// ─────────────────────────────────────────────────────────────────

// 11. Unassigned booking alert — daily scan, silent when nothing to alert
export async function sendUnassignedBookingAlerts(): Promise<{
  orgsAlerted: number;
  bookingsFlagged: number;
}> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { unassignedBookingAlertEmail } = await import("@/lib/email-templates");

  const now = Date.now();
  const windowEnd = new Date(now + 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates } = await db
    .from("bookings")
    .select("id, organization_id, scheduled_at, service_type, address, client:clients ( name )")
    .is("assigned_to", null)
    .is("unassigned_alert_sent_at" as never, null as never)
    .in("status", ["pending", "confirmed"])
    .gte("scheduled_at", new Date(now).toISOString())
    .lte("scheduled_at", windowEnd) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      scheduled_at: string;
      service_type: string;
      address: string | null;
      client: { name: string | null } | null;
    }> | null;
  };

  if (!candidates || candidates.length === 0) {
    return { orgsAlerted: 0, bookingsFlagged: 0 };
  }

  // Group by org.
  const byOrg = new Map<string, typeof candidates>();
  for (const b of candidates) {
    const list = byOrg.get(b.organization_id) ?? [];
    list.push(b);
    byOrg.set(b.organization_id, list);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  let orgsAlerted = 0;
  let bookingsFlagged = 0;

  for (const [orgId, bookings] of byOrg) {
    if (!(await isAutomationEnabled(orgId, "unassigned_booking_alert"))) {
      console.log(`[auto] Unassigned alert paused for org ${orgId}`);
      continue;
    }

    const { data: orgData } = await db
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle() as unknown as {
      data: { name: string } | null;
    };
    const orgName = orgData?.name ?? "your organization";

    const recipients = await getOrgAdminRecipients(orgId);
    if (recipients.length === 0) continue;

    const bookingRows = bookings.map((b) => ({
      clientName: b.client?.name ?? "A client",
      serviceName: humanize(b.service_type),
      dateTime: new Date(b.scheduled_at).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      address: b.address ?? "(no address)",
      hoursUntil: Math.max(
        1,
        Math.round((new Date(b.scheduled_at).getTime() - now) / (60 * 60 * 1000)),
      ),
    }));

    for (const r of recipients) {
      const template = unassignedBookingAlertEmail({
        recipientName: r.fullName ?? "there",
        orgName,
        dashboardUrl: `${siteUrl}/app/bookings`,
        bookings: bookingRows,
      });
      await sendEmail({
        to: r.email,
        toName: r.fullName ?? undefined,
        ...template,
      });
    }

    // Stamp each booking so we don't re-alert; the trigger clears it
    // automatically if the booking later gets an assignee.
    await db
      .from("bookings")
      .update({ unassigned_alert_sent_at: new Date().toISOString() } as never)
      .in(
        "id",
        bookings.map((b) => b.id),
      );

    orgsAlerted += 1;
    bookingsFlagged += bookings.length;
    console.log(
      `[auto] Unassigned alert sent for org ${orgId}: ${bookings.length} booking(s)`,
    );
  }

  return { orgsAlerted, bookingsFlagged };
}

// ─────────────────────────────────────────────────────────────────
// 12. Stripe payout notification — called from the Connect webhook
// ─────────────────────────────────────────────────────────────────

export async function sendPayoutNotification(args: {
  stripeAccountId: string;
  amountCents: number;
  currency: string;
  arrivalDateUnix: number | null;
  payoutId: string;
}): Promise<void> {
  try {
    const db = admin();
    const { sendEmail } = await import("@/lib/email");
    const { stripePayoutAlertEmail } = await import("@/lib/email-templates");
    const { formatCurrencyCents } = await import("@/lib/format");

    const { data: org } = await db
      .from("organizations")
      .select("id, name")
      .eq("stripe_account_id" as never, args.stripeAccountId as never)
      .maybeSingle() as unknown as {
      data: { id: string; name: string } | null;
    };

    if (!org) {
      console.warn(
        `[auto] Payout for unknown Connect account ${args.stripeAccountId}`,
      );
      return;
    }

    if (!(await isAutomationEnabled(org.id, "stripe_payout_alert"))) {
      console.log(`[auto] Payout alert paused for org ${org.id}`);
      return;
    }

    const recipients = await getOrgAdminRecipients(org.id);
    if (recipients.length === 0) return;

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
    const arrivalDate = args.arrivalDateUnix
      ? new Date(args.arrivalDateUnix * 1000).toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "soon";

    // Stripe currencies are ISO 4217 lowercase; our formatter expects uppercase.
    const ccy = args.currency.toUpperCase();
    const formattable = ccy === "CAD" || ccy === "USD" ? ccy : "USD";
    const amount = formatCurrencyCents(
      args.amountCents,
      formattable as "CAD" | "USD",
    );

    for (const r of recipients) {
      const template = stripePayoutAlertEmail({
        recipientName: r.fullName ?? "there",
        orgName: org.name,
        amountFormatted: amount,
        arrivalDate,
        payoutId: args.payoutId,
        dashboardUrl: `${siteUrl}/app/settings/integrations`,
      });
      await sendEmail({
        to: r.email,
        toName: r.fullName ?? undefined,
        ...template,
      });
    }

    console.log(
      `[auto] Payout alert sent for org ${org.id}: ${amount} (${args.payoutId})`,
    );
  } catch (err) {
    console.error("[auto] sendPayoutNotification failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 13. Weekly ops digest — Monday 8:00 UTC
// ─────────────────────────────────────────────────────────────────

export async function sendWeeklyOpsDigests(): Promise<{
  orgsSent: number;
}> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { weeklyOpsDigestEmail } = await import("@/lib/email-templates");
  const { formatCurrencyCents } = await import("@/lib/format");
  const { getOrgCurrency } = await import("@/lib/org-currency");

  const now = new Date();
  // Last 7 days, ending at "now" (which is ~Monday morning when the cron fires).
  const end = new Date(now);
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prevStart = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekLabel = `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const { data: orgs } = await db
    .from("organizations")
    .select("id, name")
    .is("deleted_at", null) as unknown as {
    data: Array<{ id: string; name: string }> | null;
  };

  if (!orgs) return { orgsSent: 0 };

  let orgsSent = 0;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  for (const org of orgs) {
    if (!(await isAutomationEnabled(org.id, "weekly_ops_digest"))) continue;

    const recipients = await getOrgAdminRecipients(org.id);
    if (recipients.length === 0) continue;

    // Gather stats in parallel.
    const [
      { data: paidInvoices },
      { data: prevPaidInvoices },
      { count: completedCount },
      { count: cancelledCount },
      { data: reviews },
      { count: overdueCount },
      { count: unassignedUpcomingCount },
    ] = await Promise.all([
      db.from("invoices").select("amount_cents").eq("organization_id", org.id)
        .gte("paid_at", start.toISOString())
        .lte("paid_at", end.toISOString()) as unknown as Promise<{
        data: Array<{ amount_cents: number }> | null;
      }>,
      db.from("invoices").select("amount_cents").eq("organization_id", org.id)
        .gte("paid_at", prevStart.toISOString())
        .lte("paid_at", start.toISOString()) as unknown as Promise<{
        data: Array<{ amount_cents: number }> | null;
      }>,
      db.from("bookings").select("id", { count: "exact", head: true })
        .eq("organization_id", org.id).eq("status", "completed")
        .gte("scheduled_at", start.toISOString())
        .lte("scheduled_at", end.toISOString()),
      db.from("bookings").select("id", { count: "exact", head: true })
        .eq("organization_id", org.id).eq("status", "cancelled")
        .gte("updated_at" as never, start.toISOString() as never)
        .lte("updated_at" as never, end.toISOString() as never),
      db.from("reviews").select("rating").eq("organization_id", org.id)
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString()) as unknown as Promise<{
        data: Array<{ rating: number }> | null;
      }>,
      db.from("invoices").select("id", { count: "exact", head: true })
        .eq("organization_id", org.id).eq("status", "overdue")
        .is("paid_at", null),
      db.from("bookings").select("id", { count: "exact", head: true })
        .eq("organization_id", org.id).is("assigned_to", null)
        .in("status", ["pending", "confirmed"])
        .gte("scheduled_at", now.toISOString())
        .lte("scheduled_at", new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    const revenueCents = (paidInvoices ?? []).reduce(
      (acc, r) => acc + r.amount_cents,
      0,
    );
    const prevRevenueCents = (prevPaidInvoices ?? []).reduce(
      (acc, r) => acc + r.amount_cents,
      0,
    );
    const deltaPct =
      prevRevenueCents > 0
        ? Math.round(((revenueCents - prevRevenueCents) / prevRevenueCents) * 100)
        : null;

    const avgRating =
      reviews && reviews.length > 0
        ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1)
        : null;

    const currency = await getOrgCurrency(org.id);

    const stats = [
      {
        label: "Revenue",
        value: formatCurrencyCents(revenueCents, currency),
        sub:
          deltaPct !== null
            ? `${deltaPct >= 0 ? "+" : ""}${deltaPct}% vs prior week`
            : "No prior-week baseline",
      },
      {
        label: "Jobs completed",
        value: String(completedCount ?? 0),
      },
      {
        label: "Jobs cancelled",
        value: String(cancelledCount ?? 0),
      },
      {
        label: "Avg rating",
        value: avgRating ? `${avgRating} ★` : "—",
        sub:
          reviews && reviews.length > 0
            ? `${reviews.length} review${reviews.length === 1 ? "" : "s"}`
            : "No reviews this week",
      },
      {
        label: "Overdue invoices",
        value: String(overdueCount ?? 0),
      },
    ];

    for (const r of recipients) {
      const template = weeklyOpsDigestEmail({
        recipientName: r.fullName ?? "there",
        orgName: org.name,
        weekLabel,
        stats,
        upcomingUnassigned: unassignedUpcomingCount ?? 0,
        dashboardUrl: `${siteUrl}/app/reports`,
      });
      await sendEmail({
        to: r.email,
        toName: r.fullName ?? undefined,
        ...template,
      });
    }

    orgsSent += 1;
    console.log(`[auto] Weekly digest sent for org ${org.id}`);
  }

  return { orgsSent };
}

// ─────────────────────────────────────────────────────────────────
// 14. Monthly ops digest — 1st of month, 9:00 UTC
// ─────────────────────────────────────────────────────────────────

export async function sendMonthlyOpsDigests(): Promise<{ orgsSent: number }> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { monthlyOpsDigestEmail } = await import("@/lib/email-templates");
  const { formatCurrencyCents } = await import("@/lib/format");
  const { getOrgCurrency } = await import("@/lib/org-currency");

  // Run window: prior calendar month UTC. If today is Nov 1, window is
  // Oct 1 00:00 UTC through Nov 1 00:00 UTC.
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const monthLabel = start.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const { data: orgs } = await db
    .from("organizations")
    .select("id, name")
    .is("deleted_at", null) as unknown as {
    data: Array<{ id: string; name: string }> | null;
  };

  if (!orgs) return { orgsSent: 0 };

  let orgsSent = 0;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  for (const org of orgs) {
    if (!(await isAutomationEnabled(org.id, "monthly_ops_digest"))) continue;

    const recipients = await getOrgAdminRecipients(org.id);
    if (recipients.length === 0) continue;

    const [
      { data: paidInvoices },
      { count: completedCount },
      { count: cancelledCount },
      { data: reviews },
      { count: newClientsCount },
    ] = await Promise.all([
      db.from("invoices")
        .select("amount_cents, client_id, client:clients ( name )")
        .eq("organization_id", org.id)
        .gte("paid_at", start.toISOString())
        .lt("paid_at", end.toISOString()) as unknown as Promise<{
        data: Array<{
          amount_cents: number;
          client_id: string;
          client: { name: string | null } | null;
        }> | null;
      }>,
      db.from("bookings").select("id", { count: "exact", head: true })
        .eq("organization_id", org.id).eq("status", "completed")
        .gte("scheduled_at", start.toISOString())
        .lt("scheduled_at", end.toISOString()),
      db.from("bookings").select("id", { count: "exact", head: true })
        .eq("organization_id", org.id).eq("status", "cancelled")
        .gte("updated_at" as never, start.toISOString() as never)
        .lt("updated_at" as never, end.toISOString() as never),
      db.from("reviews").select("rating").eq("organization_id", org.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString()) as unknown as Promise<{
        data: Array<{ rating: number }> | null;
      }>,
      db.from("clients").select("id", { count: "exact", head: true })
        .eq("organization_id", org.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString()),
    ]);

    // Aggregate top clients by revenue.
    const clientAgg = new Map<string, { name: string; cents: number; jobs: number }>();
    for (const inv of paidInvoices ?? []) {
      const existing = clientAgg.get(inv.client_id) ?? {
        name: inv.client?.name ?? "—",
        cents: 0,
        jobs: 0,
      };
      existing.cents += inv.amount_cents;
      existing.jobs += 1;
      clientAgg.set(inv.client_id, existing);
    }
    const topClients = [...clientAgg.values()]
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 3);

    const currency = await getOrgCurrency(org.id);

    // Top performer by completed jobs.
    const { data: completedByEmp } = await db
      .from("bookings")
      .select("assigned_to")
      .eq("organization_id", org.id)
      .eq("status", "completed")
      .not("assigned_to", "is", null)
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString()) as unknown as {
      data: Array<{ assigned_to: string }> | null;
    };
    const empCount = new Map<string, number>();
    for (const b of completedByEmp ?? []) {
      empCount.set(b.assigned_to, (empCount.get(b.assigned_to) ?? 0) + 1);
    }
    let topEmployee: { name: string; jobs: number } | null = null;
    if (empCount.size > 0) {
      const [topId, jobs] = [...empCount.entries()].sort((a, b) => b[1] - a[1])[0];
      const { data: m } = await db
        .from("memberships")
        .select("profile:profiles ( full_name )")
        .eq("id", topId)
        .maybeSingle() as unknown as {
        data: { profile: { full_name: string | null } | null } | null;
      };
      topEmployee = {
        name: m?.profile?.full_name ?? "Top cleaner",
        jobs,
      };
    }

    const revenueCents = (paidInvoices ?? []).reduce(
      (a, r) => a + r.amount_cents,
      0,
    );
    const avgRating =
      reviews && reviews.length > 0
        ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1)
        : null;

    const stats = [
      { label: "Revenue", value: formatCurrencyCents(revenueCents, currency) },
      { label: "Jobs completed", value: String(completedCount ?? 0) },
      { label: "Jobs cancelled", value: String(cancelledCount ?? 0) },
      {
        label: "Avg rating",
        value: avgRating ? `${avgRating} ★` : "—",
        sub: reviews && reviews.length > 0
          ? `${reviews.length} review${reviews.length === 1 ? "" : "s"}`
          : undefined,
      },
      { label: "New clients", value: String(newClientsCount ?? 0) },
    ];

    for (const r of recipients) {
      const template = monthlyOpsDigestEmail({
        recipientName: r.fullName ?? "there",
        orgName: org.name,
        monthLabel,
        stats,
        topClients: topClients.map((c) => ({
          name: c.name,
          revenue: formatCurrencyCents(c.cents, currency),
          jobs: c.jobs,
        })),
        topEmployee,
        dashboardUrl: `${siteUrl}/app/reports`,
      });
      await sendEmail({
        to: r.email,
        toName: r.fullName ?? undefined,
        ...template,
      });
    }

    orgsSent += 1;
    console.log(`[auto] Monthly digest sent for org ${org.id}`);
  }

  return { orgsSent };
}

// ─────────────────────────────────────────────────────────────────
// EMPLOYEE AUTOMATIONS
//
// All employee-facing, so they use sendEmail() directly. The
// CLIENT_EMAILS_PAUSED kill switch does NOT silence these — that
// kill switch is scoped to org→client only.
// ─────────────────────────────────────────────────────────────────

// 15. Daily employee schedule email (cron at 06:00 UTC)
export async function sendDailyEmployeeSchedules(): Promise<{
  emailsSent: number;
}> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { employeeDailyScheduleEmail } = await import("@/lib/email-templates");

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const { data: orgs } = await db
    .from("organizations")
    .select("id, name")
    .is("deleted_at", null) as unknown as {
    data: Array<{ id: string; name: string }> | null;
  };

  if (!orgs) return { emailsSent: 0 };
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  let emailsSent = 0;

  for (const org of orgs) {
    if (!(await isAutomationEnabled(org.id, "employee_daily_schedule"))) continue;

    const { data: bookings } = await db
      .from("bookings")
      .select(`
        id, scheduled_at, service_type, duration_minutes, address, notes,
        assigned_to,
        client:clients ( name )
      `)
      .eq("organization_id", org.id)
      .not("assigned_to", "is", null)
      .in("status", ["pending", "confirmed"])
      .gte("scheduled_at", startOfDay.toISOString())
      .lt("scheduled_at", endOfDay.toISOString())
      .order("scheduled_at") as unknown as {
      data: Array<{
        id: string;
        scheduled_at: string;
        service_type: string;
        duration_minutes: number;
        address: string | null;
        notes: string | null;
        assigned_to: string;
        client: { name: string | null } | null;
      }> | null;
    };

    if (!bookings || bookings.length === 0) continue;

    // Group by employee (assigned_to = membership id)
    const byEmployee = new Map<string, typeof bookings>();
    for (const b of bookings) {
      const list = byEmployee.get(b.assigned_to) ?? [];
      list.push(b);
      byEmployee.set(b.assigned_to, list);
    }

    for (const [membershipId, jobs] of byEmployee) {
      const recipient = await getMembershipRecipient(membershipId);
      if (!recipient) continue;

      const template = employeeDailyScheduleEmail({
        recipientName: recipient.fullName ?? "there",
        orgName: org.name,
        dateLabel: startOfDay.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
        jobs: jobs.map((j) => ({
          time: new Date(j.scheduled_at).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          }),
          serviceName: humanize(j.service_type),
          clientName: j.client?.name ?? "A client",
          address: j.address ?? "(address on file)",
          durationLabel:
            j.duration_minutes >= 60
              ? `${Math.round((j.duration_minutes / 60) * 10) / 10}h`
              : `${j.duration_minutes}m`,
          notes: j.notes,
        })),
        fieldAppUrl: `${siteUrl}/field/jobs`,
      });

      await sendEmail({
        to: recipient.email,
        toName: recipient.fullName ?? undefined,
        ...template,
      });
      emailsSent += 1;
    }

    console.log(`[auto] Daily schedule emails sent for org ${org.id}`);
  }

  return { emailsSent };
}

// 16. Weekly employee schedule email (cron Sunday 18:00 UTC)
export async function sendWeeklyEmployeeSchedules(): Promise<{
  emailsSent: number;
}> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { employeeWeeklyScheduleEmail } = await import("@/lib/email-templates");

  // Next 7 days starting tomorrow UTC 00:00.
  const startOfTomorrow = new Date();
  startOfTomorrow.setUTCHours(0, 0, 0, 0);
  startOfTomorrow.setUTCDate(startOfTomorrow.getUTCDate() + 1);
  const endOfWeek = new Date(
    startOfTomorrow.getTime() + 7 * 24 * 60 * 60 * 1000,
  );
  const weekLabel = `${startOfTomorrow.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${new Date(endOfWeek.getTime() - 1).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;

  const { data: orgs } = await db
    .from("organizations")
    .select("id, name")
    .is("deleted_at", null) as unknown as {
    data: Array<{ id: string; name: string }> | null;
  };

  if (!orgs) return { emailsSent: 0 };
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  let emailsSent = 0;

  for (const org of orgs) {
    if (!(await isAutomationEnabled(org.id, "employee_weekly_schedule"))) continue;

    const { data: bookings } = await db
      .from("bookings")
      .select(`
        id, scheduled_at, service_type, assigned_to,
        client:clients ( name )
      `)
      .eq("organization_id", org.id)
      .not("assigned_to", "is", null)
      .in("status", ["pending", "confirmed"])
      .gte("scheduled_at", startOfTomorrow.toISOString())
      .lt("scheduled_at", endOfWeek.toISOString())
      .order("scheduled_at") as unknown as {
      data: Array<{
        id: string;
        scheduled_at: string;
        service_type: string;
        assigned_to: string;
        client: { name: string | null } | null;
      }> | null;
    };

    if (!bookings) continue;

    const byEmployee = new Map<string, typeof bookings>();
    for (const b of bookings) {
      const list = byEmployee.get(b.assigned_to) ?? [];
      list.push(b);
      byEmployee.set(b.assigned_to, list);
    }

    for (const [membershipId, jobs] of byEmployee) {
      if (jobs.length === 0) continue;
      const recipient = await getMembershipRecipient(membershipId);
      if (!recipient) continue;

      // Bucket into 7 day bins
      const dayMap = new Map<string, typeof jobs>();
      for (let i = 0; i < 7; i += 1) {
        const d = new Date(startOfTomorrow.getTime() + i * 24 * 60 * 60 * 1000);
        dayMap.set(d.toISOString().slice(0, 10), []);
      }
      for (const j of jobs) {
        const key = j.scheduled_at.slice(0, 10);
        const bucket = dayMap.get(key) ?? [];
        bucket.push(j);
        dayMap.set(key, bucket);
      }

      const days = [...dayMap.entries()].map(([key, jobsOfDay]) => ({
        dateLabel: new Date(key + "T12:00:00Z").toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
        jobs: jobsOfDay.map((j) => ({
          time: new Date(j.scheduled_at).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          }),
          serviceName: humanize(j.service_type),
          clientName: j.client?.name ?? "A client",
        })),
      }));

      const template = employeeWeeklyScheduleEmail({
        recipientName: recipient.fullName ?? "there",
        orgName: org.name,
        weekLabel,
        days,
        totalJobs: jobs.length,
        fieldAppUrl: `${siteUrl}/field/jobs`,
      });

      await sendEmail({
        to: recipient.email,
        toName: recipient.fullName ?? undefined,
        ...template,
      });
      emailsSent += 1;
    }

    console.log(`[auto] Weekly schedule emails sent for org ${org.id}`);
  }

  return { emailsSent };
}

// 17. Overtime warning (cron Friday 15:00 UTC)
export async function sendOvertimeWarnings(): Promise<{ emailsSent: number }> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { employeeOvertimeWarningEmail } = await import("@/lib/email-templates");

  // Week = Monday through Sunday, UTC. Friday = most of the week banked.
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, ... 5=Fri, 6=Sat
  const mondayOffset = (day + 6) % 7; // Monday=0, ... Sunday=6
  const startOfWeek = new Date(now);
  startOfWeek.setUTCDate(now.getUTCDate() - mondayOffset);
  startOfWeek.setUTCHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekLabel = `Week of ${startOfWeek.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;

  const { data: orgs } = await db
    .from("organizations")
    .select("id, name, overtime_threshold_hours")
    .is("deleted_at", null) as unknown as {
    data: Array<{ id: string; name: string; overtime_threshold_hours: number }> | null;
  };

  if (!orgs) return { emailsSent: 0 };
  let emailsSent = 0;

  for (const org of orgs) {
    if (!(await isAutomationEnabled(org.id, "overtime_warning"))) continue;
    const threshold = org.overtime_threshold_hours ?? 40;

    // Sum hours_worked from time_entries per membership for this week.
    const { data: entries } = await db
      .from("time_entries")
      .select("membership_id, clock_in_at, clock_out_at")
      .eq("organization_id", org.id)
      .gte("clock_in_at" as never, startOfWeek.toISOString() as never)
      .lt("clock_in_at" as never, endOfWeek.toISOString() as never)
      .not("clock_out_at", "is", null) as unknown as {
      data: Array<{
        membership_id: string;
        clock_in_at: string;
        clock_out_at: string;
      }> | null;
    };

    if (!entries || entries.length === 0) continue;

    // Accumulate total hours per membership.
    const hoursByMembership = new Map<string, number>();
    for (const e of entries) {
      const ms =
        new Date(e.clock_out_at).getTime() - new Date(e.clock_in_at).getTime();
      const hours = ms / (1000 * 60 * 60);
      hoursByMembership.set(
        e.membership_id,
        (hoursByMembership.get(e.membership_id) ?? 0) + hours,
      );
    }

    // Warning band: >= 80% of threshold.
    const warnCutoff = threshold * 0.8;

    for (const [membershipId, total] of hoursByMembership) {
      if (total < warnCutoff) continue;
      const recipient = await getMembershipRecipient(membershipId);
      if (!recipient) continue;

      const template = employeeOvertimeWarningEmail({
        recipientName: recipient.fullName ?? "there",
        orgName: org.name,
        hoursWorked: total.toFixed(1),
        thresholdHours: threshold.toFixed(threshold % 1 === 0 ? 0 : 1),
        weekLabel,
        isOver: total >= threshold,
      });
      await sendEmail({
        to: recipient.email,
        toName: recipient.fullName ?? undefined,
        ...template,
      });
      emailsSent += 1;
    }

    if (emailsSent > 0) {
      console.log(`[auto] Overtime warnings sent for org ${org.id}`);
    }
  }

  return { emailsSent };
}

// 18. PTO status notification (event — called from the approve/decline action)
export async function notifyPtoStatus(ptoRequestId: string): Promise<void> {
  try {
    const db = admin();
    const { sendEmail } = await import("@/lib/email");
    const { employeePtoStatusEmail } = await import("@/lib/email-templates");

    const { data: req } = await db
      .from("pto_requests" as never)
      .select(
        "id, organization_id, employee_id, start_date, end_date, hours, reason, status",
      )
      .eq("id" as never, ptoRequestId as never)
      .maybeSingle() as unknown as {
      data: {
        id: string;
        organization_id: string;
        employee_id: string;
        start_date: string;
        end_date: string;
        hours: number;
        reason: string | null;
        status: string;
      } | null;
    };

    if (!req) return;
    if (!["approved", "declined", "cancelled"].includes(req.status)) return;

    if (!(await isAutomationEnabled(req.organization_id, "pto_status_notify"))) {
      console.log(`[auto] PTO status notify paused for org ${req.organization_id}`);
      return;
    }

    const recipient = await getMembershipRecipient(req.employee_id);
    if (!recipient) return;

    const { data: org } = await db
      .from("organizations")
      .select("name")
      .eq("id", req.organization_id)
      .maybeSingle() as unknown as { data: { name: string } | null };

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
    const fmt = (d: string) =>
      new Date(d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

    const template = employeePtoStatusEmail({
      recipientName: recipient.fullName ?? "there",
      orgName: org?.name ?? "your organization",
      status: req.status as "approved" | "declined" | "cancelled",
      startDate: fmt(req.start_date),
      endDate: fmt(req.end_date),
      hours: req.hours,
      reason: req.reason,
      dashboardUrl: `${siteUrl}/field/profile`,
    });
    await sendEmail({
      to: recipient.email,
      toName: recipient.fullName ?? undefined,
      ...template,
    });
    console.log(`[auto] PTO ${req.status} email sent to ${recipient.email}`);
  } catch (err) {
    console.error("[auto] notifyPtoStatus failed:", err);
  }
}

// 19. Payroll paid receipt (event — called from markPayrollPaidAction)
export async function notifyPayrollPaid(payrollRunId: string): Promise<void> {
  try {
    const db = admin();
    const { sendEmail } = await import("@/lib/email");
    const { employeePayrollPaidEmail } = await import("@/lib/email-templates");
    const { formatCurrencyCents } = await import("@/lib/format");
    const { getOrgCurrency } = await import("@/lib/org-currency");

    const { data: run } = await db
      .from("payroll_runs" as never)
      .select("id, organization_id, period_start, period_end, paid_at")
      .eq("id" as never, payrollRunId as never)
      .maybeSingle() as unknown as {
      data: {
        id: string;
        organization_id: string;
        period_start: string;
        period_end: string;
        paid_at: string | null;
      } | null;
    };

    if (!run) return;
    if (!(await isAutomationEnabled(run.organization_id, "payroll_paid_receipt"))) {
      console.log(`[auto] Payroll paid receipt paused for org ${run.organization_id}`);
      return;
    }

    const { data: items } = await db
      .from("payroll_items" as never)
      .select(
        "employee_id, hours_worked, regular_pay_cents, bonus_cents, pto_hours, pto_pay_cents, total_cents",
      )
      .eq("payroll_run_id" as never, payrollRunId as never) as unknown as {
      data: Array<{
        employee_id: string;
        hours_worked: number;
        regular_pay_cents: number;
        bonus_cents: number;
        pto_hours: number;
        pto_pay_cents: number;
        total_cents: number;
      }> | null;
    };

    if (!items || items.length === 0) return;

    const { data: org } = await db
      .from("organizations")
      .select("name")
      .eq("id", run.organization_id)
      .maybeSingle() as unknown as { data: { name: string } | null };
    const currency = await getOrgCurrency(run.organization_id);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
    const paidDate = new Date(run.paid_at ?? new Date()).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const periodStart = new Date(run.period_start).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const periodEnd = new Date(run.period_end).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    for (const item of items) {
      const recipient = await getMembershipRecipient(item.employee_id);
      if (!recipient) continue;

      const template = employeePayrollPaidEmail({
        recipientName: recipient.fullName ?? "there",
        orgName: org?.name ?? "your organization",
        amountFormatted: formatCurrencyCents(item.total_cents, currency),
        periodStart,
        periodEnd,
        hoursWorked: `${item.hours_worked}`,
        regularPay: formatCurrencyCents(item.regular_pay_cents, currency),
        bonusPay: formatCurrencyCents(item.bonus_cents, currency),
        ptoPay: formatCurrencyCents(item.pto_pay_cents, currency),
        paidDate,
        dashboardUrl: `${siteUrl}/field/profile`,
      });
      await sendEmail({
        to: recipient.email,
        toName: recipient.fullName ?? undefined,
        ...template,
      });
    }
    console.log(`[auto] Payroll paid receipts sent for run ${payrollRunId}`);
  } catch (err) {
    console.error("[auto] notifyPayrollPaid failed:", err);
  }
}

// 20. Training assignment notification (event)
export async function notifyTrainingAssigned(
  assignmentId: string,
): Promise<void> {
  try {
    const db = admin();
    const { sendEmail } = await import("@/lib/email");
    const { employeeTrainingAssignedEmail } = await import("@/lib/email-templates");

    const { data: assignment } = await db
      .from("training_assignments")
      .select("id, organization_id, employee_id, module_id")
      .eq("id", assignmentId)
      .maybeSingle() as unknown as {
      data: {
        id: string;
        organization_id: string;
        employee_id: string;
        module_id: string;
      } | null;
    };

    if (!assignment) return;
    if (!(await isAutomationEnabled(assignment.organization_id, "training_assigned_notify"))) {
      return;
    }

    const [{ data: module }, { data: org }] = await Promise.all([
      db.from("training_modules")
        .select("title, description")
        .eq("id", assignment.module_id)
        .maybeSingle() as unknown as Promise<{
        data: { title: string; description: string | null } | null;
      }>,
      db.from("organizations")
        .select("name")
        .eq("id", assignment.organization_id)
        .maybeSingle() as unknown as Promise<{
        data: { name: string } | null;
      }>,
    ]);

    if (!module) return;
    const recipient = await getMembershipRecipient(assignment.employee_id);
    if (!recipient) return;

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
    const template = employeeTrainingAssignedEmail({
      recipientName: recipient.fullName ?? "there",
      orgName: org?.name ?? "your organization",
      moduleTitle: module.title,
      moduleDescription: module.description,
      trainingUrl: `${siteUrl}/field/training/${assignment.module_id}`,
    });
    await sendEmail({
      to: recipient.email,
      toName: recipient.fullName ?? undefined,
      ...template,
    });
    console.log(`[auto] Training assigned email sent to ${recipient.email}`);
  } catch (err) {
    console.error("[auto] notifyTrainingAssigned failed:", err);
  }
}

// 21. Certification expiry reminders (cron daily 14:00 UTC)
export async function sendCertificationExpiryReminders(): Promise<{
  sent: number;
}> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { employeeCertificationExpiryEmail } = await import("@/lib/email-templates");

  const now = Date.now();
  const in30d = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
  const in7d = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Pull all assignments expiring in the next 30 days that need an alert.
  const { data: rows } = await db
    .from("training_assignments")
    .select(`
      id, organization_id, employee_id, module_id, certification_expires_at,
      expiry_reminder_30d_sent_at, expiry_reminder_7d_sent_at
    `)
    .not("certification_expires_at" as never, "is" as never, null as never)
    .gte("certification_expires_at" as never, new Date(now).toISOString() as never)
    .lte("certification_expires_at" as never, in30d as never) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      employee_id: string;
      module_id: string;
      certification_expires_at: string;
      expiry_reminder_30d_sent_at: string | null;
      expiry_reminder_7d_sent_at: string | null;
    }> | null;
  };

  if (!rows || rows.length === 0) return { sent: 0 };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  let sent = 0;

  for (const a of rows) {
    if (
      !(await isAutomationEnabled(a.organization_id, "certification_expiry_reminder"))
    ) {
      continue;
    }

    const expiresAt = a.certification_expires_at;
    const daysUntil = Math.max(
      1,
      Math.ceil(
        (new Date(expiresAt).getTime() - now) / (24 * 60 * 60 * 1000),
      ),
    );

    // Which reminder bucket? Priority: 7-day > 30-day.
    const needs7d =
      expiresAt <= in7d && !a.expiry_reminder_7d_sent_at;
    const needs30d =
      !needs7d && !a.expiry_reminder_30d_sent_at;

    if (!needs7d && !needs30d) continue;

    const [{ data: module }, { data: org }] = await Promise.all([
      db.from("training_modules")
        .select("title")
        .eq("id", a.module_id)
        .maybeSingle() as unknown as Promise<{
        data: { title: string } | null;
      }>,
      db.from("organizations")
        .select("name")
        .eq("id", a.organization_id)
        .maybeSingle() as unknown as Promise<{
        data: { name: string } | null;
      }>,
    ]);

    if (!module) continue;
    const recipient = await getMembershipRecipient(a.employee_id);
    if (!recipient) continue;

    const template = employeeCertificationExpiryEmail({
      recipientName: recipient.fullName ?? "there",
      orgName: org?.name ?? "your organization",
      moduleTitle: module.title,
      expiresOn: new Date(expiresAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
      daysUntilExpiry: daysUntil,
      trainingUrl: `${siteUrl}/field/training/${a.module_id}`,
    });
    await sendEmail({
      to: recipient.email,
      toName: recipient.fullName ?? undefined,
      ...template,
    });

    // Stamp the correct bucket.
    const update = needs7d
      ? { expiry_reminder_7d_sent_at: new Date().toISOString() }
      : { expiry_reminder_30d_sent_at: new Date().toISOString() };

    await db
      .from("training_assignments")
      .update(update as never)
      .eq("id", a.id);

    sent += 1;
  }

  if (sent > 0) console.log(`[auto] Certification expiry reminders sent: ${sent}`);
  return { sent };
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

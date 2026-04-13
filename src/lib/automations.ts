/**
 * Internal automations — fire-and-forget side effects that make the
 * platform feel alive. Every function here swallows errors so it
 * can never break the primary action.
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToMembership, sendPushToOrg } from "@/lib/push";

const admin = () => createSupabaseAdminClient();

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
      .gte("created_at" as never, cutoff as never)) as unknown as {
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
      .eq("employee_id", membershipId);

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
      .ilike("title" as never, "%stale estimate%" as never)) as unknown as {
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

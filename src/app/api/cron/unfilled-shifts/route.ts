/**
 * Cron: Unfilled shift alerts
 *
 * Runs periodically (e.g. every hour via Vercel Cron) and checks for bookings
 * that are scheduled within the next 24 hours but have no one assigned.
 *
 * For each match, creates an in-app notification for the org with a link to
 * the booking detail page (where the owner can dispatch to freelancers).
 *
 * Protected by CRON_SECRET — Vercel passes this in the Authorization header.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCronAuth } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Find bookings starting within 24h that have no assigned_to
  const { data: unfilledBookings, error } = await admin
    .from("bookings")
    .select(
      `
      id, organization_id, scheduled_at, service_type,
      client:clients ( name )
    `,
    )
    .is("assigned_to", null)
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", in24h.toISOString())
    .in("status", ["pending", "confirmed"]);

  if (error) {
    console.error("[cron/unfilled-shifts] query error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!unfilledBookings || unfilledBookings.length === 0) {
    return Response.json({ created: 0 });
  }

  // assigned_to IS NULL is not the same as "nobody is coming". A crew via
  // booking_assignees, or a freelancer who claimed a bench offer, both leave
  // that column empty — so without this the cron re-offers shifts that are
  // already covered, to a bench that has already filled them.
  const { resolveBookingCoverage } = await import("@/lib/booking-coverage");
  const coverage = await resolveBookingCoverage(
    unfilledBookings.map((b) => b.id),
  );
  const trulyUnfilled = unfilledBookings.filter(
    (b) => !coverage.get(b.id)?.staffed,
  );
  if (trulyUnfilled.length === 0) {
    return Response.json({ created: 0 });
  }

  // Check which bookings already have a recent unfilled_shift notification
  // (avoid duplicate alerts within the same 24h window)
  const bookingIds = trulyUnfilled.map((b) => b.id);
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: existingNotifs } = (await admin
    .from("notifications" as never)
    .select("href")
    .eq("type", "unfilled_shift")
    .gte("created_at", cutoff)) as unknown as {
    data: Array<{ href: string | null }> | null;
  };

  const alreadyNotified = new Set(
    (existingNotifs ?? []).map((n: { href: string | null }) => {
      // href format: /app/bookings/{id}
      const parts = (n.href ?? "").split("/");
      return parts[parts.length - 1];
    }),
  );

  const toNotify = trulyUnfilled.filter(
    (b) => !alreadyNotified.has(b.id),
  );

  if (toNotify.length === 0) {
    return Response.json({ created: 0, skipped: bookingIds.length });
  }

  // Per-org gates + timezone (audit T8): this alert was ungated (fired for
  // orgs with automations off) and rendered shift times in UTC, so admins saw
  // "at 4:00 AM" for a 9 PM job. Gate on the same key as the sibling
  // unassigned-booking alert — they cover the same condition, so one toggle
  // governs both alert streams.
  const orgIds = [...new Set(toNotify.map((b) => b.organization_id))];
  const { data: orgRows } = (await admin
    .from("organizations")
    .select("id, timezone")
    .in("id", orgIds)) as unknown as {
    data: Array<{ id: string; timezone: string | null }> | null;
  };
  const orgTz = new Map(
    (orgRows ?? []).map((o) => [o.id, o.timezone ?? "America/Edmonton"]),
  );
  const { isAutomationEnabledForOrg } = await import("@/lib/automations");
  const gate = new Map<string, boolean>();
  for (const id of orgIds) {
    gate.set(id, await isAutomationEnabledForOrg(id, "unassigned_booking_alert"));
  }

  // Notify org management (owner/admin/manager) — those are the people who
  // staff shifts. Route through notify() rather than inserting notification
  // rows directly: notify() also fires a push (the raw insert reached only the
  // in-app bell, never the phone) and applies the correct recipient/RLS
  // scoping.
  const { notify } = await import("@/lib/notify");
  let created = 0;
  for (const b of toNotify) {
    if (!gate.get(b.organization_id)) continue;
    const clientName =
      (b.client as unknown as { name: string } | null)?.name ?? "a client";
    const when = new Date(b.scheduled_at).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: orgTz.get(b.organization_id) ?? "America/Edmonton",
    });

    await notify({
      organizationId: b.organization_id,
      audience: "org-management",
      type: "unfilled_shift",
      title: "Unfilled shift in < 24h",
      body: `${b.service_type ?? "Cleaning"} for ${clientName} at ${when} has no one assigned.`,
      href: `/app/bookings/${b.id}`,
    });
    created += 1;
  }

  return Response.json({ created });
}

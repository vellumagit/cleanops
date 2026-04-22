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

  // Check which bookings already have a recent unfilled_shift notification
  // (avoid duplicate alerts within the same 24h window)
  const bookingIds = unfilledBookings.map((b) => b.id);
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

  const toNotify = unfilledBookings.filter(
    (b) => !alreadyNotified.has(b.id),
  );

  if (toNotify.length === 0) {
    return Response.json({ created: 0, skipped: bookingIds.length });
  }

  // Create notifications
  const rows = toNotify.map((b) => {
    const clientName =
      (b.client as unknown as { name: string } | null)?.name ?? "a client";
    const when = new Date(b.scheduled_at).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    return {
      organization_id: b.organization_id,
      type: "unfilled_shift" as const,
      title: `Unfilled shift in < 24h`,
      body: `${b.service_type ?? "Cleaning"} for ${clientName} at ${when} has no one assigned.`,
      href: `/app/bookings/${b.id}`,
    };
  });

  const { error: insertError } = await admin
    .from("notifications" as never)
    .insert(rows as never);

  if (insertError) {
    console.error("[cron/unfilled-shifts] insert error:", insertError.message);
    return Response.json({ error: insertError.message }, { status: 500 });
  }

  return Response.json({ created: rows.length });
}

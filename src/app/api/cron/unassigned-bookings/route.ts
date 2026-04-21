/**
 * Cron: unassigned booking alert to owners/admins.
 *
 * Runs daily at 22:00 UTC. Scans for bookings in the next 24h with no
 * assigned_to, deduped by bookings.unassigned_alert_sent_at. Emails
 * the owner ONLY if there's something to alert about — the cron is
 * silent on days where everything is staffed.
 *
 * Gated per-org by the `unassigned_booking_alert` automation toggle.
 * Not affected by CLIENT_EMAILS_PAUSED (this is admin-facing, not
 * org→client).
 */

import { sendUnassignedBookingAlerts } from "@/lib/automations";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendUnassignedBookingAlerts();
    return Response.json(result);
  } catch (err) {
    console.error("[cron/unassigned-bookings] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

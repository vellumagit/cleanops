/**
 * Cron: 24-hour booking reminder email to the client.
 *
 * Separate from /api/cron/upcoming-jobs which notifies the employee 1 hour
 * before the job. This one emails the CLIENT ~24h before the job. Runs
 * daily at 18:00 UTC (≈ early afternoon in North America) so clients get
 * an afternoon-before heads-up.
 *
 * Gated three ways in sendUpcomingBookingReminders:
 *   - Platform kill switch (CLIENT_EMAILS_PAUSED) via sendOrgEmail
 *   - Per-org automation toggle (booking_reminder_client_email)
 *   - Dedup by bookings.client_reminder_sent_at (each booking reminded at most once)
 *
 * Protected by CRON_SECRET.
 */

import { sendUpcomingBookingReminders } from "@/lib/automations";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendUpcomingBookingReminders();
    return Response.json(result);
  } catch (err) {
    console.error("[cron/booking-reminders-client] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

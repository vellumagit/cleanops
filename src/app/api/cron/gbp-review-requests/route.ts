/**
 * Cron: Google review request — initial ask + escalating reminders.
 *
 * Runs daily at ~11:00 UTC. Two phases in one pass:
 *
 *   PHASE A (initial):  Clients whose first completed booking ended
 *                       between 48h–14d ago, state = never_asked.
 *                       Schedules the first reminder 1 week out.
 *   PHASE B (reminder): Clients with state = pending whose
 *                       next_reminder_at has passed; subsequent
 *                       reminders every gbp_review_reminder_days
 *                       (default 30), capped at the org's
 *                       gbp_review_max_reminders (default 5) before
 *                       flipping to "lapsed".
 *                       Net default cadence: 48h → +1wk → monthly ×4.
 *
 * Stop signals (any of these = no more email ever):
 *   - Customer clicked the redirect link (/r/g/<token>)
 *   - Customer unsubscribed (/u/g/<token>)
 *   - Owner manually marked as reviewed
 *   - Reminder cap hit
 *
 * Gated by:
 *   - CLIENT_EMAILS_PAUSED platform kill switch
 *   - Per-org `gbp_review_request` automation toggle
 *   - Org must have google_review_url set
 *
 * Protected by CRON_SECRET.
 */

import { sendGbpReviewRequests } from "@/lib/automations";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await sendGbpReviewRequests();
    return Response.json(result);
  } catch (err) {
    console.error("[cron/gbp-review-requests] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

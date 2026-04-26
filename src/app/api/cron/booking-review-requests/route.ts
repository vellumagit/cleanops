/**
 * Cron: post-completion review request email to the client.
 *
 * Runs daily at 10:00 UTC. Finds bookings completed 20+ hours ago that
 * haven't been review-requested yet and emails the client a /review/<token>
 * link. After a ≥4 star submission the review page shows a Google CTA using
 * organizations.google_review_url (set in Settings → Branding).
 *
 * Gated three ways in sendBookingReviewRequests:
 *   - Platform kill switch (CLIENT_EMAILS_PAUSED)
 *   - Per-org automation toggle (review_request_after_completion)
 *   - Dedup by bookings.review_request_sent_at — each booking emailed at most once
 *
 * Protected by CRON_SECRET.
 */

import { sendBookingReviewRequests } from "@/lib/automations";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await sendBookingReviewRequests();
    return Response.json(result);
  } catch (err) {
    console.error("[cron/booking-review-requests] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

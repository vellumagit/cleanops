/**
 * Cron: follow US texting registrations through carrier review.
 *
 * Hourly. For each registration waiting on Twilio or the carriers: an
 * approved brand gets its messaging service and campaign; an approved
 * campaign gets its number and texting switched on; a rejection is put in
 * front of the owner with the carriers' reason. Quiet when nothing moved.
 * See src/lib/twilio-a2p.ts.
 *
 * Protected by CRON_SECRET.
 */
import { requireCronAuth } from "@/lib/cron-auth";
import { advanceAllUsRegistrations } from "@/lib/twilio-a2p";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return Response.json(await advanceAllUsRegistrations());
  } catch (err) {
    console.error("[cron/sms-registrations] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * Cron: wall clock → instant, nightly.
 *
 * Every future visit stores the time a person booked (scheduled_local in
 * scheduled_tz) and the instant derived from it (scheduled_at). This re-derives
 * the instant under the runtime's current zone rules, so a change in those
 * rules — Alberta dropping its clock change, 2026-11-01 — corrects every
 * affected visit the next night instead of leaving them an hour off until
 * someone notices. Quiet when nothing changed. Refuses zones the runtime has
 * wrong. ?dry=1 reports without writing.
 *
 * Protected by CRON_SECRET.
 */
import { requireCronAuth } from "@/lib/cron-auth";
import { rederiveScheduledInstants } from "@/lib/scheduled-local-job";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const dryRun = new URL(request.url).searchParams.get("dry") === "1";
    const result = await rederiveScheduledInstants({ dryRun });
    return Response.json(result);
  } catch (err) {
    console.error("[cron/rederive-times] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

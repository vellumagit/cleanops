/**
 * Cron: Stale estimate alerts
 *
 * Runs once a day. Finds estimates that have been in "sent" status for 7+
 * days without a decision (approved/declined) and creates a notification
 * reminding the team to follow up.
 *
 * Protected by CRON_SECRET — Vercel passes this in the Authorization header.
 */

import { alertStaleEstimates } from "@/lib/automations";
import { requireCronAuth } from "@/lib/cron-auth";
import { withCronRun } from "@/lib/cron-run";

async function cronGet(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const count = await alertStaleEstimates();
    return Response.json({ created: count });
  } catch (err) {
    console.error("[cron/stale-estimates] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Every run leaves a row in cron_runs (src/lib/cron-run.ts); the morning
// check lists what failed and what stopped running.
export const GET = withCronRun("/api/cron/stale-estimates", cronGet);

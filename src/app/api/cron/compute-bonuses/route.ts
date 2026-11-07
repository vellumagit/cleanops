/**
 * Cron: Weekly bonus computation
 *
 * Runs every Monday at 8 AM UTC. For every org with an enabled review
 * bonus rule, computes bonuses for the configured period and awards any
 * that meet the threshold. Idempotent — existing bonuses aren't duplicated.
 */

import { autoComputeReviewBonuses } from "@/lib/automations";
import { requireCronAuth } from "@/lib/cron-auth";
import { withCronRun } from "@/lib/cron-run";

async function cronGet(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const created = await autoComputeReviewBonuses();
    return Response.json({ created });
  } catch (err) {
    console.error("[cron/compute-bonuses] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Every run leaves a row in cron_runs (src/lib/cron-run.ts); the morning
// check lists what failed and what stopped running.
export const GET = withCronRun("/api/cron/compute-bonuses", cronGet);

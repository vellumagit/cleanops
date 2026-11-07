/**
 * Cron: Monthly operations digest to owners/admins.
 *
 * Runs on the 1st of each month at 09:00 UTC. Summarizes the previous
 * calendar month: revenue, job counts, avg rating, top 3 clients,
 * top employee, new clients added.
 *
 * Gated per-org by the `monthly_ops_digest` automation toggle.
 */

import { sendMonthlyOpsDigests } from "@/lib/automations";
import { requireCronAuth } from "@/lib/cron-auth";
import { withCronRun } from "@/lib/cron-run";

export const runtime = "nodejs";
export const maxDuration = 300;

async function cronGet(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await sendMonthlyOpsDigests();
    return Response.json(result);
  } catch (err) {
    console.error("[cron/monthly-ops-digest] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Every run leaves a row in cron_runs (src/lib/cron-run.ts); the morning
// check lists what failed and what stopped running.
export const GET = withCronRun("/api/cron/monthly-ops-digest", cronGet);

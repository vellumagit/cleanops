/**
 * Cron: Weekly operations digest to owners/admins.
 *
 * Runs Monday at 08:00 UTC. Summarizes the prior 7 days of revenue,
 * completed/cancelled jobs, average rating, overdue invoices, and
 * upcoming unassigned bookings.
 *
 * Gated per-org by the `weekly_ops_digest` automation toggle.
 */

import { sendWeeklyOpsDigests } from "@/lib/automations";
import { requireCronAuth } from "@/lib/cron-auth";
import { withCronRun } from "@/lib/cron-run";

export const runtime = "nodejs";
export const maxDuration = 300; // larger tenants with many weeks of data

async function cronGet(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await sendWeeklyOpsDigests();
    return Response.json(result);
  } catch (err) {
    console.error("[cron/weekly-ops-digest] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Every run leaves a row in cron_runs (src/lib/cron-run.ts); the morning
// check lists what failed and what stopped running.
export const GET = withCronRun("/api/cron/weekly-ops-digest", cronGet);

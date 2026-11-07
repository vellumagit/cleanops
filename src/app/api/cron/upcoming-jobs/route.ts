/**
 * Cron: Upcoming job reminders
 *
 * Runs every hour. Finds jobs starting within the next 60 minutes that are
 * assigned to an employee and creates an in-app notification so they get a
 * heads-up before their next job.
 *
 * Protected by CRON_SECRET — Vercel passes this in the Authorization header.
 */

import { notifyUpcomingJobs } from "@/lib/automations";
import { requireCronAuth } from "@/lib/cron-auth";
import { withCronRun } from "@/lib/cron-run";

async function cronGet(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const count = await notifyUpcomingJobs();
    return Response.json({ created: count });
  } catch (err) {
    console.error("[cron/upcoming-jobs] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Every run leaves a row in cron_runs (src/lib/cron-run.ts); the morning
// check lists what failed and what stopped running.
export const GET = withCronRun("/api/cron/upcoming-jobs", cronGet);

/**
 * Cron: hard-purge organizations whose 30-day deletion grace window has elapsed.
 *
 * Runs daily. Protected by CRON_SECRET (Vercel passes it in the
 * Authorization header).
 */

import { purgeExpiredOrgs } from "@/lib/tenant-data";
import { requireCronAuth } from "@/lib/cron-auth";
import { withCronRun } from "@/lib/cron-run";

export const runtime = "nodejs";
export const maxDuration = 300; // big purges can take a while

async function cronGet(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await purgeExpiredOrgs();
    console.log(
      `[cron/purge-orgs] purged ${result.purgedOrgIds.length} org(s):`,
      result.purgedOrgIds,
    );
    return Response.json(result);
  } catch (err) {
    console.error("[cron/purge-orgs] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Every run leaves a row in cron_runs (src/lib/cron-run.ts); the morning
// check lists what failed and what stopped running.
export const GET = withCronRun("/api/cron/purge-orgs", cronGet);

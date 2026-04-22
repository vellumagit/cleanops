/**
 * Cron: hard-purge organizations whose 30-day deletion grace window has elapsed.
 *
 * Runs daily. Protected by CRON_SECRET (Vercel passes it in the
 * Authorization header).
 */

import { purgeExpiredOrgs } from "@/lib/tenant-data";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300; // big purges can take a while

export async function GET(request: Request) {
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

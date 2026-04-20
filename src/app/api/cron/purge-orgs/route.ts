/**
 * Cron: hard-purge organizations whose 30-day deletion grace window has elapsed.
 *
 * Runs daily. Protected by CRON_SECRET (Vercel passes it in the
 * Authorization header).
 */

import { purgeExpiredOrgs } from "@/lib/tenant-data";

export const runtime = "nodejs";
export const maxDuration = 300; // big purges can take a while

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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

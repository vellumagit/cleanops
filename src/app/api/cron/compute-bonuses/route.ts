/**
 * Cron: Weekly bonus computation
 *
 * Runs every Monday at 8 AM UTC. For every org with an enabled review
 * bonus rule, computes bonuses for the configured period and awards any
 * that meet the threshold. Idempotent — existing bonuses aren't duplicated.
 */

import { autoComputeReviewBonuses } from "@/lib/automations";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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

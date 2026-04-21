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

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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

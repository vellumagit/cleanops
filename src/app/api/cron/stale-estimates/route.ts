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

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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

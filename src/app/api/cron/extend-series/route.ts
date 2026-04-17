/**
 * Cron: Auto-extend recurring booking series
 *
 * Runs daily. For each active series whose latest generated booking is
 * within 2 weeks, generates the next batch of occurrences so the schedule
 * never runs dry.
 *
 * Protected by CRON_SECRET — Vercel passes this in the Authorization header.
 */

import { autoExtendRecurringSeries } from "@/lib/automations";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const count = await autoExtendRecurringSeries();
    return Response.json({ generated: count });
  } catch (err) {
    console.error("[cron/extend-series] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

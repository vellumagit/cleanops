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
import { requireCronAuth } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

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

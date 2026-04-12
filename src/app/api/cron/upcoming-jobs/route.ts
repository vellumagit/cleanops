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

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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

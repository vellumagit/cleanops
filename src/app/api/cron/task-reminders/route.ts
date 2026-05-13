/**
 * Cron: task remind_at push notifications.
 *
 * Runs every 5 minutes (or as frequently as the Vercel cron config allows).
 * Finds tasks whose remind_at has passed, have not been reminded yet, and
 * have not been completed, then fires a push notification via sendTaskReminder.
 *
 * The tasks table has an index on (remind_at) WHERE reminded_at IS NULL AND
 * completed_at IS NULL — this query is fast even at scale.
 *
 * Protected by CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTaskReminder } from "@/lib/automations";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();

    // Find tasks that are due for a reminder
    const { data: tasks, error } = await admin
      .from("tasks" as never)
      .select("id")
      .lte("remind_at" as never, now)
      .is("reminded_at" as never, null)
      .is("completed_at" as never, null)
      .limit(100) as unknown as { data: Array<{ id: string }> | null; error: Error | null };

    if (error) throw error;

    const ids = tasks ?? [];
    let fired = 0;
    let failed = 0;

    // Process sequentially to avoid hammering the push service
    for (const { id } of ids) {
      try {
        await sendTaskReminder(id);
        fired++;
      } catch {
        failed++;
      }
    }

    return NextResponse.json({ fired, failed, total: ids.length });
  } catch (err) {
    console.error("[cron/task-reminders] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

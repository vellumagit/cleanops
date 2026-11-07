/**
 * Cron: Invoice overdue reminders
 *
 * Runs daily. Finds overdue, unpaid invoices whose last reminder is NULL or
 * older than 7 days, and emails the client a polite reminder. Per-org
 * toggleable via /app/settings/automations → invoice_overdue_reminder.
 *
 * Protected by CRON_SECRET — Vercel passes this in the Authorization header.
 */

import { sendOverdueReminders } from "@/lib/automations";
import { requireCronAuth } from "@/lib/cron-auth";
import { withCronRun } from "@/lib/cron-run";

export const runtime = "nodejs";
export const maxDuration = 60;

async function cronGet(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await sendOverdueReminders();
    return Response.json(result);
  } catch (err) {
    console.error("[cron/invoice-overdue] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Every run leaves a row in cron_runs (src/lib/cron-run.ts); the morning
// check lists what failed and what stopped running.
export const GET = withCronRun("/api/cron/invoice-overdue", cronGet);

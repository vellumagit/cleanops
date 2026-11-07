import { requireCronAuth } from "@/lib/cron-auth";
import { autoGenerateRecurringInvoices } from "@/lib/automations";
import { withCronRun } from "@/lib/cron-run";

export const runtime = "nodejs";
export const maxDuration = 300;

async function cronGet(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return Response.json(await autoGenerateRecurringInvoices());
  } catch (err) {
    console.error("[cron/recurring-invoices] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Every run leaves a row in cron_runs (src/lib/cron-run.ts); the morning
// check lists what failed and what stopped running.
export const GET = withCronRun("/api/cron/recurring-invoices", cronGet);

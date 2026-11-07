/**
 * Cron: Morning invoice review digest — daily at 13:00 UTC (early morning
 * in Canada, hours before any org's invoice send slot).
 *
 * Emails each org's owners/admins yesterday's completed jobs plus the
 * invoice drafts auto-sending later today, so mistakes get fixed or held
 * before a client sees them. Skips orgs with nothing to report.
 *
 * Gated by:
 *   - Per-org `invoice_review_digest` automation toggle (opt-in)
 *   - Org master automations switch
 *
 * Protected by CRON_SECRET.
 */

import { sendInvoiceReviewDigests } from "@/lib/automations";
import { requireCronAuth } from "@/lib/cron-auth";
import { withCronRun } from "@/lib/cron-run";

export const runtime = "nodejs";
export const maxDuration = 120;

async function cronGet(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await sendInvoiceReviewDigests();
    return Response.json(result);
  } catch (err) {
    console.error("[cron/invoice-review-digest] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Every run leaves a row in cron_runs (src/lib/cron-run.ts); the morning
// check lists what failed and what stopped running.
export const GET = withCronRun("/api/cron/invoice-review-digest", cronGet);

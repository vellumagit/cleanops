/**
 * Cron: pay-period autodraft
 *
 * Daily at 13:00 UTC (early morning across North America). For every org
 * with a pay schedule set, prepares the just-ended period — employee run
 * + contractor statement — and notifies management it's ready for review.
 * Drafts only; money never moves without a human finalizing.
 */

import { runPayrollAutodraft } from "@/lib/payroll-autodraft";
import { requireCronAuth } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await runPayrollAutodraft();
    return Response.json(result);
  } catch (err) {
    console.error("[cron/payroll-autodraft] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

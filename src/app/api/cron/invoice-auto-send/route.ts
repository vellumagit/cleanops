/**
 * Cron: Invoice auto-send
 *
 * Runs hourly. Sends drafted invoices whose review window (auto_send_at) has
 * elapsed and are still 'scheduled' drafts. Opt-in per org via
 * /app/settings/invoicing → auto-send. Reads each invoice live at send time so
 * edits made during the window are included. See src/lib/invoice-send.ts.
 *
 * Protected by CRON_SECRET — Vercel passes this in the Authorization header.
 */

import { runInvoiceAutoSend } from "@/lib/invoice-send";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await runInvoiceAutoSend();
    return Response.json(result);
  } catch (err) {
    console.error("[cron/invoice-auto-send] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

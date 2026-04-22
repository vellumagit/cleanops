import { requireCronAuth } from "@/lib/cron-auth";
import { autoVoidOldInvoices } from "@/lib/automations";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return Response.json(await autoVoidOldInvoices());
  } catch (err) {
    console.error("[cron/void-invoices] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

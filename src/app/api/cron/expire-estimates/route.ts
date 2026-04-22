import { requireCronAuth } from "@/lib/cron-auth";
import { autoExpireStaleEstimates } from "@/lib/automations";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return Response.json(await autoExpireStaleEstimates());
  } catch (err) {
    console.error("[cron/expire-estimates] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

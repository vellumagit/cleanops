import { requireCronAuth } from "@/lib/cron-auth";
import { sendStaleEstimateFollowups } from "@/lib/automations";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return Response.json(await sendStaleEstimateFollowups());
  } catch (err) {
    console.error("[cron/estimate-followup] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

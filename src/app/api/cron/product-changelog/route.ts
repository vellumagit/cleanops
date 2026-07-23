/**
 * Weekly: email opted-in org owners any published-but-unsent changelog entries.
 *
 * Sends NOTHING on a quiet week — if there are no unsent entries the run is a
 * no-op, which is the "only when big changes are made" behaviour.
 *
 * Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.
 * Pass ?dry_run=1 to see who would receive it without sending.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { sendProductChangelog } from "@/lib/product-changelog";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";

  try {
    const result = await sendProductChangelog({ dryRun });
    return NextResponse.json({ ok: true, dry_run: dryRun, ...result });
  } catch (err) {
    console.error("[cron/product-changelog] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

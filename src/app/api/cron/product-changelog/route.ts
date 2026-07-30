/**
 * Weekly: email opted-in org owners any published-but-unsent changelog entries.
 *
 * FRIDAY 9:00 AM Mountain. Vercel crons are UTC-only, and Mountain shifts
 * between UTC-6 (MDT) and UTC-7 (MST) — a fixed UTC schedule would silently
 * drift to 8 AM every winter. So the cron fires at BOTH 15:00 and 16:00 UTC
 * on Fridays and this route drops whichever one isn't 9 AM locally. Exactly
 * one survives year-round.
 *
 * Sends NOTHING on a quiet week — if there are no unsent entries the run is a
 * no-op, which is the "only when big changes are made" behaviour.
 *
 * Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.
 * Pass ?dry_run=1 to see who would receive it without sending, or ?force=1
 * to bypass the 9 AM gate for a manual send.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { sendProductChangelog } from "@/lib/product-changelog";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** The wall clock this send is scheduled against. */
const SEND_TZ = "America/Edmonton";
const SEND_HOUR = 9;

function localHour(tz: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
}

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dry_run") === "1";
  const force = params.get("force") === "1";

  // Drop the invocation that isn't 9 AM Mountain. A manual run passes
  // ?force=1 so an owner isn't held hostage to the schedule.
  if (!force && !dryRun) {
    const hour = localHour(SEND_TZ);
    if (hour !== SEND_HOUR) {
      return NextResponse.json({
        ok: true,
        skipped: `not ${SEND_HOUR}:00 in ${SEND_TZ} (it is ${hour}:00)`,
      });
    }
  }

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

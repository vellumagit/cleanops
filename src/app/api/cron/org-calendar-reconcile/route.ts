/**
 * Daily: self-healing reconciler for ORG-level Google Calendar sync.
 *
 * Booking edits push to the org calendar best-effort — a failed push (token
 * blip, transient Google error) leaves the event DRIFTED (still there, but
 * showing the pre-edit day / crew / details) with nothing to correct it. This
 * walks every org with an active org-level Google connection and re-PATCHes
 * each upcoming booking's event to match the DB (see reconcileOrgCalendarEvents).
 *
 * Runs nightly with no params. Pass ?org_id=<UUID> to reconcile a single org on
 * demand (used to repair a specific customer immediately).
 *
 * Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`; a manual hit
 * can pass `?secret=<CRON_SECRET>` instead.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reconcileOrgCalendarEvents } from "@/lib/google-calendar";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Auth: header-only (Vercel cron sends the Bearer header).
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const admin = createSupabaseAdminClient();
  const singleOrg = url.searchParams.get("org_id");

  // Which orgs to reconcile: one on demand, or every org-level connection.
  let orgIds: string[];
  if (singleOrg) {
    orgIds = [singleOrg];
  } else {
    const { data: conns } = (await admin
      .from("integration_connections" as never)
      .select("organization_id")
      .eq("provider" as never, "google_calendar")
      .eq("status" as never, "active")
      .is("membership_id" as never, null as never)
      .limit(1000)) as unknown as {
      data: Array<{ organization_id: string }> | null;
    };
    orgIds = [...new Set((conns ?? []).map((c) => c.organization_id))];
  }

  let patched = 0;
  let created = 0;
  let failed = 0;
  const errors: Array<{ org_id: string; reason: string }> = [];

  for (const orgId of orgIds) {
    try {
      const r = await reconcileOrgCalendarEvents(orgId);
      patched += r.patched;
      created += r.created;
      failed += r.failed;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      errors.push({ org_id: orgId, reason });
      console.error(`[cron/org-calendar-reconcile] failed for org ${orgId}:`, reason);
    }
  }

  console.log(
    `[cron/org-calendar-reconcile] orgs=${orgIds.length} patched=${patched} created=${created} failed=${failed}`,
  );

  return NextResponse.json({
    orgs: orgIds.length,
    patched,
    created,
    failed,
    errors: errors.slice(0, 50),
  });
}

/**
 * Weekly: safety-net prune of orphaned ORG-level Google Calendar events across
 * every org with an active org-level connection.
 *
 * Normal single-booking deletes already clean their own event at the source
 * (see bookings/actions.ts). This sweeps the strays that slip past that path —
 * events left behind by a direct DB delete, a bulk operation, or a failed
 * delete push. Non-destructive to valid events (see pruneOrgCalendarOrphans).
 *
 * SHARED-CALENDAR SAFETY: each org is pruned with skipWhenNoValid=true, so an
 * org with zero booking-linked events is skipped rather than risk deleting a
 * co-tenant's live events off a shared Google account. (Use the manual
 * /api/admin/gcal-prune-orphans tool to clean a deliberately wound-down org.)
 *
 * Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`; a manual hit
 * can pass `?secret=<CRON_SECRET>`. Pass ?org_id=<UUID> to prune one org,
 * ?dry_run=1 to report without deleting.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pruneOrgCalendarOrphans } from "@/lib/google-calendar";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.length < 16) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  const url = new URL(request.url);
  const secretParam = url.searchParams.get("secret");
  const authHeader = request.headers.get("authorization");
  if (secretParam !== cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const singleOrg = url.searchParams.get("org_id");
  const dryRun = url.searchParams.get("dry_run") === "1";

  // Which orgs: one on demand, or every org with an active org-level connection.
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

  let managed = 0;
  let orphans = 0;
  let deleted = 0;
  let skipped = 0;
  const errors: Array<{ org_id: string; reason: string }> = [];
  const perOrg: Array<Record<string, unknown>> = [];

  for (const orgId of orgIds) {
    try {
      const r = await pruneOrgCalendarOrphans(orgId, {
        dryRun,
        cap: 300,
        skipWhenNoValid: true,
      });
      if (r.skipped) {
        skipped += 1;
        continue;
      }
      managed += r.managed;
      orphans += r.orphans;
      deleted += r.deleted;
      if (r.orphans > 0 || r.errors.length > 0) {
        perOrg.push({
          org_id: orgId,
          orphans: r.orphans,
          deleted: r.deleted,
          remaining: r.remaining,
        });
      }
      for (const e of r.errors) errors.push({ org_id: orgId, reason: e });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      errors.push({ org_id: orgId, reason });
      console.error(`[cron/gcal-prune] failed for org ${orgId}:`, reason);
    }
  }

  console.log(
    `[cron/gcal-prune] orgs=${orgIds.length} skipped=${skipped} managed=${managed} orphans=${orphans} deleted=${deleted} dry_run=${dryRun}`,
  );

  return NextResponse.json({
    ok: errors.length === 0,
    dry_run: dryRun,
    orgs: orgIds.length,
    skipped_no_bookings: skipped,
    managed_events: managed,
    orphans_found: orphans,
    deleted,
    per_org: perOrg.slice(0, 50),
    errors: errors.slice(0, 50),
  });
}

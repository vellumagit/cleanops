/**
 * Nightly: self-healing reconciler for per-member Google Calendar sync.
 *
 * The booking actions (create / update / assignee change / cancel) all
 * call syncMemberCalendarEvents fire-and-forget with .catch(() => {})
 * — a defensible choice (don't block the user save on a Google API blip)
 * but it means transient failures silently drop events from cleaners'
 * personal calendars. Owners only find out when an employee notices.
 *
 * This cron walks every active member-level Google Calendar connection
 * in every org and calls bulkSyncMemberBookings(membershipId). That
 * function creates events for upcoming bookings that DON'T already have
 * a booking_member_calendar_events row, so it's idempotent — re-running
 * it is cheap and only writes when something's actually missing.
 *
 * Protected by CRON_SECRET via requireCronAuth.
 *
 * Schedule: configure in vercel.json (recommended: nightly at 04:30 UTC
 * — after the housekeeping crons, before clients wake up).
 *
 * Output:
 *   {
 *     orgs_scanned, connections_scanned, synced, failed,
 *     errors: [{ org_id, membership_id, reason }]
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bulkSyncMemberBookings } from "@/lib/google-calendar";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — fits Vercel Pro plans

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const admin = createSupabaseAdminClient();

  // Walk every ACTIVE member-level GCal connection across every org.
  // Hard safety cap (1000 connections) so the cron can't run wild on a
  // catastrophic mis-config — adjust upward if real workload requires.
  const { data: connections, error: connErr } = (await admin
    .from("integration_connections" as never)
    .select("membership_id, organization_id")
    .eq("provider" as never, "google_calendar")
    .eq("status" as never, "active")
    .not("membership_id" as never, "is" as never, null as never)
    .limit(1000)) as unknown as {
    data: Array<{ membership_id: string; organization_id: string }> | null;
    error: { message: string } | null;
  };

  if (connErr) {
    console.error(
      "[cron/member-calendar-reconcile] failed to list connections:",
      connErr.message,
    );
    return NextResponse.json(
      { error: `Failed to list connections: ${connErr.message}` },
      { status: 500 },
    );
  }

  if (!connections || connections.length === 0) {
    return NextResponse.json({
      orgs_scanned: 0,
      connections_scanned: 0,
      synced: 0,
      failed: 0,
      errors: [],
    });
  }

  const orgs = new Set(connections.map((c) => c.organization_id));
  let synced = 0;
  let failed = 0;
  const errors: Array<{
    org_id: string;
    membership_id: string;
    reason: string;
  }> = [];

  // Sequential one-at-a-time so token-refresh writes don't race and we
  // don't hit Google's per-token quota hard. Each bulkSyncMemberBookings
  // call internally batches the per-booking event creation at 10 events
  // per Promise.allSettled.
  for (const c of connections) {
    try {
      await bulkSyncMemberBookings(c.membership_id);
      synced++;
    } catch (err) {
      failed++;
      const reason =
        err instanceof Error ? err.message : "Unknown sync error";
      errors.push({
        org_id: c.organization_id,
        membership_id: c.membership_id,
        reason,
      });
      console.error(
        `[cron/member-calendar-reconcile] sync failed for membership ${c.membership_id}:`,
        reason,
      );
    }
  }

  console.log(
    `[cron/member-calendar-reconcile] orgs=${orgs.size} connections=${connections.length} synced=${synced} failed=${failed}`,
  );

  return NextResponse.json({
    orgs_scanned: orgs.size,
    connections_scanned: connections.length,
    synced,
    failed,
    errors: errors.slice(0, 50), // cap response size
  });
}

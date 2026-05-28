/**
 * ONE-SHOT ADMIN TOOL — Force re-sync every member-level Google Calendar
 * connection in an org.
 *
 * Use when employees report their personal calendar isn't getting new
 * bookings (token expired, intermittent failure, data fix landed after
 * their original connect). The admin can re-fan everything out without
 * each employee having to tap "Re-sync upcoming jobs" themselves.
 *
 * For each ACTIVE member-level integration_connections row in the org:
 *   1. Calls bulkSyncMemberBookings(membershipId)
 *   2. That function walks every assigned upcoming booking and
 *      creates / updates the per-segment event on the member's calendar.
 *   3. Token refresh happens automatically inside getMemberConnection.
 *
 * Auth: pass CRON_SECRET as the `secret` query param or as
 *       `Authorization: Bearer <CRON_SECRET>` header.
 *
 * Usage:
 *   GET /api/admin/gcal-force-resync-members?org_id=<UUID>&secret=<CRON_SECRET>
 *
 * Response:
 *   {
 *     ok, member_count, synced, failed,
 *     details: [{ membership_id, member_name, email, ok, error? }]
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bulkSyncMemberBookings } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
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
  const authorized =
    secretParam === cronSecret || authHeader === `Bearer ${cronSecret}`;

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Org ID ──────────────────────────────────────────────────────────────────
  const orgId = url.searchParams.get("org_id");
  if (!orgId) {
    return NextResponse.json({ error: "Missing org_id" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // ── Find every member-level connection in the org ──────────────────────────
  // Two-step lookup because integration_connections has multiple FK paths
  // to memberships (membership_id, organization_id → memberships), which
  // PostgREST's embed syntax can't disambiguate without naming the
  // constraint. Doing two flat queries is simpler than wrestling
  // constraint names through `as never` casts.
  //
  // Step A: every active member-level GCal connection.
  const { data: connRows, error: connErr } = (await admin
    .from("integration_connections" as never)
    .select(
      "membership_id, external_account_id, organization_id",
    )
    .eq("provider" as never, "google_calendar")
    .eq("status" as never, "active")
    .eq("organization_id" as never, orgId as never)
    .not("membership_id" as never, "is" as never, null as never)) as unknown as {
    data: Array<{
      membership_id: string;
      external_account_id: string | null;
      organization_id: string;
    }> | null;
    error: { message: string } | null;
  };

  if (connErr) {
    return NextResponse.json(
      { error: `Failed to list member connections: ${connErr.message}` },
      { status: 500 },
    );
  }

  if (!connRows || connRows.length === 0) {
    return NextResponse.json({
      ok: true,
      member_count: 0,
      synced: 0,
      failed: 0,
      details: [],
      hint: "No active member-level Google Calendar connections in this org.",
    });
  }

  // Step B: friendly name + email per membership_id, in one batched fetch.
  const memberIds = connRows.map((r) => r.membership_id);
  const { data: memberRows } = (await admin
    .from("memberships")
    .select(
      "id, display_name, profile:profiles ( full_name, email )",
    )
    .in("id", memberIds)) as unknown as {
    data: Array<{
      id: string;
      display_name: string | null;
      profile: {
        full_name: string | null;
        email: string | null;
      } | null;
    }> | null;
  };
  const memberMap = new Map(
    (memberRows ?? []).map((m) => [m.id, m]),
  );

  const rows = connRows.map((r) => ({
    membership_id: r.membership_id,
    external_account_id: r.external_account_id,
    member_name:
      memberMap.get(r.membership_id)?.profile?.full_name ??
      memberMap.get(r.membership_id)?.display_name ??
      "Unknown",
    email:
      memberMap.get(r.membership_id)?.profile?.email ??
      r.external_account_id ??
      null,
  }));

  // Cap at 40 to stay inside Vercel's function timeout for organizations
  // with many connected employees. Run again to continue.
  const BATCH_CAP = 40;
  const toProcess = rows.slice(0, BATCH_CAP);

  // ── Re-sync each member ────────────────────────────────────────────────────
  // Sequential one-at-a-time so token-refresh writes don't race and Google's
  // per-token quota isn't burst-hammered.
  type Detail = {
    membership_id: string;
    member_name: string;
    email: string | null;
    ok: boolean;
    error?: string;
  };
  const details: Detail[] = [];
  let synced = 0;
  let failed = 0;

  for (const r of toProcess) {
    try {
      await bulkSyncMemberBookings(r.membership_id);
      synced++;
      details.push({
        membership_id: r.membership_id,
        member_name: r.member_name,
        email: r.email,
        ok: true,
      });
    } catch (err) {
      failed++;
      const reason =
        err instanceof Error ? err.message : "Unknown sync error";
      details.push({
        membership_id: r.membership_id,
        member_name: r.member_name,
        email: r.email,
        ok: false,
        error: reason,
      });
    }
  }

  return NextResponse.json({
    ok: failed === 0,
    member_count: rows.length,
    synced,
    failed,
    details,
    remaining: rows.length - toProcess.length,
    hint:
      rows.length > BATCH_CAP
        ? `Processed first ${BATCH_CAP} of ${rows.length} — run again to continue.`
        : undefined,
  });
}

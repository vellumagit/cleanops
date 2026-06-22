/**
 * ONE-SHOT ADMIN TOOL — GCal backfill (create-only, optionally scoped)
 *
 * Creates Google Calendar events for upcoming bookings that don't have one
 * yet (google_calendar_event_id IS NULL). Unlike gcal-force-resync this does
 * NOT delete anything — it's safe to run when bookings simply never got an
 * event (e.g. the fire-and-forget serverless bug). Idempotent: re-running
 * only touches bookings that are still missing an event, so a timeout just
 * means "run it again to finish".
 *
 * Auth: pass CRON_SECRET as the `secret` query param or as
 *       `Authorization: Bearer <CRON_SECRET>` header.
 *
 * Usage:
 *   /api/admin/gcal-backfill?org_id=<UUID>&secret=<CRON_SECRET>
 *   ...&client_ids=<uuid,uuid>   optional — scope to specific clients
 *   ...&dry_run=1                optional — count only, no writes
 *
 * Response: { ok, org_id, dry_run, found, synced_attempted, remaining_null }
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bulkSyncUpcomingBookings } from "@/lib/google-calendar";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
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

  // ── Params ────────────────────────────────────────────────────────────────
  const orgId = url.searchParams.get("org_id");
  if (!orgId) {
    return NextResponse.json({ error: "Missing org_id" }, { status: 400 });
  }
  const clientIds = (url.searchParams.get("client_ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const dryRun = url.searchParams.get("dry_run") === "1";

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  // How many upcoming, active bookings are missing an event (optionally
  // scoped to the given clients)?
  let countQ = admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .gte("scheduled_at", now)
    .is("google_calendar_event_id", null)
    .neq("status", "cancelled");
  if (clientIds.length > 0) countQ = countQ.in("client_id", clientIds);
  const { count: found } = (await countQ) as unknown as {
    count: number | null;
  };

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      org_id: orgId,
      client_ids: clientIds,
      found: found ?? 0,
    });
  }

  // Create the events (create-only; stamps google_calendar_event_id).
  const attempted = await bulkSyncUpcomingBookings(
    orgId,
    clientIds.length > 0 ? { clientIds } : undefined,
  );

  // Re-count what's still missing an event — 0 means a clean sweep.
  let remQ = admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .gte("scheduled_at", now)
    .is("google_calendar_event_id", null)
    .neq("status", "cancelled");
  if (clientIds.length > 0) remQ = remQ.in("client_id", clientIds);
  const { count: remaining } = (await remQ) as unknown as {
    count: number | null;
  };

  return NextResponse.json({
    ok: true,
    dry_run: false,
    org_id: orgId,
    client_ids: clientIds,
    found: found ?? 0,
    synced_attempted: attempted,
    remaining_null: remaining ?? 0,
  });
}

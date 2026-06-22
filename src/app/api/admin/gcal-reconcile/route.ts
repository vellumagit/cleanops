/**
 * ONE-SHOT ADMIN TOOL — GCal reconcile (clear stale event ids)
 *
 * Nulls google_calendar_event_id on any upcoming booking whose stored event
 * id is NOT a live event on the calendar (a "stale" id — the event was
 * deleted but the booking still points at it). After this, the backfill
 * (gcal-backfill) re-creates a fresh event for them, since it only syncs
 * bookings with a null id.
 *
 * Auth: pass CRON_SECRET as the `secret` query param or as
 *       `Authorization: Bearer <CRON_SECRET>` header.
 *
 * Usage:
 *   /api/admin/gcal-reconcile?org_id=<UUID>&secret=<CRON_SECRET>
 *   ...&dry_run=1     optional — report counts, change nothing
 *
 * Response: { ok, org_id, dry_run, checked, live_events, stale_found, nulled }
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listManagedEventIds } from "@/lib/google-calendar";

export const maxDuration = 60;

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
  const orgId = url.searchParams.get("org_id");
  if (!orgId) {
    return NextResponse.json({ error: "Missing org_id" }, { status: 400 });
  }
  const dryRun = url.searchParams.get("dry_run") === "1";

  const admin = createSupabaseAdminClient();
  // Start of today (UTC) — reconcile today's in-progress bookings too.
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();
  // 3-year horizon (well beyond how far series generate) so far-future
  // bookings' events are in the list and never mis-flagged as stale.
  const timeMax = new Date(
    Date.now() + 1095 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Live event ids currently on the calendar.
  const liveIds = new Set(
    await listManagedEventIds(orgId, sinceIso, timeMax),
  );

  // Bookings from today onward that claim an event id.
  const stale: string[] = [];
  let checked = 0;
  for (let from = 0; ; from += 1000) {
    const { data } = (await admin
      .from("bookings")
      .select("id, google_calendar_event_id")
      .eq("organization_id", orgId)
      .gte("scheduled_at", sinceIso)
      .not("google_calendar_event_id", "is", null)
      .range(from, from + 999)) as unknown as {
      data: Array<{ id: string; google_calendar_event_id: string }> | null;
    };
    const rows = data ?? [];
    checked += rows.length;
    for (const r of rows) {
      if (!liveIds.has(r.google_calendar_event_id)) stale.push(r.id);
    }
    if (rows.length < 1000) break;
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      org_id: orgId,
      checked,
      live_events: liveIds.size,
      stale_found: stale.length,
    });
  }

  // Null the stale ids in chunks so the backfill will re-create them.
  let nulled = 0;
  for (let i = 0; i < stale.length; i += 200) {
    const chunk = stale.slice(i, i + 200);
    const { error } = await admin
      .from("bookings")
      .update({ google_calendar_event_id: null } as never)
      .in("id", chunk);
    if (!error) nulled += chunk.length;
  }

  return NextResponse.json({
    ok: true,
    dry_run: false,
    org_id: orgId,
    checked,
    live_events: liveIds.size,
    stale_found: stale.length,
    nulled,
  });
}

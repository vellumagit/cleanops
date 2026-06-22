/**
 * ONE-SHOT ADMIN TOOL — GCal orphan prune (precise, non-destructive to valid events)
 *
 * Deletes Sollos-managed Google Calendar events whose id matches NO current
 * booking (google_calendar_event_id). These are "ghosts" left behind when a
 * booking was deleted (e.g. a series reschedule that removed the old future
 * occurrences without cleaning up their events). Valid events — those still
 * referenced by a booking — are never touched.
 *
 * Unlike gcal-force-resync this does NOT delete-everything-and-recreate, so
 * it's safe for large orgs. Idempotent and resumable: re-run until
 * remaining is 0.
 *
 * Auth: pass CRON_SECRET as the `secret` query param or as
 *       `Authorization: Bearer <CRON_SECRET>` header.
 *
 * Usage:
 *   /api/admin/gcal-prune-orphans?org_id=<UUID>&secret=<CRON_SECRET>
 *   ...&dry_run=1     optional — report counts, delete nothing
 *   ...&cap=100       optional — max deletions this call (default 100)
 *
 * Response: { ok, org_id, dry_run, managed_events, valid_events, orphans_found, deleted }
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  listManagedEventIds,
  deleteCalendarEvent,
} from "@/lib/google-calendar";

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
  const cap = Math.min(
    Math.max(Number(url.searchParams.get("cap") ?? "100") || 100, 1),
    300,
  );

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const timeMax = new Date(
    Date.now() + 400 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Valid event ids = every event id still referenced by a future booking.
  // Paginated so we never miss one (deleting a referenced event would be a
  // real data-loss bug, so this set must be complete).
  const validIds = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = (await admin
      .from("bookings")
      .select("google_calendar_event_id")
      .eq("organization_id", orgId)
      .gte("scheduled_at", now)
      .not("google_calendar_event_id", "is", null)
      .range(from, from + 999)) as unknown as {
      data: Array<{ google_calendar_event_id: string | null }> | null;
    };
    const rows = data ?? [];
    for (const r of rows) {
      if (r.google_calendar_event_id) validIds.add(r.google_calendar_event_id);
    }
    if (rows.length < 1000) break;
  }

  // All Sollos-managed events on the calendar in the window.
  const managed = await listManagedEventIds(orgId, now, timeMax);
  const orphans = managed.filter((id) => !validIds.has(id));

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      org_id: orgId,
      managed_events: managed.length,
      valid_events: validIds.size,
      orphans_found: orphans.length,
    });
  }

  // Delete orphans, throttled to stay well under Google's rate limit.
  let deleted = 0;
  const errors: string[] = [];
  for (const id of orphans.slice(0, cap)) {
    try {
      await deleteCalendarEvent(orgId, id);
      deleted++;
    } catch (err) {
      errors.push(`${id}: ${String(err)}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  return NextResponse.json({
    ok: errors.length === 0,
    dry_run: false,
    org_id: orgId,
    managed_events: managed.length,
    valid_events: validIds.size,
    orphans_found: orphans.length,
    deleted,
    remaining: orphans.length - deleted,
    errors: errors.slice(0, 10),
    hint:
      orphans.length > cap
        ? `Deleted ${deleted} of ${orphans.length} — run again to continue.`
        : undefined,
  });
}

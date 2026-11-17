/**
 * ONE-SHOT ADMIN TOOL — GCal force resync
 *
 * Wipes every Sollos-managed event of THIS company from its company Google
 * Calendar (including orphans that have no booking in the database), clears
 * the event ids on its upcoming bookings, then pushes the upcoming bookings
 * again.
 *
 * Use when a customer has doubled/tripled events from a historic bug.
 *
 * It works in passes of 40 deletions. A pass that leaves events behind does
 * NOT push anything: it says "run again". Only the pass that finishes the
 * wipe pushes the jobs back. (It used to push every job after every pass, so
 * with more than 40 events each run made new copies and it never finished.)
 *
 * Three things it must never do, all of which it did until 2026-11-18:
 *   - take a cleaner's own calendar for the company's. Only the company
 *     connection (membership_id IS NULL) is used; with none, it answers 404.
 *   - give up because a cleaner has connected their own calendar as well.
 *   - delete another company's live events from a calendar two companies
 *     share. An event whose booking belongs to another company stays.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` header.
 *
 * Usage:
 *   GET /api/admin/gcal-force-resync?org_id=<UUID>
 *
 * Response: { ok, sollos_events_found, deleted_from_gcal, nulled_booking_ids,
 *             synced, errors, remaining, hint }
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  bulkSyncUpcomingBookings,
  deleteCalendarEvent,
  listOrgManagedEvents,
} from "@/lib/google-calendar";
import { requireCronAuth } from "@/lib/cron-auth";

export const maxDuration = 60;

/** Deletions per call. 40 x 150ms stays well inside the time limit. */
const PASS_CAP = 40;

export async function GET(request: NextRequest) {
  // ── Auth (header-only; query-param secret removed to keep it out of logs) ──
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const orgId = url.searchParams.get("org_id");
  if (!orgId) {
    return NextResponse.json({ error: "Missing org_id" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // ── The COMPANY connection, never a cleaner's own ─────────────────────────
  const { data: conn } = (await admin
    .from("integration_connections" as never)
    .select("id, access_token_ciphertext")
    .eq("organization_id" as never, orgId)
    .eq("provider" as never, "google_calendar")
    .eq("status" as never, "active")
    .is("membership_id" as never, null)
    .maybeSingle()) as unknown as {
    data: { id: string; access_token_ciphertext: string | null } | null;
  };
  if (!conn || !conn.access_token_ciphertext) {
    return NextResponse.json(
      { error: "No active Google Calendar connection for this org" },
      { status: 404 },
    );
  }

  // ── Every Sollos event on the calendar, a year out ────────────────────────
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  let managed: Array<{ id: string; bookingId: string | null }>;
  try {
    managed = await listOrgManagedEvents(orgId, timeMin, timeMax);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to list GCal events: ${String(err)}` },
      { status: 500 },
    );
  }

  // ── Leave another company's events alone ──────────────────────────────────
  // Each event names its booking. One whose booking belongs to another
  // company is theirs (a calendar two companies share), and stays.
  const named = [...new Set(managed.map((e) => e.bookingId).filter((b): b is string => Boolean(b)))];
  const elsewhere = new Set<string>();
  for (let i = 0; i < named.length; i += 150) {
    const { data: rows, error } = (await admin
      .from("bookings")
      .select("id")
      .in("id", named.slice(i, i + 150))
      .neq("organization_id", orgId)) as unknown as {
      data: Array<{ id: string }> | null;
      error: { message: string } | null;
    };
    // "Couldn't check" must never read as "nobody else's".
    if (error) {
      return NextResponse.json(
        { error: `Checking event owners failed: ${error.message}` },
        { status: 500 },
      );
    }
    for (const r of rows ?? []) elsewhere.add(r.id);
  }
  const sollosEvents = managed.filter((e) => !e.bookingId || !elsewhere.has(e.bookingId));

  // ── Delete this pass's share ──────────────────────────────────────────────
  // Sequential with 150ms gaps = ~6 req/s, safely under Google's quota.
  let deleted_from_gcal = 0;
  const errors: string[] = [];
  const removedIds: string[] = [];
  for (const e of sollosEvents.slice(0, PASS_CAP)) {
    const ok = await deleteCalendarEvent(orgId, e.id).catch(() => false);
    if (ok) {
      deleted_from_gcal++;
      removedIds.push(e.id);
    } else {
      errors.push(`Failed to delete GCal event ${e.id}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const remaining = sollosEvents.length - deleted_from_gcal;

  // The bookings whose events just went no longer have one.
  let nulled_booking_ids = 0;
  if (removedIds.length > 0) {
    const { data: cleared } = (await admin
      .from("bookings")
      .update({ google_calendar_event_id: null } as never)
      .eq("organization_id" as never, orgId)
      .in("google_calendar_event_id" as never, removedIds as never)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    nulled_booking_ids += cleared?.length ?? 0;
  }

  // ── Push the jobs back only once the wipe is complete ─────────────────────
  // Pushing while events remain (failed deletes, or more than one pass's
  // worth) would put new events on top of the ones still there.
  let synced = false;
  if (errors.length === 0 && remaining === 0) {
    const { data: cleared } = (await admin
      .from("bookings")
      .update({ google_calendar_event_id: null } as never)
      .eq("organization_id" as never, orgId)
      .gte("scheduled_at" as never, timeMin)
      .not("google_calendar_event_id" as never, "is" as never, null as never)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    nulled_booking_ids += cleared?.length ?? 0;
    await bulkSyncUpcomingBookings(orgId).catch((err) => {
      errors.push(`bulkSync error: ${String(err)}`);
    });
    synced = errors.length === 0;
  }

  return NextResponse.json({
    ok: errors.length === 0,
    sollos_events_found: sollosEvents.length,
    deleted_from_gcal,
    nulled_booking_ids,
    synced,
    errors,
    remaining,
    hint:
      errors.length > 0
        ? "Some deletes failed. Wait 60s and run again. Nothing was pushed, to avoid new duplicates."
        : remaining > 0
          ? `Removed ${deleted_from_gcal} of ${sollosEvents.length}. Run again to continue; the jobs are pushed back on the pass that finishes.`
          : undefined,
  });
}

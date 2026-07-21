/**
 * ADMIN TOOL — GCal MEMBER-calendar orphan prune.
 *
 * The org-level prune (gcal-prune-orphans) only cleans the org calendar
 * (bookings.google_calendar_event_id). MEMBER calendars are tracked separately
 * in booking_member_calendar_events, whose booking_id has ON DELETE CASCADE —
 * so deleting a booking drops the mapping row but NOT the Google event, which
 * strands on the member's personal calendar with no DB record. The normal
 * reconcile works off the mapping table and therefore can never see these.
 *
 * This tool finds them the reliable way: list every "Managed by Sollos" event
 * on each member's calendar (the marker Sollos writes into every event's
 * description), and delete the ones NOT referenced by a live mapping row.
 * Because the mapping only holds rows for live bookings (cascade), any managed
 * event missing from it is an orphan. Personal events (no marker) are never
 * touched.
 *
 * Auth: CRON_SECRET as `secret` query param or `Authorization: Bearer <secret>`.
 *
 * Usage:
 *   /api/admin/gcal-prune-member-orphans?org_id=<UUID>&secret=<CRON_SECRET>
 *   ...&dry_run=1              report only, delete nothing (do this first!)
 *   ...&membership_id=<UUID>   optional — target one member (e.g. Olga)
 *   ...&cap=100                optional — max deletions this call (default 100)
 *   ...&since_days=365         optional — also look this many days into the past
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  listMemberManagedEventIds,
  deleteMemberCalendarEventById,
} from "@/lib/google-calendar";
import { requireCronAuth } from "@/lib/cron-auth";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Auth: header-only (query-param secret removed to keep it out of logs).
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const orgId = url.searchParams.get("org_id");
  if (!orgId) {
    return NextResponse.json({ error: "Missing org_id" }, { status: 400 });
  }
  const onlyMembership = url.searchParams.get("membership_id");
  const dryRun = url.searchParams.get("dry_run") === "1";
  const cap = Math.min(
    Math.max(Number(url.searchParams.get("cap") ?? "100") || 100, 1),
    300,
  );
  const sinceDays = Math.max(
    Number(url.searchParams.get("since_days") ?? "0") || 0,
    0,
  );

  const admin = createSupabaseAdminClient();
  const timeMin = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const timeMax = new Date(Date.now() + 1095 * 86400000).toISOString();

  // Active member gcal connections for this org (optionally one member).
  let connQuery = admin
    .from("integration_connections")
    .select("membership_id")
    .eq("organization_id", orgId)
    .eq("provider", "google_calendar")
    .eq("status", "active")
    .not("membership_id", "is", null);
  if (onlyMembership) connQuery = connQuery.eq("membership_id", onlyMembership);
  const { data: conns } = (await connQuery) as unknown as {
    data: Array<{ membership_id: string }> | null;
  };

  const perMember: Array<Record<string, unknown>> = [];
  let totalOrphans = 0;
  let totalDeleted = 0;
  const errors: string[] = [];

  for (const c of conns ?? []) {
    const membershipId = c.membership_id;

    // Valid ids: the mapping only holds rows for LIVE bookings (booking_id has
    // ON DELETE CASCADE), so every mapped event id is valid by definition.
    const { data: mappings } = (await admin
      .from("booking_member_calendar_events")
      .select("google_calendar_event_id")
      .eq("membership_id", membershipId)) as unknown as {
      data: Array<{ google_calendar_event_id: string }> | null;
    };
    const validIds = new Set(
      (mappings ?? []).map((m) => m.google_calendar_event_id),
    );

    let managed: string[];
    try {
      managed = await listMemberManagedEventIds(membershipId, timeMin, timeMax);
    } catch (err) {
      errors.push(`member ${membershipId}: list failed — ${String(err)}`);
      continue;
    }
    const orphans = managed.filter((id) => !validIds.has(id));
    totalOrphans += orphans.length;

    let deleted = 0;
    if (!dryRun) {
      for (const id of orphans) {
        if (totalDeleted >= cap) break;
        const ok = await deleteMemberCalendarEventById(membershipId, id).catch(
          () => false,
        );
        if (ok) {
          deleted++;
          totalDeleted++;
        } else {
          errors.push(`member ${membershipId} event ${id}: delete failed`);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    perMember.push({
      membership_id: membershipId,
      managed_events: managed.length,
      valid_events: validIds.size,
      orphans_found: orphans.length,
      deleted,
    });
  }

  return NextResponse.json({
    ok: errors.length === 0,
    dry_run: dryRun,
    org_id: orgId,
    members_scanned: (conns ?? []).length,
    total_orphans_found: totalOrphans,
    total_deleted: totalDeleted,
    per_member: perMember,
    errors: errors.slice(0, 10),
    hint:
      totalOrphans > totalDeleted && !dryRun
        ? `Deleted ${totalDeleted} of ${totalOrphans} (cap ${cap}) — run again to continue.`
        : undefined,
  });
}

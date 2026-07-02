import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listMemberManagedEvents } from "@/lib/google-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// TEMPORARY read-only audit — inspects cleaners' personal Google Calendars for
// duplicate / orphaned Sollos events. NO writes, NO deletes. Guarded by a
// one-off secret. DELETE this file after the audit.
const SECRET = "cal-audit-6d1f8b3a2e9c";
const DEFAULT_ORG = "4cf4c402-5889-43c9-91f3-7186f66ee08b"; // Svit Company Inc

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  if (url.searchParams.get("key") !== SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const orgId = url.searchParams.get("org") ?? DEFAULT_ORG;
  const nameFilter = (url.searchParams.get("name") ?? "").toLowerCase().trim();
  const daysAhead = Math.min(Number(url.searchParams.get("days")) || 120, 400);

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(
    now.getTime() + daysAhead * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Active member-level Google Calendar connections for this org.
  const { data: conns } = (await admin
    .from("integration_connections" as never)
    .select("membership_id")
    .eq("provider" as never, "google_calendar" as never)
    .eq("status" as never, "active" as never)
    .eq("organization_id" as never, orgId as never)
    .not("membership_id" as never, "is" as never, null as never)) as unknown as {
    data: Array<{ membership_id: string }> | null;
  };

  const membershipIds = [...new Set((conns ?? []).map((c) => c.membership_id))];
  if (membershipIds.length === 0) {
    return NextResponse.json({
      org: orgId,
      note: "No active member-level Google Calendar connections in this org.",
    });
  }

  // Names for reporting.
  const { data: members } = (await admin
    .from("memberships")
    .select("id, display_name, profile:profiles ( full_name )")
    .in("id", membershipIds)) as unknown as {
    data: Array<{
      id: string;
      display_name: string | null;
      profile: { full_name: string | null } | null;
    }> | null;
  };
  const nameById = new Map(
    (members ?? []).map((m) => [
      m.id,
      m.display_name?.trim() || m.profile?.full_name?.trim() || m.id,
    ]),
  );

  const report: Array<Record<string, unknown>> = [];

  for (const mid of membershipIds) {
    const memberName = nameById.get(mid) ?? mid;
    if (nameFilter && !memberName.toLowerCase().includes(nameFilter)) continue;

    const events = await listMemberManagedEvents(mid, timeMin, timeMax);

    // Resolve every referenced booking + our mapping rows in one pass each.
    const bookingIds = [
      ...new Set(events.map((e) => e.bookingId).filter(Boolean) as string[]),
    ];

    const bookingById = new Map<string, { scheduled_at: string }>();
    if (bookingIds.length > 0) {
      const { data: bks } = (await admin
        .from("bookings")
        .select("id, scheduled_at")
        .in("id", bookingIds)) as unknown as {
        data: Array<{ id: string; scheduled_at: string }> | null;
      };
      for (const b of bks ?? []) bookingById.set(b.id, { scheduled_at: b.scheduled_at });
    }

    const mappedEventIds = new Set<string>();
    if (bookingIds.length > 0) {
      const { data: maps } = (await admin
        .from("booking_member_calendar_events")
        .select("google_calendar_event_id")
        .eq("membership_id", mid)
        .in("booking_id", bookingIds)) as unknown as {
        data: Array<{ google_calendar_event_id: string }> | null;
      };
      for (const m of maps ?? []) mappedEventIds.add(m.google_calendar_event_id);
    }

    // Classify.
    const byBooking = new Map<string, number>();
    for (const e of events) {
      const k = e.bookingId ?? "(none)";
      byBooking.set(k, (byBooking.get(k) ?? 0) + 1);
    }

    const orphansDeleted: Array<Record<string, unknown>> = [];
    const orphansNoMapping: Array<Record<string, unknown>> = [];
    let tracked = 0;
    for (const e of events) {
      const bk = e.bookingId ? bookingById.get(e.bookingId) : undefined;
      const isMapped = mappedEventIds.has(e.id);
      if (!e.bookingId || !bk) {
        orphansDeleted.push({ eventId: e.id, start: e.start, summary: e.summary, bookingId: e.bookingId });
      } else if (!isMapped) {
        orphansNoMapping.push({
          eventId: e.id,
          eventStart: e.start,
          bookingScheduledAt: bk.scheduled_at,
          timeMismatch: e.start.slice(0, 16) !== new Date(bk.scheduled_at).toISOString().slice(0, 16),
          summary: e.summary,
          bookingId: e.bookingId,
        });
      } else {
        tracked += 1;
      }
    }
    const duplicateBookings = [...byBooking.entries()]
      .filter(([k, n]) => k !== "(none)" && n > 1)
      .map(([bookingId, count]) => ({ bookingId, count }));

    report.push({
      member: memberName,
      membershipId: mid,
      totalSollosEvents: events.length,
      tracked,
      orphanedCount: orphansDeleted.length + orphansNoMapping.length,
      duplicateBookingsCount: duplicateBookings.length,
      orphans_bookingDeleted: orphansDeleted.slice(0, 20),
      orphans_noMapping: orphansNoMapping.slice(0, 20),
      duplicateBookings: duplicateBookings.slice(0, 20),
    });
  }

  const totals = report.reduce(
    (acc: { events: number; orphans: number; dupes: number }, r) => {
      acc.events += (r.totalSollosEvents as number) ?? 0;
      acc.orphans += (r.orphanedCount as number) ?? 0;
      acc.dupes += (r.duplicateBookingsCount as number) ?? 0;
      return acc;
    },
    { events: 0, orphans: 0, dupes: 0 },
  );

  return NextResponse.json({
    org: orgId,
    window: { timeMin, timeMax },
    membersAudited: report.length,
    totals,
    report,
  });
}

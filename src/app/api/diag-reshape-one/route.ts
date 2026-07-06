import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveTeamDivision } from "@/lib/crew-hours";
import {
  updateCalendarEvent,
  syncMemberCalendarEvents,
} from "@/lib/google-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// TEMPORARY: reshape a specific client's recent bookings' calendar events to the
// divided duration (incl. PAST dates, which the normal backfill skips) so the
// owner can see the feature working on a real event. Guarded. DELETE after use.
const SECRET = "reshape-one-2f9a";
const DEFAULT_ORG = "4cf4c402-5889-43c9-91f3-7186f66ee08b"; // Svit Company Inc

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  if (url.searchParams.get("key") !== SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const orgId = url.searchParams.get("org") ?? DEFAULT_ORG;
  const q = (url.searchParams.get("q") ?? "").trim();
  const days = Math.min(Number(url.searchParams.get("days")) || 3, 30);
  if (!q) return NextResponse.json({ error: "missing ?q=<client name>" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const until = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

  const { data: bookings } = (await admin
    .from("bookings")
    .select(
      "id, google_calendar_event_id, scheduled_at, duration_minutes, service_type, address, notes, assigned_to, client:clients!inner ( name )",
    )
    .eq("organization_id", orgId)
    .neq("status", "cancelled")
    .gte("scheduled_at", since)
    .lte("scheduled_at", until)
    .ilike("clients.name", `%${q}%`)
    .order("scheduled_at", { ascending: false })
    .limit(20)) as unknown as {
    data: Array<{
      id: string;
      google_calendar_event_id: string | null;
      scheduled_at: string;
      duration_minutes: number;
      service_type: string;
      address: string | null;
      notes: string | null;
      assigned_to: string | null;
      client: { name: string | null } | null;
    }> | null;
  };

  const report: Array<Record<string, unknown>> = [];
  for (const b of bookings ?? []) {
    const { data: crew } = (await admin
      .from("booking_assignees")
      .select("membership_id, split_duration_minutes")
      .eq("booking_id", b.id)) as unknown as {
      data: Array<{ membership_id: string; split_duration_minutes: number | null }> | null;
    };
    const rows = crew ?? [];
    const isSplit = rows.filter((r) => r.split_duration_minutes != null).length >= 2;
    const div = await resolveTeamDivision(b.id, b.duration_minutes);

    let action = "skipped";
    if (!isSplit && div.crewCount >= 2) {
      const clientName = b.client?.name ?? undefined;
      let employeeName: string | undefined;
      if (b.assigned_to) {
        const { data: m } = (await admin
          .from("memberships")
          .select("display_name, profile:profiles ( full_name )")
          .eq("id", b.assigned_to)
          .maybeSingle()) as unknown as {
          data: { display_name: string | null; profile: { full_name: string | null } | null } | null;
        };
        employeeName = m?.display_name?.trim() || m?.profile?.full_name?.trim() || undefined;
      }
      if (b.google_calendar_event_id) {
        await updateCalendarEvent(orgId, {
          id: b.id,
          google_calendar_event_id: b.google_calendar_event_id,
          scheduled_at: b.scheduled_at,
          duration_minutes: b.duration_minutes,
          service_type: b.service_type,
          address: b.address,
          notes: b.notes,
          client_name: clientName,
          employee_name: employeeName,
        }).catch(() => {});
      }
      await syncMemberCalendarEvents(b.id, rows.map((r) => r.membership_id), {
        id: b.id,
        scheduled_at: b.scheduled_at,
        duration_minutes: b.duration_minutes,
        service_type: b.service_type,
        address: b.address,
        notes: b.notes,
        client_name: clientName,
      }).catch(() => {});
      action = "reshaped";
    }

    report.push({
      client: b.client?.name,
      start: b.scheduled_at,
      crewCount: div.crewCount,
      divideOn: div.divideOn,
      fullMinutes: b.duration_minutes,
      effectiveMinutes: div.effectiveMinutes,
      hasOrgEvent: Boolean(b.google_calendar_event_id),
      action,
    });
  }

  return NextResponse.json({ org: orgId, q, days, matched: report.length, report });
}

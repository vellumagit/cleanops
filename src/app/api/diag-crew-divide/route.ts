import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveTeamDivision } from "@/lib/crew-hours";
import { resyncCrewDivisionForOrg } from "@/lib/google-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// TEMPORARY: verify the divide-crew-hours calculation for Svit's upcoming team
// bookings, and (with &apply=1) reshape their existing calendar events. Guarded
// by a one-off secret. DELETE this file after use.
const SECRET = "crew-divide-8c3f1a";
const DEFAULT_ORG = "4cf4c402-5889-43c9-91f3-7186f66ee08b"; // Svit Company Inc

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  if (url.searchParams.get("key") !== SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const orgId = url.searchParams.get("org") ?? DEFAULT_ORG;
  const apply = url.searchParams.get("apply") === "1";

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const { data: bookings } = (await admin
    .from("bookings")
    .select("id, scheduled_at, duration_minutes, client:clients ( name )")
    .eq("organization_id", orgId)
    .neq("status", "cancelled")
    .gte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(500)) as unknown as {
    data: Array<{
      id: string;
      scheduled_at: string;
      duration_minutes: number;
      client: { name: string | null } | null;
    }> | null;
  };

  const report: Array<Record<string, unknown>> = [];
  for (const b of bookings ?? []) {
    const div = await resolveTeamDivision(b.id, b.duration_minutes);
    if (div.crewCount < 2) continue; // only team jobs are interesting
    report.push({
      client: b.client?.name ?? "—",
      start: b.scheduled_at,
      crewCount: div.crewCount,
      divideOn: div.divideOn,
      fullMinutes: b.duration_minutes,
      effectiveMinutes: div.effectiveMinutes,
    });
  }

  let resynced = false;
  if (apply) {
    await resyncCrewDivisionForOrg(orgId);
    resynced = true;
  }

  return NextResponse.json({
    org: orgId,
    mode: apply ? "APPLIED (calendars reshaped)" : "DRY-RUN (calc only)",
    resynced,
    teamBookings: report.length,
    dividedNow: report.filter((r) => r.divideOn).length,
    report: report.slice(0, 40),
  });
}

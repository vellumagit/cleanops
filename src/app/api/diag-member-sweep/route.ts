import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sweepMemberCalendarOrphans } from "@/lib/google-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// TEMPORARY one-time cleanup — removes ghost (deleted-booking) Sollos events
// from cleaners' personal calendars. Dry-run by DEFAULT; only deletes when
// &apply=1 is passed. Guarded by a one-off secret. DELETE this file after use.
const SECRET = "cal-sweep-4b7e9a1c6f2d";
const DEFAULT_ORG = "4cf4c402-5889-43c9-91f3-7186f66ee08b"; // Svit Company Inc

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  if (url.searchParams.get("key") !== SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const orgId = url.searchParams.get("org") ?? DEFAULT_ORG;
  const nameFilter = (url.searchParams.get("name") ?? "").toLowerCase().trim();
  const apply = url.searchParams.get("apply") === "1"; // else dry-run
  const daysAhead = Math.min(Number(url.searchParams.get("days")) || 400, 400);

  const admin = createSupabaseAdminClient();

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

  const { data: members } = (await admin
    .from("memberships")
    .select("id, display_name, profile:profiles ( full_name )")
    .in("id", membershipIds.length ? membershipIds : ["_none_"])) as unknown as {
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
  let totalOrphans = 0;
  let totalDeleted = 0;

  for (const mid of membershipIds) {
    const memberName = nameById.get(mid) ?? mid;
    if (nameFilter && !memberName.toLowerCase().includes(nameFilter)) continue;

    const result = await sweepMemberCalendarOrphans(mid, {
      dryRun: !apply,
      daysAhead,
    });
    totalOrphans += result.orphans.length;
    totalDeleted += result.deleted;
    report.push({
      member: memberName,
      membershipId: mid,
      scanned: result.scanned,
      orphansFound: result.orphans.length,
      deleted: result.deleted,
      sampleOrphans: result.orphans.slice(0, 10),
    });
  }

  return NextResponse.json({
    org: orgId,
    mode: apply ? "APPLIED (deleted)" : "DRY-RUN (no deletions)",
    daysAhead,
    membersProcessed: report.length,
    totalOrphansFound: totalOrphans,
    totalDeleted,
    report,
  });
}

/**
 * ONE-SHOT ADMIN TOOL — purge a single named organization, now.
 *
 * The nightly purge-orgs cron is all-or-nothing: it sweeps every org whose
 * 30-day grace has elapsed, so using it to remove one spam workspace also
 * destroys whatever else happens to be queued. On 2026-09-22 that was three
 * unrelated orgs, one of them a real client's. This purges exactly the org
 * you name and nothing else.
 *
 * It runs the SAME purgeOrgData the cron does — the table order, the storage
 * sweep, the Twilio release, the auth-identity erasure — so there is no second
 * implementation to drift.
 *
 * SAFETY: refuses any org that is not already suspended or scheduled for
 * deletion. A typo in org_id then lands on a live workspace and is turned
 * away instead of erasing it. To purge a live org, suspend it first — that is
 * a deliberate second step, which is the point.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`.
 *
 * Usage:
 *   /api/admin/purge-org?org_id=<UUID>&dry_run=1   report what would go
 *   /api/admin/purge-org?org_id=<UUID>             do it (irreversible)
 *
 * Response: { ok, org_id, org_name, dry_run, tables, storage_files_removed,
 *             auth_users_deleted, errors }
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { purgeOrgData } from "@/lib/tenant-data";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Tables worth counting in a dry run — the ones a spam org actually fills. */
const PREVIEW_TABLES = [
  "clients",
  "client_emails",
  "bookings",
  "invoices",
  "estimates",
  "audit_log",
  "memberships",
  "subscriptions",
] as const;

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const orgId = url.searchParams.get("org_id");
  if (!orgId) {
    return NextResponse.json({ error: "Missing org_id" }, { status: 400 });
  }
  const dryRun = url.searchParams.get("dry_run") === "1";
  // A tombstoned org normally means "done". It can also mean a purge stamped
  // deleted_at while its deletes were failing — which hides the org from the
  // cron AND from this route, stranding the rows. force=1 is the way back in.
  const force = url.searchParams.get("force") === "1";

  const admin = createSupabaseAdminClient();
  const { data: org } = (await admin
    .from("organizations")
    .select("id, name, suspended_at, deletion_scheduled_at, deleted_at")
    .eq("id", orgId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      name: string;
      suspended_at: string | null;
      deletion_scheduled_at: string | null;
      deleted_at: string | null;
    } | null;
  };

  if (!org) {
    return NextResponse.json({ error: "No such organization" }, { status: 404 });
  }
  if (org.deleted_at && !force) {
    return NextResponse.json({
      ok: true,
      org_id: orgId,
      org_name: org.name,
      already_purged_at: org.deleted_at,
      note: "Already tombstoned — nothing to do. Add &force=1 to re-run if rows survived.",
    });
  }
  if (!org.suspended_at && !org.deletion_scheduled_at && !org.deleted_at) {
    return NextResponse.json(
      {
        ok: false,
        org_id: orgId,
        org_name: org.name,
        error:
          `"${org.name}" is a live workspace — it is neither suspended nor scheduled for deletion, ` +
          "so this refuses to touch it. If you really mean to erase it, suspend it first.",
      },
      { status: 409 },
    );
  }

  if (dryRun) {
    const counts: Record<string, number> = {};
    for (const table of PREVIEW_TABLES) {
      const { count } = (await admin
        .from(table as never)
        .select("id", { count: "exact", head: true })
        .eq("organization_id" as never, orgId as never)) as unknown as {
        count: number | null;
      };
      if (count) counts[table] = count;
    }
    return NextResponse.json({
      ok: true,
      dry_run: true,
      org_id: orgId,
      org_name: org.name,
      suspended_at: org.suspended_at,
      would_delete: counts,
      total_rows: Object.values(counts).reduce((a, b) => a + b, 0),
    });
  }

  try {
    const result = await purgeOrgData(orgId);
    console.log(
      `[admin/purge-org] purged "${org.name}" (${orgId}):`,
      JSON.stringify(result.tables),
    );
    return NextResponse.json({
      ok: result.errors.length === 0,
      dry_run: false,
      org_id: orgId,
      org_name: org.name,
      tables: Object.fromEntries(
        Object.entries(result.tables).filter(([, n]) => n > 0),
      ),
      storage_files_removed: result.storageFilesRemoved,
      auth_users_deleted: result.authUsersDeleted,
      errors: result.errors,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    console.error(`[admin/purge-org] failed for ${orgId}:`, reason);
    return NextResponse.json(
      { ok: false, org_id: orgId, org_name: org.name, error: reason },
      { status: 500 },
    );
  }
}

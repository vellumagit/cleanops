/**
 * GET /api/export
 *
 * Streams a full JSON export of every row the org owns. Called from
 * Settings → Your data → "Download export". Requires owner or admin.
 *
 * The export can be large (MBs) on established accounts and takes several
 * seconds — maxDuration is set to 60 s to avoid a Vercel function timeout.
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { exportOrgData } from "@/lib/tenant-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: NextRequest) {
  // requireMembership redirects to /login when unauthenticated — safe in a
  // GET route because the browser follows the redirect naturally.
  const membership = await requireMembership(["owner", "admin"]);

  const bundle = await exportOrgData(membership.organization_id);

  const date = new Date().toISOString().slice(0, 10);
  const filename = `sollos-export-${date}.json`;

  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

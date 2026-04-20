/**
 * GET /api/export — streams the full tenant data bundle as a JSON download.
 *
 * Access control: must be an owner or admin of the target org. Uses the
 * RLS-bound server client to verify membership, then the service-role
 * client inside `exportOrgData` to gather every row.
 */

import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { exportOrgData } from "@/lib/tenant-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const membership = await requireMembership(["owner", "admin"]);

  const bundle = await exportOrgData(membership.organization_id);

  const filename = `sollos-export-${membership.organization_id.slice(0, 8)}-${new Date().toISOString().split("T")[0]}.json`;

  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

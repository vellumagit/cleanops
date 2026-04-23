import { NextResponse, type NextRequest } from "next/server";
import { requireMembership } from "@/lib/auth";
import { disconnect as disconnectSquare } from "@/lib/square";
import { logAuditEvent } from "@/lib/audit";

/**
 * Disconnect Square for the caller's org. Best-effort revoke on Square's
 * side (so Square drops its server reference to our app), then flip the
 * integration_connections row to status='disconnected' and clear the
 * tokens so a leaked DB dump can't be used against the merchant.
 *
 * POST-only so a stale GET in a browser history can't accidentally
 * disconnect the org.
 */
export async function POST(request: NextRequest) {
  const membership = await requireMembership(["owner", "admin"]);

  await disconnectSquare(membership.organization_id);

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "settings",
    after: { provider: "square", disconnected: true },
  });

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  return NextResponse.redirect(
    `${siteUrl}/app/settings/integrations?square_disconnected=1`,
    { status: 303 }, // 303 so the browser does a GET on the redirect
  );
}

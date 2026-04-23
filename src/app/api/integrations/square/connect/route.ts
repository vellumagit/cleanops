import { NextResponse, type NextRequest } from "next/server";
import { requireMembership } from "@/lib/auth";
import { issueOAuthState, buildOAuthUrl } from "@/lib/square";
import { isSquareConfigured } from "@/lib/env";

/**
 * Kick off the Square OAuth handshake.
 *
 * Flow:
 *   1. Owner/admin-only: gate on the role.
 *   2. Mint a CSRF state token tied to (org, membership).
 *   3. Redirect to Square's authorize URL.
 *
 * Square will eventually call us back at /api/integrations/square/callback
 * with ?code=<auth code>&state=<our token>.
 */
export async function GET(request: NextRequest) {
  if (!isSquareConfigured()) {
    return NextResponse.json(
      { error: "Square integration is not configured" },
      { status: 503 },
    );
  }

  // Only owners/admins can connect a payment processor — this is a
  // financial relationship that affects every invoice sent afterwards.
  const membership = await requireMembership(["owner", "admin"]);

  const state = await issueOAuthState({
    organizationId: membership.organization_id,
    membershipId: membership.id,
  });

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const redirectUri = `${siteUrl}/api/integrations/square/callback`;

  const authorizeUrl = buildOAuthUrl({ state, redirectUri });
  if (!authorizeUrl) {
    return NextResponse.json(
      { error: "Square is not configured" },
      { status: 503 },
    );
  }

  return NextResponse.redirect(authorizeUrl);
}

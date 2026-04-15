/**
 * Kick off the Stripe Connect OAuth flow. GET /api/integrations/stripe/connect
 * issues a CSRF state token and redirects to Stripe's consent screen.
 */

import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { isStripeConnectEnabled } from "@/lib/stripe";
import { issueOAuthState, buildOAuthUrl } from "@/lib/stripe-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isStripeConnectEnabled()) {
    return NextResponse.json(
      { error: "Stripe Connect is not configured" },
      { status: 503 },
    );
  }

  const membership = await requireMembership(["owner", "admin"]);

  const state = await issueOAuthState({
    organizationId: membership.organization_id,
    membershipId: membership.id,
  });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  const url = buildOAuthUrl({
    state,
    redirectUri: `${siteUrl}/api/integrations/stripe/callback`,
  });

  if (!url) {
    return NextResponse.json(
      { error: "Stripe Connect client id missing" },
      { status: 503 },
    );
  }
  return NextResponse.redirect(url);
}

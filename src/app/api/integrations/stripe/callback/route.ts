/**
 * OAuth callback. Stripe redirects here with ?code=...&state=... after the
 * merchant approves the connection (or ?error=... if they deny).
 *
 * We:
 *   1. Validate the state against `stripe_oauth_states` (single-use, 10m TTL).
 *   2. Confirm the current authenticated user matches the membership that
 *      issued the state — prevents an attacker from making the victim land
 *      here with a pre-issued state.
 *   3. Exchange the code for a connected account id.
 *   4. Save it to the organization.
 *   5. Redirect to Settings → Integrations with a success flag.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireMembership } from "@/lib/auth";
import {
  consumeOAuthState,
  completeOAuth,
  saveConnectedAccount,
} from "@/lib/stripe-connect";
import { isStripeConnectEnabled } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTINGS_URL = "/app/settings/integrations";

export async function GET(req: NextRequest) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  if (!isStripeConnectEnabled()) {
    return NextResponse.redirect(
      `${siteUrl}${SETTINGS_URL}?stripe=disabled`,
    );
  }

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    return NextResponse.redirect(
      `${siteUrl}${SETTINGS_URL}?stripe=denied`,
    );
  }
  if (!code || !state) {
    return NextResponse.redirect(
      `${siteUrl}${SETTINGS_URL}?stripe=missing_params`,
    );
  }

  // Must be authenticated — we re-verify that the current user has the
  // same membership the state was issued to.
  const membership = await requireMembership(["owner", "admin"]);

  let consumed: { organizationId: string; membershipId: string };
  try {
    consumed = await consumeOAuthState(state);
  } catch {
    return NextResponse.redirect(
      `${siteUrl}${SETTINGS_URL}?stripe=bad_state`,
    );
  }

  if (
    consumed.organizationId !== membership.organization_id ||
    consumed.membershipId !== membership.id
  ) {
    return NextResponse.redirect(
      `${siteUrl}${SETTINGS_URL}?stripe=identity_mismatch`,
    );
  }

  try {
    const { accountId } = await completeOAuth(code);
    await saveConnectedAccount({
      organizationId: membership.organization_id,
      accountId,
    });
  } catch (err) {
    console.error("[stripe connect callback] exchange failed", err);
    return NextResponse.redirect(
      `${siteUrl}${SETTINGS_URL}?stripe=exchange_failed`,
    );
  }

  return NextResponse.redirect(`${siteUrl}${SETTINGS_URL}?stripe=connected`);
}

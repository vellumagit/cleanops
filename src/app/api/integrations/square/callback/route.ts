import { NextResponse, type NextRequest } from "next/server";
import { requireMembership } from "@/lib/auth";
import {
  consumeOAuthState,
  exchangeCodeForTokens,
  fetchMerchant,
  fetchPrimaryLocation,
  saveConnection,
} from "@/lib/square";

/**
 * Square redirects here after the user approves (or denies) the OAuth
 * request. We:
 *   1. Validate the state token matches something we issued and isn't
 *      expired.
 *   2. Re-verify the currently-signed-in member matches the state's
 *      recorded (org, membership). Stops a CSRF-via-shared-link.
 *   3. Exchange the auth code for tokens.
 *   4. Fetch the merchant + their primary location (so we know where to
 *      route payment links).
 *   5. Encrypt + persist tokens in integration_connections.
 *   6. Redirect back to Settings → Integrations with a success query.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const settingsUrl = `${siteUrl}/app/settings/integrations`;

  // User denied the request (hit Cancel on Square's page).
  if (error) {
    return NextResponse.redirect(
      `${settingsUrl}?square_error=${encodeURIComponent(error)}`,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${settingsUrl}?square_error=${encodeURIComponent("missing_code_or_state")}`,
    );
  }

  // requireMembership redirects to /login if not authenticated — that's
  // the right behavior. Square's redirect includes the user's session
  // cookie so they should be logged in already.
  const membership = await requireMembership(["owner", "admin"]);

  // Validate + consume the state.
  let stateData: { organizationId: string; membershipId: string };
  try {
    stateData = await consumeOAuthState(state);
  } catch {
    return NextResponse.redirect(
      `${settingsUrl}?square_error=${encodeURIComponent("invalid_state")}`,
    );
  }

  // Defense in depth: the currently-signed-in user must match the state.
  // Stops someone from tricking a second owner into finishing their OAuth.
  if (
    stateData.organizationId !== membership.organization_id ||
    stateData.membershipId !== membership.id
  ) {
    return NextResponse.redirect(
      `${settingsUrl}?square_error=${encodeURIComponent("session_mismatch")}`,
    );
  }

  // Exchange + fetch merchant metadata + primary location.
  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    console.error("[square] code exchange failed:", err);
    return NextResponse.redirect(
      `${settingsUrl}?square_error=${encodeURIComponent("token_exchange_failed")}`,
    );
  }

  // These calls are best-effort — if they fail we still persist the
  // tokens but mark the connection with nulls; the UI can re-fetch later.
  const [, locationId] = await Promise.all([
    fetchMerchant(tokens.access_token).catch(() => null),
    fetchPrimaryLocation(tokens.access_token).catch(() => null),
  ]);

  await saveConnection({
    organizationId: stateData.organizationId,
    membershipId: stateData.membershipId,
    merchantId: tokens.merchant_id,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_at,
    locationId,
  });

  return NextResponse.redirect(`${settingsUrl}?square_connected=1`);
}

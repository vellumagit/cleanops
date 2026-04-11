/**
 * Sage Business Cloud Accounting integration service.
 *
 * Handles OAuth2 token exchange and refresh for Sage. The actual invoice
 * and contact sync will be built in a future phase — this module provides
 * the OAuth plumbing so the Connect/Disconnect flow works end-to-end.
 *
 * Sage quirks:
 *   - Access tokens expire after ~5 minutes (300s)
 *   - Refresh tokens expire after 31 days
 *   - Refresh tokens rotate on every use — the new refresh token must
 *     be stored immediately, or the connection is permanently broken
 */

import "server-only";
import { getEnv } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

const SAGE_AUTH_URL = "https://www.sageone.com/oauth2/auth/central";
const SAGE_TOKEN_URL = "https://oauth.accounting.sage.com/token";

/**
 * Build the Sage OAuth consent URL.
 */
export function buildSageOAuthUrl(state: string): string {
  const env = getEnv();
  const params = new URLSearchParams({
    client_id: env.SAGE_CLIENT_ID!,
    redirect_uri: `${env.NEXT_PUBLIC_SITE_URL}/api/integrations/sage/callback`,
    response_type: "code",
    scope: "full_access",
    state,
  });
  return `${SAGE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeSageCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  resource_owner_id?: string;
}> {
  const env = getEnv();
  const res = await fetch(SAGE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.SAGE_CLIENT_ID!,
      client_secret: env.SAGE_CLIENT_SECRET!,
      redirect_uri: `${env.NEXT_PUBLIC_SITE_URL}/api/integrations/sage/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sage token exchange failed: ${res.status} ${body}`);
  }

  return res.json();
}

/**
 * Refresh an expired access token.
 *
 * IMPORTANT: Sage rotates refresh tokens on every use — the old refresh
 * token is invalidated as soon as a new one is issued. We must persist
 * the new refresh token immediately.
 */
export async function refreshSageAccessToken(
  connectionId: string,
  refreshTokenCiphertext: string,
): Promise<string> {
  const env = getEnv();
  const refreshToken = decryptSecret(refreshTokenCiphertext);
  if (!refreshToken) throw new Error("No refresh token available");

  const res = await fetch(SAGE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.SAGE_CLIENT_ID!,
      client_secret: env.SAGE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const admin = createSupabaseAdminClient();

  if (!res.ok) {
    const body = await res.text();
    await admin
      .from("integration_connections" as never)
      .update({
        status: "error",
        last_error: `Token refresh failed: ${res.status}`,
      } as never)
      .eq("id" as never, connectionId);
    throw new Error(`Sage token refresh failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  const newAccessToken: string = data.access_token;
  const newRefreshToken: string = data.refresh_token;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  // Persist BOTH the new access token AND the rotated refresh token
  await admin
    .from("integration_connections" as never)
    .update({
      access_token_ciphertext: encryptSecret(newAccessToken),
      refresh_token_ciphertext: encryptSecret(newRefreshToken),
      token_expires_at: expiresAt,
      status: "active",
      last_error: null,
    } as never)
    .eq("id" as never, connectionId);

  return newAccessToken;
}

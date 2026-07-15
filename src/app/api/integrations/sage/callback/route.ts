import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";
import { exchangeSageCodeForTokens, consumeSageOAuthState } from "@/lib/sage";
import { getEnv } from "@/lib/env";

/**
 * Sage OAuth callback.
 *
 * Flow:
 *   1. Admin clicks "Connect Sage" → redirect to Sage consent screen
 *   2. Sage redirects here with ?code=...&state=membershipId
 *   3. Exchange code for tokens, encrypt, store in integration_connections
 *   4. Redirect back to integrations page
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const env = getEnv();
  const redirectBase = `${env.NEXT_PUBLIC_SITE_URL}/app/settings/integrations`;

  if (error) {
    return NextResponse.redirect(
      `${redirectBase}?sage_error=${encodeURIComponent(error)}`,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${redirectBase}?sage_error=${encodeURIComponent("Missing authorization code")}`,
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${env.NEXT_PUBLIC_SITE_URL}/login`);
  }

  // Consume the single-use state token → (org, membership). Rejects a forged or
  // expired callback that wasn't initiated by our connect flow.
  let stateData: { organizationId: string; membershipId: string };
  try {
    stateData = await consumeSageOAuthState(state);
  } catch {
    return NextResponse.redirect(
      `${redirectBase}?sage_error=${encodeURIComponent("Invalid or expired session — please try again")}`,
    );
  }

  // Defense in depth: the membership named by the state must still belong to
  // the signed-in user and be an active owner/admin of the same org.
  const { data: membership } = await supabase
    .from("memberships")
    .select("id, organization_id, role")
    .eq("id", stateData.membershipId)
    .eq("profile_id", user.id)
    .in("role", ["owner", "admin"])
    .eq("status", "active")
    .maybeSingle();

  if (!membership || membership.organization_id !== stateData.organizationId) {
    return NextResponse.redirect(
      `${redirectBase}?sage_error=${encodeURIComponent("Invalid session — please try again")}`,
    );
  }

  try {
    const tokens = await exchangeSageCodeForTokens(code);
    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString();

    const admin = createSupabaseAdminClient();

    // Disconnect any existing Sage connection for this org
    await admin
      .from("integration_connections" as never)
      .update({ status: "disconnected" } as never)
      .eq("organization_id" as never, membership.organization_id)
      .eq("provider" as never, "sage")
      .eq("status" as never, "active");

    // Insert new connection
    await admin.from("integration_connections" as never).insert({
      organization_id: membership.organization_id,
      provider: "sage",
      external_account_id: tokens.resource_owner_id ?? null,
      external_account_label: "Sage Accounting",
      access_token_ciphertext: encryptSecret(tokens.access_token),
      refresh_token_ciphertext: encryptSecret(tokens.refresh_token),
      token_expires_at: expiresAt,
      scope: tokens.scope ?? "full_access",
      status: "active",
      metadata: {},
      connected_by: membership.id,
    } as never);

    return NextResponse.redirect(`${redirectBase}?sage_connected=true`);
  } catch (err) {
    console.error("[sage] OAuth callback error:", err);
    return NextResponse.redirect(
      `${redirectBase}?sage_error=${encodeURIComponent("Failed to connect — please try again")}`,
    );
  }
}

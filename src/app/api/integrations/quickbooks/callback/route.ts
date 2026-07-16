import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";
import { exchangeQBCodeForTokens, consumeQBOAuthState } from "@/lib/quickbooks";
import { getEnv } from "@/lib/env";

/**
 * QuickBooks Online OAuth callback.
 *
 * Intuit redirects here with ?code=...&state=...&realmId=<company id>. We
 * consume the single-use state, verify the caller, exchange the code for
 * tokens, and store the connection (realmId → external_account_id).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId");
  const error = url.searchParams.get("error");

  const env = getEnv();
  const redirectBase = `${env.NEXT_PUBLIC_SITE_URL}/app/settings/integrations`;

  if (error) {
    return NextResponse.redirect(
      `${redirectBase}?qb_error=${encodeURIComponent(error)}`,
    );
  }
  if (!code || !state || !realmId) {
    return NextResponse.redirect(
      `${redirectBase}?qb_error=${encodeURIComponent("Missing authorization code or company id")}`,
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${env.NEXT_PUBLIC_SITE_URL}/login`);
  }

  let stateData: { organizationId: string; membershipId: string };
  try {
    stateData = await consumeQBOAuthState(state);
  } catch {
    return NextResponse.redirect(
      `${redirectBase}?qb_error=${encodeURIComponent("Invalid or expired session — please try again")}`,
    );
  }

  // Defense in depth: the state's membership must still belong to the signed-in
  // user and be an active owner/admin of that org.
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
      `${redirectBase}?qb_error=${encodeURIComponent("Invalid session — please try again")}`,
    );
  }

  try {
    const tokens = await exchangeQBCodeForTokens(code);
    const admin = createSupabaseAdminClient();

    // Disconnect any existing active QBO connection for this org.
    await admin
      .from("integration_connections" as never)
      .update({ status: "disconnected" } as never)
      .eq("organization_id" as never, membership.organization_id)
      .eq("provider" as never, "quickbooks")
      .eq("status" as never, "active");

    await admin.from("integration_connections" as never).insert({
      organization_id: membership.organization_id,
      provider: "quickbooks",
      external_account_id: realmId, // QBO company id — every API call scopes to it
      external_account_label: "QuickBooks Online",
      access_token_ciphertext: encryptSecret(tokens.access_token),
      refresh_token_ciphertext: encryptSecret(tokens.refresh_token),
      token_expires_at: new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString(),
      scope: "com.intuit.quickbooks.accounting",
      status: "active",
      metadata: {},
      connected_by: membership.id,
    } as never);

    return NextResponse.redirect(`${redirectBase}?qb_connected=true`);
  } catch (err) {
    console.error("[qbo] OAuth callback error:", err);
    return NextResponse.redirect(
      `${redirectBase}?qb_error=${encodeURIComponent("Failed to connect — please try again")}`,
    );
  }
}

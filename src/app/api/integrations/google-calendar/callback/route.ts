import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";
import { exchangeCodeForTokens } from "@/lib/google-calendar";
import { getEnv } from "@/lib/env";

/**
 * Google Calendar OAuth callback.
 *
 * Flow:
 *   1. Admin clicks "Connect Google Calendar" → we redirect to Google
 *      consent screen with `state = membershipId`.
 *   2. Google redirects here with `?code=...&state=membershipId`.
 *   3. We exchange the code for tokens, encrypt them, and store in
 *      `integration_connections`.
 *   4. Redirect back to /app/settings/integrations with a success message.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // membershipId
  const error = url.searchParams.get("error");

  const env = getEnv();
  const redirectBase = `${env.NEXT_PUBLIC_SITE_URL}/app/settings/integrations`;

  // User denied consent
  if (error) {
    return NextResponse.redirect(
      `${redirectBase}?gcal_error=${encodeURIComponent(error)}`,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${redirectBase}?gcal_error=${encodeURIComponent("Missing authorization code")}`,
    );
  }

  // Verify the user is authenticated and the state matches their membership
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${env.NEXT_PUBLIC_SITE_URL}/login`);
  }

  // Look up the membership from state to get the org
  const { data: membership } = await supabase
    .from("memberships")
    .select("id, organization_id, role")
    .eq("id", state)
    .eq("profile_id", user.id)
    .in("role", ["owner", "admin"])
    .eq("status", "active")
    .maybeSingle();

  if (!membership) {
    return NextResponse.redirect(
      `${redirectBase}?gcal_error=${encodeURIComponent("Invalid session — please try again")}`,
    );
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);
    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString();

    // Store encrypted in integration_connections
    const admin = createSupabaseAdminClient();

    // Disconnect any existing Google Calendar connection for this org
    await admin
      .from("integration_connections" as never)
      .update({ status: "disconnected" } as never)
      .eq("organization_id" as never, membership.organization_id)
      .eq("provider" as never, "google_calendar")
      .eq("status" as never, "active");

    // Insert new connection
    await admin.from("integration_connections" as never).insert({
      organization_id: membership.organization_id,
      provider: "google_calendar",
      external_account_id: tokens.email ?? null,
      external_account_label: tokens.email
        ? `${tokens.email} (Google Calendar)`
        : "Google Calendar",
      access_token_ciphertext: encryptSecret(tokens.access_token),
      refresh_token_ciphertext: encryptSecret(tokens.refresh_token),
      token_expires_at: expiresAt,
      scope: tokens.scope ?? "calendar.events",
      status: "active",
      metadata: { calendar_id: "primary" },
      connected_by: membership.id,
    } as never);

    return NextResponse.redirect(`${redirectBase}?gcal_connected=true`);
  } catch (err) {
    console.error("[gcal] OAuth callback error:", err);
    return NextResponse.redirect(
      `${redirectBase}?gcal_error=${encodeURIComponent("Failed to connect — please try again")}`,
    );
  }
}

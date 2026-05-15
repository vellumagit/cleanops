import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";
import {
  exchangeCodeForTokens,
  cleanupOrgCalendarEvents,
  bulkSyncUpcomingBookings,
} from "@/lib/google-calendar";
import { getEnv } from "@/lib/env";

/**
 * Google Calendar OAuth callback.
 *
 * Flow:
 *   1. Admin clicks "Connect Google Calendar" → we redirect to Google
 *      consent screen with `state = membershipId`.
 *   2. Google redirects here with `?code=...&state=membershipId`.
 *   3. We verify identity — first via the `gcal_oauth_state` cookie we set
 *      before the redirect (Safari/ITP-safe), falling back to the Supabase
 *      session if the cookie is absent.
 *   4. Exchange the code for tokens, encrypt them, store in
 *      `integration_connections`.
 *   5. Redirect back to /app/settings/integrations with a success flag.
 *
 * WHY TWO VERIFICATION PATHS?
 *
 * Safari's ITP (Intelligent Tracking Prevention) on Mac can strip or
 * withhold the Supabase session cookie when a cross-site redirect chain
 * flows through accounts.google.com → back to our app. If that happens,
 * `supabase.auth.getUser()` returns null and the user gets silently
 * redirected to /login instead of completing the connection.
 *
 * Setting `gcal_oauth_state` (same-site Lax, scope-restricted to this
 * path) before the redirect means we have a first-party cookie that ITP
 * will not strip, allowing us to verify the flow without the session.
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

  // -------------------------------------------------------------------------
  // Step 1: resolve the organization ID
  // -------------------------------------------------------------------------

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("gcal_oauth_state")?.value;

  let organizationId: string | null = null;

  if (stateCookie && stateCookie === state) {
    // PRIMARY PATH (ITP-safe) ─────────────────────────────────────────────
    // We set this cookie right before the redirect, scoped to this path.
    // It survives Safari's ITP because it's a same-site first-party cookie.
    // Clear it immediately so it can't be replayed.
    cookieStore.delete("gcal_oauth_state");

    const admin = createSupabaseAdminClient();
    const { data: membership } = (await admin
      .from("memberships")
      .select("organization_id")
      .eq("id", state)
      .in("role", ["owner", "admin"])
      .eq("status", "active")
      .maybeSingle()) as unknown as {
      data: { organization_id: string } | null;
    };

    if (membership) {
      organizationId = membership.organization_id;
    }
  } else {
    // FALLBACK PATH (session-based) ────────────────────────────────────────
    // Cookie absent or mismatched (e.g. different browser, old link).
    // Fall back to Supabase session verification — the original behaviour.
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(`${env.NEXT_PUBLIC_SITE_URL}/login`);
    }

    const { data: membership } = await supabase
      .from("memberships")
      .select("id, organization_id, role")
      .eq("id", state)
      .eq("profile_id", user.id)
      .in("role", ["owner", "admin"])
      .eq("status", "active")
      .maybeSingle();

    if (membership) {
      organizationId = membership.organization_id;
    }
  }

  if (!organizationId) {
    return NextResponse.redirect(
      `${redirectBase}?gcal_error=${encodeURIComponent("Invalid session — please try again")}`,
    );
  }

  // -------------------------------------------------------------------------
  // Step 2: exchange code for tokens and store the connection
  // -------------------------------------------------------------------------

  try {
    const tokens = await exchangeCodeForTokens(code);
    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString();

    const admin = createSupabaseAdminClient();

    // Check whether an active connection already exists and if it belongs to
    // the same Google account. If it's the same account (e.g. re-auth after
    // expiry or after a UI disconnect+reconnect of the same email) we just
    // refresh the tokens — no event cleanup or bulk re-sync needed. This
    // prevents the "doubling" bug where cleanup silently fails to delete some
    // GCal events but nulls their IDs, causing bulkSync to create duplicates.
    const { data: existingActive } = await admin
      .from("integration_connections" as never)
      .select("id, external_account_id")
      .eq("organization_id" as never, organizationId)
      .eq("provider" as never, "google_calendar")
      .eq("status" as never, "active")
      .maybeSingle() as unknown as {
      data: { id: string; external_account_id: string | null } | null;
    };

    const isSameAccount =
      existingActive &&
      tokens.email &&
      existingActive.external_account_id === tokens.email;

    if (isSameAccount) {
      // Just rotate the tokens on the existing connection — events are already
      // on the right calendar so there's nothing to clean up or re-sync.
      await admin
        .from("integration_connections" as never)
        .update({
          access_token_ciphertext: encryptSecret(tokens.access_token),
          refresh_token_ciphertext: encryptSecret(tokens.refresh_token),
          token_expires_at: expiresAt,
          external_account_label: tokens.email
            ? `${tokens.email} (Google Calendar)`
            : "Google Calendar",
        } as never)
        .eq("id" as never, existingActive.id);

      return NextResponse.redirect(`${redirectBase}?gcal_connected=true`);
    }

    // Different account (or no existing connection) — full switch:
    // 1. Delete events from the OLD calendar and null the IDs so bulkSync
    //    can push them to the new calendar. Must run while the old connection
    //    is still active (getConnection looks for status='active').
    await cleanupOrgCalendarEvents(organizationId).catch(() => {});

    // 2. Disconnect any existing Google Calendar connection for this org.
    await admin
      .from("integration_connections" as never)
      .update({ status: "disconnected" } as never)
      .eq("organization_id" as never, organizationId)
      .eq("provider" as never, "google_calendar")
      .eq("status" as never, "active");

    // 3. Insert new connection.
    await admin.from("integration_connections" as never).insert({
      organization_id: organizationId,
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
    } as never);

    // 4. Push all upcoming bookings whose IDs were cleared to the new calendar.
    await bulkSyncUpcomingBookings(organizationId).catch(() => {});

    return NextResponse.redirect(`${redirectBase}?gcal_connected=true`);
  } catch (err) {
    console.error("[gcal] OAuth callback error:", err);
    return NextResponse.redirect(
      `${redirectBase}?gcal_error=${encodeURIComponent("Failed to connect — please try again")}`,
    );
  }
}

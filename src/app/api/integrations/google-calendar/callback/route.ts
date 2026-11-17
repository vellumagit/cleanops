import { NextRequest, NextResponse } from "next/server";
import { enterFailClosed } from "@/lib/supabase/query-guard";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";
import {
  exchangeCodeForTokens,
  cleanupOrgCalendarEvents,
  cleanupMemberCalendarEvents,
  bulkSyncUpcomingBookings,
  bulkSyncMemberBookings,
  forgetCalendarConnection,
} from "@/lib/google-calendar";
import { getEnv } from "@/lib/env";
import { readGcalOAuthState } from "@/lib/gcal-oauth-state";

/**
 * Google Calendar OAuth callback — handles BOTH org-level and per-member flows.
 *
 * STATE
 *   A sealed token only this server can make (lib/gcal-oauth-state): the
 *   membership that pressed Connect, which calendar (company or their own),
 *   and a ten-minute expiry. A bare membership id, the old state, is refused:
 *   it is not a secret, and anyone who knew an owner's could connect that
 *   company's calendar to their own Google account.
 *
 * COOKIE NAMES
 *   Org-level  : gcal_oauth_state
 *   Member-level: gcal_member_oauth_state
 *
 * WHY TWO VERIFICATION PATHS (ITP-safe cookie + session fallback)?
 *
 * Safari's ITP can strip the Supabase session cookie when a cross-site
 * redirect chain flows through accounts.google.com → back to our app.
 * Setting a same-site Lax cookie right before the OAuth redirect gives us
 * a first-party cookie that ITP will not strip.
 */
export async function GET(request: NextRequest) {
  enterFailClosed();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const env = getEnv();
  const siteUrl = env.NEXT_PUBLIC_SITE_URL;

  // Who started this flow, read from the sealed state. Null when it is
  // forged, edited or more than ten minutes old.
  const issued = readGcalOAuthState(state);
  const isMemberScope = issued?.scope === "member";
  const membershipIdFromState = issued?.membershipId ?? "";

  // Redirect targets differ by scope.
  const successRedirect = isMemberScope
    ? `${siteUrl}/field/profile?gcal_connected=true`
    : `${siteUrl}/app/settings/integrations?gcal_connected=true`;
  const errorBase = isMemberScope
    ? `${siteUrl}/field/profile`
    : `${siteUrl}/app/settings/integrations`;

  const errRedirect = (msg: string) =>
    NextResponse.redirect(`${errorBase}?gcal_error=${encodeURIComponent(msg)}`);

  // User denied consent.
  if (error) return errRedirect(error);
  if (!code || !state) return errRedirect("Missing authorization code");
  if (!issued) return errRedirect("Invalid session — please try again");

  // ---------------------------------------------------------------------------
  // Branch A: Member-level flow
  // ---------------------------------------------------------------------------
  if (isMemberScope) {
    return handleMemberCallback(
      code,
      state,
      membershipIdFromState,
      successRedirect,
      errRedirect,
    );
  }

  // ---------------------------------------------------------------------------
  // Branch B: Org-level flow (original behaviour)
  // ---------------------------------------------------------------------------
  return handleOrgCallback(
    code,
    state,
    membershipIdFromState,
    siteUrl,
    successRedirect,
    errRedirect,
  );
}

// ---------------------------------------------------------------------------
// Org-level handler
// ---------------------------------------------------------------------------

async function handleOrgCallback(
  code: string,
  state: string, // the sealed token, as sent
  stateValue: string, // the membership it was issued to
  siteUrl: string,
  successRedirect: string,
  errRedirect: (msg: string) => NextResponse,
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("gcal_oauth_state")?.value;
  const cookieName = "gcal_oauth_state";

  let organizationId: string | null = null;

  if (stateCookie && stateCookie === state) {
    // PRIMARY PATH (ITP-safe cookie): this browser holds the very token
    // that came back, and only the server could have made it.
    cookieStore.delete(cookieName);

    const admin = createSupabaseAdminClient();
    const { data: membership } = (await admin
      .from("memberships")
      .select("organization_id")
      .eq("id", stateValue)
      .in("role", ["owner", "admin"])
      .eq("status", "active")
      .maybeSingle()) as unknown as {
      data: { organization_id: string } | null;
    };

    if (membership) organizationId = membership.organization_id;
  } else {
    // FALLBACK PATH (Supabase session)
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(`${siteUrl}/login`);
    }

    const { data: membership } = await supabase
      .from("memberships")
      .select("id, organization_id, role")
      .eq("id", stateValue)
      .eq("profile_id", user.id)
      .in("role", ["owner", "admin"])
      .eq("status", "active")
      .maybeSingle();

    if (membership) organizationId = membership.organization_id;
  }

  if (!organizationId) {
    return errRedirect("Invalid session — please try again");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    // Reject a grant that's missing the Calendar permission (user unchecked
    // it on Google's consent screen). Without it every event write 403s and
    // the connection silently syncs nothing despite looking "active".
    if (!(tokens.scope ?? "").includes("calendar")) {
      return errRedirect(
        "Calendar access wasn't granted. Please reconnect and keep the Google Calendar permission checked.",
      );
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const admin = createSupabaseAdminClient();

    // Check for existing active ORG-level connection (membership_id IS NULL).
    const { data: existingActive } = (await admin
      .from("integration_connections")
      .select("id, external_account_id")
      .eq("organization_id", organizationId)
      .eq("provider", "google_calendar")
      .eq("status", "active")
      .is("membership_id", null)
      .maybeSingle()) as unknown as {
      data: { id: string; external_account_id: string | null } | null;
    };

    const isSameAccount =
      existingActive &&
      (
        !tokens.email ||
        !existingActive.external_account_id ||
        existingActive.external_account_id === tokens.email
      );

    if (isSameAccount) {
      await admin
        .from("integration_connections")
        .update({
          access_token_ciphertext: encryptSecret(tokens.access_token),
          refresh_token_ciphertext: encryptSecret(tokens.refresh_token),
          token_expires_at: expiresAt,
          status: "active",
          last_error: null,
          ...(tokens.email
            ? {
                external_account_id: tokens.email,
                external_account_label: `${tokens.email} (Google Calendar)`,
              }
            : {}),
        })
        .eq("id", existingActive.id);
      forgetCalendarConnection({ organizationId });

      return NextResponse.redirect(successRedirect);
    }

    // Different account — wipe old events, then re-sync.
    await cleanupOrgCalendarEvents(organizationId).catch(() => {});

    await admin
      .from("integration_connections")
      .update({ status: "disconnected" })
      .eq("organization_id", organizationId)
      .eq("provider", "google_calendar")
      .eq("status", "active")
      .is("membership_id", null);

    await admin.from("integration_connections").insert({
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
      // membership_id intentionally omitted (NULL = org-level)
    });

    // The clean-up above cached the OLD account's token; drop it so the
    // re-sync below goes to the calendar that was just connected.
    forgetCalendarConnection({ organizationId });
    await bulkSyncUpcomingBookings(organizationId).catch(() => {});

    return NextResponse.redirect(successRedirect);
  } catch (err) {
    console.error("[gcal/org] OAuth callback error:", err);
    return errRedirect("Failed to connect — please try again");
  }
}

// ---------------------------------------------------------------------------
// Member-level handler
// ---------------------------------------------------------------------------

async function handleMemberCallback(
  code: string,
  state: string, // the sealed token, as sent
  membershipId: string, // the membership it was issued to
  successRedirect: string,
  errRedirect: (msg: string) => NextResponse,
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("gcal_member_oauth_state")?.value;
  const admin = createSupabaseAdminClient();

  // Verify the membership is active (no role restriction — any member can connect).
  let orgId: string | null = null;

  if (stateCookie && stateCookie === state) {
    // ITP-safe cookie path.
    cookieStore.delete("gcal_member_oauth_state");

    const { data: membership } = (await admin
      .from("memberships")
      .select("organization_id")
      .eq("id", membershipId)
      .eq("status", "active")
      .maybeSingle()) as unknown as {
      data: { organization_id: string } | null;
    };

    if (membership) orgId = membership.organization_id;
  } else {
    // Fallback: verify via Supabase session.
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return errRedirect("Session expired — please try again");

    const { data: membership } = await supabase
      .from("memberships")
      .select("id, organization_id")
      .eq("id", membershipId)
      .eq("profile_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (membership) orgId = membership.organization_id;
  }

  if (!orgId) return errRedirect("Invalid session — please try again");

  try {
    const tokens = await exchangeCodeForTokens(code);

    // Google lets the user UNCHECK the Calendar permission on the consent
    // screen while still granting email/openid. That yields a token that
    // refreshes fine (so the connection looks "active") but 403s on every
    // calendar write — events silently never sync. Reject it here with a
    // clear message instead of saving a dead connection.
    if (!(tokens.scope ?? "").includes("calendar")) {
      return errRedirect(
        "Calendar access wasn't granted. Please reconnect and keep the Google Calendar permission checked.",
      );
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Check for existing active member-level connection.
    const { data: existingActive } = (await admin
      .from("integration_connections")
      .select("id, external_account_id")
      .eq("membership_id", membershipId)
      .eq("provider", "google_calendar")
      .eq("status", "active")
      .maybeSingle()) as unknown as {
      data: { id: string; external_account_id: string | null } | null;
    };

    const isSameAccount =
      existingActive &&
      (
        !tokens.email ||
        !existingActive.external_account_id ||
        existingActive.external_account_id === tokens.email
      );

    if (isSameAccount) {
      // Same Google account — just rotate tokens.
      await admin
        .from("integration_connections")
        .update({
          access_token_ciphertext: encryptSecret(tokens.access_token),
          refresh_token_ciphertext: encryptSecret(tokens.refresh_token),
          token_expires_at: expiresAt,
          status: "active",
          last_error: null,
          ...(tokens.email
            ? {
                external_account_id: tokens.email,
                external_account_label: `${tokens.email} (Google Calendar)`,
              }
            : {}),
        })
        .eq("id", existingActive.id);
    } else {
      // Different account (or first connect) — clean up old events first.
      if (existingActive) {
        await cleanupMemberCalendarEvents(membershipId).catch(() => {});

        await admin
          .from("integration_connections")
          .update({ status: "disconnected" })
          .eq("id", existingActive.id);
      }

      await admin.from("integration_connections").insert({
        organization_id: orgId,
        membership_id: membershipId,
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
      });
    }

    // Push all upcoming assigned bookings to this member's calendar.
    // Log failures so we can debug "I connected but nothing showed up"
    // reports — historically these were swallowed and impossible to trace.
    // Same as the company flow: never push with a token cached before the
    // connection changed.
    forgetCalendarConnection({ membershipId });
    try {
      await bulkSyncMemberBookings(membershipId);
    } catch (err) {
      console.error("[gcal/member] bulkSyncMemberBookings failed:", err);
    }

    return NextResponse.redirect(successRedirect);
  } catch (err) {
    console.error("[gcal/member] OAuth callback error:", err);
    return errRedirect("Failed to connect — please try again");
  }
}

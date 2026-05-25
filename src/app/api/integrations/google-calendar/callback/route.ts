import { NextRequest, NextResponse } from "next/server";
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
} from "@/lib/google-calendar";
import { getEnv } from "@/lib/env";

/**
 * Google Calendar OAuth callback — handles BOTH org-level and per-member flows.
 *
 * STATE ENCODING
 *   Org-level  : state = membershipId  (bare UUID, existing behaviour)
 *   Member-level: state = "mbr:{membershipId}"
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
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const env = getEnv();
  const siteUrl = env.NEXT_PUBLIC_SITE_URL;

  // Determine scope from state prefix.
  const isMemberScope = (state ?? "").startsWith("mbr:");
  const membershipIdFromState = isMemberScope
    ? state!.slice(4)
    : (state ?? "");

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

  // ---------------------------------------------------------------------------
  // Branch A: Member-level flow
  // ---------------------------------------------------------------------------
  if (isMemberScope) {
    return handleMemberCallback(
      code,
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
    membershipIdFromState, // bare membership UUID
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
  stateValue: string, // raw membership UUID
  siteUrl: string,
  successRedirect: string,
  errRedirect: (msg: string) => NextResponse,
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("gcal_oauth_state")?.value;
  const cookieName = "gcal_oauth_state";

  let organizationId: string | null = null;

  if (stateCookie && stateCookie === stateValue) {
    // PRIMARY PATH (ITP-safe cookie)
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
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const admin = createSupabaseAdminClient();

    // Check for existing active ORG-level connection (membership_id IS NULL).
    const { data: existingActive } = (await admin
      .from("integration_connections" as never)
      .select("id, external_account_id")
      .eq("organization_id" as never, organizationId)
      .eq("provider" as never, "google_calendar")
      .eq("status" as never, "active")
      .is("membership_id" as never, null as never)
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
        .from("integration_connections" as never)
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
        } as never)
        .eq("id" as never, existingActive.id);

      return NextResponse.redirect(successRedirect);
    }

    // Different account — wipe old events, then re-sync.
    await cleanupOrgCalendarEvents(organizationId).catch(() => {});

    await admin
      .from("integration_connections" as never)
      .update({ status: "disconnected" } as never)
      .eq("organization_id" as never, organizationId)
      .eq("provider" as never, "google_calendar")
      .eq("status" as never, "active")
      .is("membership_id" as never, null as never);

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
      // membership_id intentionally omitted (NULL = org-level)
    } as never);

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
  membershipId: string,
  successRedirect: string,
  errRedirect: (msg: string) => NextResponse,
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("gcal_member_oauth_state")?.value;
  const admin = createSupabaseAdminClient();

  // Verify the membership is active (no role restriction — any member can connect).
  let orgId: string | null = null;

  if (stateCookie && stateCookie === membershipId) {
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
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Check for existing active member-level connection.
    const { data: existingActive } = (await admin
      .from("integration_connections" as never)
      .select("id, external_account_id")
      .eq("membership_id" as never, membershipId)
      .eq("provider" as never, "google_calendar")
      .eq("status" as never, "active")
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
        .from("integration_connections" as never)
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
        } as never)
        .eq("id" as never, existingActive.id);
    } else {
      // Different account (or first connect) — clean up old events first.
      if (existingActive) {
        await cleanupMemberCalendarEvents(membershipId).catch(() => {});

        await admin
          .from("integration_connections" as never)
          .update({ status: "disconnected" } as never)
          .eq("id" as never, existingActive.id);
      }

      await admin.from("integration_connections" as never).insert({
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
      } as never);
    }

    // Push all upcoming assigned bookings to this member's calendar.
    // Log failures so we can debug "I connected but nothing showed up"
    // reports — historically these were swallowed and impossible to trace.
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

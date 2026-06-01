/**
 * Auth helpers for server components, server actions, and route handlers.
 *
 * The two important truths to understand:
 *
 * 1. `getClaims()` validates the JWT and is safe for authorization decisions.
 *    Use it for "is this user logged in?" and "what's their auth.uid()?".
 *
 * 2. `getUser()` calls the Supabase Auth server on every invocation. Use it
 *    only when you need fresh user record fields (email_confirmed_at, etc).
 *    For everything else, prefer `getClaims()`.
 *
 * The current "active membership" is determined by:
 *   1. Reading the `cleanops_active_org` cookie if set
 *   2. Otherwise, the user's first active membership (most-recently created)
 *
 * If the user has zero memberships, helpers return null and callers should
 * redirect to /signup or show an empty state.
 */

import "server-only";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "./supabase/server";
import type { Database } from "./supabase/types";

export type MembershipRole = Database["public"]["Enums"]["membership_role"];
export type MembershipStatus =
  Database["public"]["Enums"]["membership_status"];

export type CurrentMembership = {
  id: string;
  organization_id: string;
  organization_name: string;
  role: MembershipRole;
  status: MembershipStatus;
  profile_id: string;
};

const ACTIVE_ORG_COOKIE = "cleanops_active_org";

/**
 * Returns the current authenticated user's claims, or null if not signed in.
 * Validated against the JWKS endpoint — safe for authorization decisions.
 */
export async function getCurrentClaims() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return null;
  return data.claims;
}

/**
 * Returns the current authenticated user's id (auth.uid()), or null.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const claims = await getCurrentClaims();
  return claims?.sub ?? null;
}

/**
 * Returns the current authenticated user's full record (fresh DB lookup),
 * or null if not signed in. Use sparingly — this calls Supabase Auth server.
 */
export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Returns the current "active" membership for the signed-in user.
 *
 * Selection logic:
 *   1. If the `cleanops_active_org` cookie is set AND the user is an active
 *      member of that org, use it.
 *   2. Otherwise, use their most-recently-created active membership.
 *   3. If they have no active memberships, returns null.
 *
 * Returns null when no user is signed in.
 */
export async function getCurrentMembership(): Promise<CurrentMembership | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const supabase = await createSupabaseServerClient();
  const cookieStore = await cookies();
  const preferredOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null;

  const { data, error } = await supabase
    .from("memberships")
    .select(
      "id, organization_id, role, status, profile_id, organizations!inner(name)",
    )
    .eq("profile_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error || !data || data.length === 0) return null;

  const preferred = preferredOrgId
    ? data.find((m) => m.organization_id === preferredOrgId)
    : null;
  const chosen = preferred ?? data[0];

  return {
    id: chosen.id,
    organization_id: chosen.organization_id,
    organization_name: chosen.organizations.name,
    role: chosen.role,
    status: chosen.status,
    // profile_id is nullable post-2026-04-22 (shadow memberships), but the
    // query above filters .eq("profile_id", userId), so a matching row
    // always has a real profile_id. Safe to assert non-null here.
    profile_id: chosen.profile_id!,
  };
}

/**
 * Server-side guard. If the user is not signed in OR not in any org, redirects
 * to /login. If `allowed` is provided, also redirects when their role isn't
 * in the allowed list. Returns the membership when access is granted.
 *
 * Also enforces MFA: if the user has any verified TOTP factor and their
 * session is still at aal1 (just-logged-in-with-password), redirects to
 * /mfa-verify. Users who never enrolled MFA skip this gate — MFA is
 * opt-in and stays opt-in.
 *
 * Use at the top of server components inside protected layouts, and via
 * getActionContext() in server actions. Cron routes, public-API routes
 * (API-key auth), and webhook routes don't call this — they have their
 * own auth and no user session.
 */
export async function requireMembership(
  allowed?: MembershipRole[],
): Promise<CurrentMembership> {
  const membership = await getCurrentMembership();

  if (!membership) {
    redirect("/login");
  }

  if (allowed && !allowed.includes(membership.role)) {
    // Role mismatch — bounce employees to /field, everyone else to /app
    if (membership.role === "employee") {
      redirect("/field");
    }
    redirect("/app");
  }

  // ── MFA gate ─────────────────────────────────────────────────────────
  // The login action used to be the only AAL checkpoint, which meant a
  // stale aal1 session (closed tab between sign-in and /mfa-verify,
  // transient listFactors error, etc.) could reach every authed page.
  // Now every layout + server action funnels through here.
  //
  // The carveout: users with ZERO verified factors are never checked
  // for AAL — they haven't opted in, MFA is optional. The login action
  // also checks this so first-time enrollers can reach
  // /app/profile/security without a redirect loop.
  await enforceMfa();

  return membership;
}

/**
 * MFA gate shared by requireMembership. Extracted so route handlers
 * that intentionally bypass requireMembership (OAuth callbacks, etc.)
 * can still invoke it where appropriate.
 *
 * Fails CLOSED: if listFactors errors, we assume the user might have
 * MFA enrolled and route them to /mfa-verify, which self-heals when
 * no verified factor exists (its own check redirects to /app).
 */
async function enforceMfa(): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { data: factorsData, error: factorsErr } =
    await supabase.auth.mfa.listFactors();

  // Fail-closed on listFactors error so a transient Supabase blip can't
  // silently disable MFA for an enrolled user. /mfa-verify itself
  // bounces back to /app if the user actually has no verified factor.
  if (factorsErr) {
    redirect(buildMfaVerifyUrl(await getRequestPath()));
  }

  const hasVerifiedFactor = (factorsData?.totp ?? []).some(
    (f) => f.status === "verified",
  );

  // Carveout: never-enrolled users (the default) pass through. This
  // preserves the opt-in model AND prevents a redirect loop when a
  // first-time enroller is mid-flow on /app/profile/security.
  if (!hasVerifiedFactor) return;

  const { data: aalData } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aalData?.currentLevel === "aal2") return;

  // aal1 with at least one verified factor → must clear MFA challenge.
  redirect(buildMfaVerifyUrl(await getRequestPath()));
}

/**
 * Best-effort lookup of the current request's pathname so the MFA
 * gate can preserve where the user was headed. Reads the x-pathname
 * header set by middleware.ts. Returns "/app" as a sensible default
 * if middleware isn't running (build-time RSC, etc.).
 */
async function getRequestPath(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const pathname = h.get("x-pathname");
    if (pathname && pathname.startsWith("/")) return pathname;
  } catch {
    // Headers not available in this context (build-time, etc.) — fall through.
  }
  return "/app";
}

/**
 * Build /mfa-verify URL with a safe ?next= param. Mirrors the same
 * allowlist used in /login so a header-spoofed pathname can't be
 * turned into an open redirect.
 */
function buildMfaVerifyUrl(intendedPath: string): string {
  const isSafe =
    intendedPath === "/app" ||
    intendedPath === "/field" ||
    intendedPath.startsWith("/app/") ||
    intendedPath.startsWith("/field/");
  if (!isSafe) return "/mfa-verify";
  return `/mfa-verify?next=${encodeURIComponent(intendedPath)}`;
}

/**
 * Sets the active organization cookie. Call from a server action when the
 * user switches orgs in a future org-switcher UI.
 */
export async function setActiveOrganization(organizationId: string) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
}

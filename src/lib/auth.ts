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
    profile_id: chosen.profile_id,
  };
}

/**
 * Server-side guard. If the user is not signed in OR not in any org, redirects
 * to /login. If `allowed` is provided, also redirects when their role isn't
 * in the allowed list. Returns the membership when access is granted.
 *
 * Use at the top of server components inside protected layouts.
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

  return membership;
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

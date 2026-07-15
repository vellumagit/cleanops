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
    // Distinguish "not signed in" from "signed in but has no ACTIVE membership"
    // (access removed, membership disabled, or invite not yet accepted). The
    // latter used to bounce to /login — which loops (they CAN sign in, they
    // just have no active org) and, when hit from a server action, surfaced as
    // the generic error boundary instead of a clear message. Send them to a
    // dedicated "no access" screen instead.
    const userId = await getCurrentUserId();
    redirect(userId ? "/no-access" : "/login");
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
  // API-route exemption.
  //
  // OAuth callbacks (Stripe Connect, Square Connect, etc.) and a
  // handful of other API routes call requireMembership at the top.
  // Their current pathname is `/api/...` which is NOT in our
  // /mfa-verify allowlist, so a redirect there would (a) drop
  // critical query params like ?code and ?state, breaking the OAuth
  // round-trip, and (b) bounce the user to an HTML page from what
  // was expecting JSON or a 302 to Stripe/Square.
  //
  // These routes have their own narrow auth — OAuth state
  // validation, signed checkout, API-key headers, CRON_SECRET — and
  // don't render UI a user could interact with at aal1, so MFA
  // enforcement at the route-handler entrypoint adds nothing. The
  // user came from a fully-MFA-gated `/app/*` page that already
  // verified aal2 before the API call.
  //
  // If a future API route DOES need the gate, it can call
  // enforceMfa() directly (it's an exported-as-private helper today;
  // promote it if needed).
  const currentPath = await getRequestPath();
  if (currentPath.startsWith("/api/")) return;

  // Wrap the MFA-related Supabase calls in try/catch and FAIL-OPEN
  // on unhandled exceptions. The previous fail-closed shape was
  // crashing every authed page on transient supabase-js errors:
  //
  //   1. supabase.auth.mfa.listFactors() can THROW (vs. returning
  //      { error }) on network blips, expired refresh tokens,
  //      malformed JWTs, or edge-runtime instabilities.
  //   2. The throw propagated up to the page render → Next surfaced
  //      a generic runtime error reference (the @E394 we saw on
  //      /field/jobs).
  //
  // Trade-off accepted: a transient error could let an aal1
  // user reach a page without re-clearing MFA. That window is small
  // and bounded — the login fast-path is the primary enforcement
  // point. The alternative (crash every page on transient errors)
  // is materially worse.
  let factorsData:
    | { totp?: Array<{ status: string }> | null }
    | null = null;
  let factorsCallFailed = false;
  try {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.auth.mfa.listFactors();
    if (result.error) {
      factorsCallFailed = true;
      console.error("[mfa] listFactors returned error:", result.error);
    } else {
      factorsData = result.data;
    }

    if (factorsCallFailed) {
      // Returned error (vs. throw) — still soft-fail, log loud.
      return;
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
    redirect(buildMfaVerifyUrl(currentPath));
  } catch (err) {
    // redirect() throws NEXT_REDIRECT — re-throw so Next can complete
    // the navigation. Anything else (genuine exception in supabase-js,
    // crypto, etc.) is soft-failed.
    if (isNextRedirectError(err)) throw err;
    console.error(
      "[mfa] enforceMfa threw, allowing request to proceed:",
      err,
    );
    return;
  }
}

/**
 * Detect Next.js's `redirect()` sentinel error so our try/catch can
 * re-throw it instead of swallowing the navigation. Next 16 marks the
 * error with a `digest` starting with "NEXT_REDIRECT".
 */
function isNextRedirectError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
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

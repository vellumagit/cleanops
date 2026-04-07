/**
 * Next.js 16 Proxy (formerly known as Middleware).
 *
 * Runs on every matching request BEFORE it reaches a route handler or page.
 *
 * Responsibilities:
 *   1. Refresh the Supabase auth session if it's about to expire — this is
 *      what keeps users logged in across navigations.
 *   2. Gate the (app) and (field) route groups so only authenticated users
 *      can reach them. Unauthenticated users get redirected to /login.
 *
 * Note: We deliberately do NOT do role-based gating here (admin vs employee).
 * That happens in the layouts of (app)/ and (field)/, which can call
 * `getCurrentMembership()` and decide based on the active org.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseProxyClient } from "@/lib/supabase/proxy";

const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/auth/callback",
  "/auth/confirm",
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname === "/favicon.ico") return true;
  return false;
}

export async function proxy(request: NextRequest) {
  const { supabase, response } = createSupabaseProxyClient(request);

  // Refresh the session — this is the key side effect of running this here.
  // Use getClaims() (validated) NOT getSession() (unverified) for any decision.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);

  const { pathname } = request.nextUrl;

  // Authenticated user hitting /login or /signup → bounce to /app
  if (isAuthenticated && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }

  // Unauthenticated user hitting a protected path → bounce to /login
  if (!isAuthenticated && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on everything except static assets and image optimisation.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

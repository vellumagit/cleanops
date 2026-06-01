/**
 * Edge middleware — runs before every matched request.
 *
 * Currently does ONE thing: copy the request pathname into an
 * `x-pathname` header so server components and the auth helpers can
 * read it. Next 16 RSCs don't have direct access to the current URL,
 * but they can read request headers.
 *
 * The pathname is used by `enforceMfa()` in src/lib/auth.ts so an
 * aal1-stuck user trying to reach /app/bookings/abc lands back on
 * /app/bookings/abc after clearing MFA, not on a generic /app dashboard.
 *
 * IMPORTANT: this is exposed as `x-pathname`, NOT `x-pathname` from
 * an arbitrary caller — middleware always overwrites it. The auth
 * helper validates that the value matches a /app or /field prefix
 * before using it as a redirect target.
 *
 * The matcher excludes static assets and Next internals so middleware
 * doesn't run on JS/CSS/image fetches.
 */

import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("x-pathname", request.nextUrl.pathname);
  // Mirror to the REQUEST headers too so RSCs reading via next/headers
  // see the value. Without this, headers() returns the original request
  // which lacks our injection.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  // Match everything EXCEPT static assets, image optimizer, and the
  // Next runtime. Public files (favicon.ico, robots.txt) are also
  // excluded — the auth helper never runs there anyway.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json).*)",
  ],
};

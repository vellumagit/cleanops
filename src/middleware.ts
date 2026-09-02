/**
 * Edge middleware — runs before every matched request.
 *
 * Does ONE thing: copy the request pathname into an `x-pathname`
 * header so server components and the auth helpers can read it.
 * Next 16 RSCs can't directly access the current URL, but they can
 * read request headers.
 *
 * Used by `enforceMfa()` in src/lib/auth.ts so an aal1-stuck user
 * trying to reach /app/bookings/abc lands back on that URL after
 * clearing MFA — not on a generic /app dashboard.
 *
 * Security: the header is always overwritten (not preserved from any
 * arbitrary caller). The auth helper additionally validates the
 * value matches /app or /field before using it as a redirect target,
 * so a spoofed header in some forwarded scenario can't become an
 * open redirect.
 *
 * Scope: /app and /field ONLY — the two trees behind requireMembership(),
 * which is the sole consumer of the header (via enforceMfa's getRequestPath,
 * whose redirect allowlist accepts nothing else anyway). Everything else —
 * the marketing pages, /login, the client portal, the public token routes,
 * /api/* with its own auth — was being run through an edge function to be
 * handed a header nobody reads, and had its request headers rewritten for
 * nothing. Each excluded path is one less edge invocation billed and one
 * less mutation standing between the request and a cacheable response.
 */

import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Mirror the pathname onto REQUEST headers so RSCs reading via
  // next/headers see it. NextResponse.next({ request: { headers } })
  // is the mechanism Next exposes for this.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  // The header exists for the MFA gate, and the MFA gate only runs inside
  // requireMembership() — /app and /field. A positive matcher states that
  // directly, instead of a negative one that has to be kept in step with
  // every new asset extension and public route the app grows.
  matcher: ["/app/:path*", "/field/:path*"],
};

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
 * Scope: narrowed to exclude /api/* (those routes have their own auth
 * — API keys, CRON_SECRET, OAuth state — and don't need x-pathname),
 * Next internals, and common static asset extensions. Every excluded
 * path is one less edge invocation Vercel bills + measurable latency
 * savings on hot paths like Stripe webhooks.
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
  // Match everything EXCEPT:
  //   - /api/*          (own auth; no MFA-redirect concept; saves edge invocations on webhooks, crons, v1 routes)
  //   - _next internals (build artifacts, image optimizer)
  //   - public files     (favicon, robots, sitemap, manifest, sw.js, .well-known)
  //   - static assets    (common extensions for images, fonts, css, js, sourcemaps)
  matcher: [
    "/((?!api/|_next/|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.json|sw\\.js|\\.well-known/|.*\\.(?:png|svg|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|map)$).*)",
  ],
};

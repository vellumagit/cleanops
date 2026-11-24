/**
 * Edge middleware — runs before every matched request.
 *
 * Does two things:
 *
 * 1. Refreshes an expired Supabase session ONCE, here, where the new
 *    cookie can be saved. A page render cannot write cookies, so until
 *    2026-11-24 nothing saved a refresh: a person whose access token had
 *    expired (an hour, by default) got a page that worked, while every
 *    page view asked Supabase Auth for a new token five to ten times and
 *    threw each one away, until their first server action happened to
 *    save one. The root proxy.ts was written to do this but sat where
 *    Next never looked (the app is under src/), so it never ran.
 *
 * 2. Copies the request pathname into an `x-pathname` header so server
 *    components and the auth helpers can read it. Next 16 RSCs can't
 *    directly access the current URL, but they can read request headers.
 *    Used by `enforceMfa()` in src/lib/auth.ts so an aal1-stuck user
 *    trying to reach /app/bookings/abc lands back on that URL after
 *    clearing MFA — not on a generic /app dashboard.
 *
 * The refresh decides nothing. It never redirects and never reads who the
 * person is: the layouts' requireMembership() still does all of that, with
 * getClaims(). That is why it can use getSession(), which costs no network
 * call while the token is still good (getClaims() may ask the Auth server
 * every time). When the token has expired it makes the one refresh call
 * and the new cookie goes two ways: onto the request, so the render below
 * sees a good token and does not refresh again, and onto the response, so
 * the browser keeps it. When Auth refuses the refresh (the session was
 * ended elsewhere), supabase-js clears the cookie the same way and the
 * layout sends the person to /login. If anything here throws, the request
 * goes on exactly as it did before this existed.
 *
 * Security: the x-pathname header is always overwritten (not preserved
 * from any arbitrary caller). The auth helper additionally validates the
 * value matches /app or /field before using it as a redirect target, so a
 * spoofed header in some forwarded scenario can't become an open redirect.
 *
 * Scope: /app and /field ONLY — the two trees behind requireMembership().
 * Everything else — the marketing pages, /login, the public token routes,
 * /api/* with its own auth — would be run through an edge function for
 * nothing. Each excluded path is one less edge invocation billed and one
 * less mutation standing between the request and a cacheable response.
 * (The client portal, /client, has the same expired-token pattern and is
 * not covered here yet.)
 *
 * Kept as `middleware` on the Edge runtime on purpose: renaming it to
 * `proxy` moves it to Node.js, which Next's upgrade guide says not to do
 * blindly (node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md).
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type Written = {
  cookies: Array<{ name: string; value: string; options: CookieOptions }>;
  /** No-cache headers @supabase/ssr asks for alongside an auth cookie. */
  headers: Record<string, string>;
};

/**
 * Refresh the session if it has expired, writing any new cookie onto the
 * request. Returns what the response must carry back to the browser.
 */
async function refreshSession(request: NextRequest): Promise<Written> {
  const written: Written = { cookies: [], headers: {} };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return written;
  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookies, headers) {
          for (const { name, value } of cookies) {
            if (value) request.cookies.set(name, value);
            else request.cookies.delete(name);
          }
          written.cookies.push(...cookies);
          Object.assign(written.headers, headers);
        },
      },
    });
    await supabase.auth.getSession();
  } catch {
    // Fail open: the render does what it always did.
  }
  return written;
}

export async function middleware(request: NextRequest) {
  // First, so the headers copied below carry the refreshed cookie.
  const refreshed = await refreshSession(request);

  // Mirror the pathname onto REQUEST headers so RSCs reading via
  // next/headers see it. NextResponse.next({ request: { headers } })
  // is the mechanism Next exposes for this.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  for (const { name, value, options } of refreshed.cookies) {
    response.cookies.set(name, value, options);
  }
  for (const [name, value] of Object.entries(refreshed.headers)) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  // The header exists for the MFA gate, and the MFA gate only runs inside
  // requireMembership() — /app and /field. A positive matcher states that
  // directly, instead of a negative one that has to be kept in step with
  // every new asset extension and public route the app grows.
  matcher: ["/app/:path*", "/field/:path*"],
};

/**
 * Supabase client for the Next.js 16 proxy (formerly middleware).
 *
 * This is a special variant of the server client that operates on the
 * NextRequest / NextResponse cookie jar instead of the React `cookies()` API,
 * because the proxy runs before the request reaches a route handler or page
 * and needs to refresh the auth session cookies on the response.
 *
 * Usage: only from `proxy.ts` at the project root.
 */

import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { Database } from "./types";

export function createSupabaseProxyClient(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Mutate the request's cookie jar so any downstream code in the
          // same proxy run sees the new values.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          // And rebuild the response so the browser receives the Set-Cookie
          // headers from the refresh.
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  return { supabase, response };
}

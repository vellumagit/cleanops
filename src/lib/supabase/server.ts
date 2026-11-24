/**
 * Server-side Supabase client.
 *
 * Use this in:
 *   - React Server Components
 *   - Server Actions
 *   - Route Handlers (`src/app/api/...`)
 *
 * It reads/writes auth cookies on the request, so the user's session flows
 * naturally through the server. RLS is enforced — this client uses the public
 * anon key and the user's JWT, NOT the service role key.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";
import { guardQueries } from "./query-guard";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  // See ./query-guard — a failed query must never look like an empty one.
  return guardQueries(
    createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // The `setAll` method was called from a Server Component,
            // which cannot write cookies. Under /app, /field and /client,
            // src/middleware.ts has already refreshed and saved an expired
            // session before the render. Elsewhere a refreshed token is
            // saved only when a server action or route handler makes the
            // call.
          }
        },
      },
    },
  ),
  );
}

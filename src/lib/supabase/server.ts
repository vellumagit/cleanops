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

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
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
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    },
  );
}

/**
 * Browser-side Supabase client.
 *
 * Use this in client components (`"use client"`) for things like:
 *   - Realtime subscriptions
 *   - Optimistic UI updates
 *   - Live form fields that need an immediate read
 *
 * Prefer the server client whenever possible. This client uses the public
 * anon key and the user's session cookie. RLS is enforced — never expose
 * the service role key here.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/**
 * Service-role Supabase client.
 *
 * !! SERVER ONLY. NEVER IMPORT FROM A CLIENT COMPONENT. !!
 *
 * This client bypasses Row-Level Security entirely. It uses the
 * SUPABASE_SERVICE_ROLE_KEY env var (which must NEVER be prefixed with
 * NEXT_PUBLIC_ and must NEVER ship to the browser).
 *
 * Use this only for:
 *   - The seed script
 *   - Webhook handlers that act on behalf of the system (Stripe, etc)
 *   - Cron / background jobs
 *   - Specific server actions where you have already verified the caller's
 *     authorization manually and need to perform an operation that RLS
 *     would block (rare — usually a sign you should fix the RLS policy
 *     instead).
 */

import "server-only";

import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  }
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

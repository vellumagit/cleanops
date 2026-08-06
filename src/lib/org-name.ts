import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * An organization's display name, fetched without relying on RLS.
 *
 * This exists because a CLIENT cannot read `organizations` at all. The only
 * SELECT policy on that table is "members can read their orgs"
 * (20260407044907_init_auth_orgs.sql:241), gated on current_user_org_ids(),
 * which reads `memberships` — and a portal client has no membership row.
 *
 * src/lib/client-auth.ts used to resolve the org name with an
 * `organizations!inner(name)` embed. Under RLS the embed came back empty, the
 * `!inner` join then dropped the parent `clients` row, getCurrentClient()
 * returned null, and requireClient() redirected to /client/login — which calls
 * the same helper. Every client who ever set a password landed in an infinite
 * bounce between the login page and the portal. It is why no client in any org
 * has ever successfully signed in.
 *
 * Same shape as getOrgTimezone: admin client, cache()'d per request, and a
 * lookup miss degrades to a blank name rather than blocking the page. A
 * display name is not an authorization decision — the caller has already
 * proven which client row it owns before asking for it.
 */
export const getOrgName = cache(
  async (organizationId: string): Promise<string> => {
    try {
      const admin = createSupabaseAdminClient();
      const { data } = (await admin
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .maybeSingle()) as unknown as {
        data: { name: string | null } | null;
      };
      return data?.name ?? "";
    } catch {
      return "";
    }
  },
);

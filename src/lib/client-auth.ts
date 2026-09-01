import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgName } from "@/lib/org-name";

export type CurrentClient = {
  id: string;
  organization_id: string;
  organization_name: string;
  name: string;
  email: string | null;
  profile_id: string;
};

/**
 * Resolve the signed-in user to a client row. Returns null if they're
 * not authenticated OR they're authenticated but not linked to any
 * client record.
 *
 * Clients and org-members share the same auth.users pool but live in
 * different schemas: memberships.profile_id vs clients.profile_id. A
 * person could in theory be both (edge case); this helper only finds
 * the client-side mapping.
 */
/**
 * Why there is no client, when there is no client.
 *
 * "Signed out" and "signed in as somebody who isn't a client" both used to
 * collapse to null, and both then redirected to /client/login — which asks the
 * same question, gets the same null, and renders the sign-in form again. A
 * correctly authenticated person with no client row could sign in truthfully,
 * forever, and never move. Callers need to tell the two apart.
 */
export type ClientAuthState =
  | { status: "anonymous" }
  | { status: "not-a-client"; userId: string; email: string | null }
  | { status: "ok"; client: CurrentClient };

export async function getClientAuthState(): Promise<ClientAuthState> {
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { status: "anonymous" };

  // Archived clients don't resolve — this is THE portal lock. Their login
  // still authenticates, but with no client row behind it they land on the
  // sign-in flow like any stranger. Restoring the client (archived_at back
  // to null) restores access with no re-invite.
  const { data } = await supabase
    .from("clients")
    .select("id, organization_id, name, email, profile_id")
    .eq("profile_id", userId)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();

  if (!data) {
    return {
      status: "not-a-client",
      userId,
      email: (claims?.claims?.email as string | undefined) ?? null,
    };
  }

  return {
    status: "ok",
    client: {
      id: data.id,
      organization_id: data.organization_id,
      organization_name: await getOrgName(data.organization_id),
      name: data.name,
      email: data.email,
      profile_id: data.profile_id!,
    },
  };
}

export async function getCurrentClient(): Promise<CurrentClient | null> {
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  // NO organizations embed here. A client has no memberships row, so the only
  // SELECT policy on organizations excludes them entirely; an `!inner` embed
  // therefore came back empty and dropped this row, and every client bounced
  // between /client and /client/login forever. The org name is fetched
  // separately, past RLS, once the client row has proven who they are.
  const { data, error } = await supabase
    .from("clients")
    .select("id, organization_id, name, email, profile_id")
    .eq("profile_id", userId)
    // Same archived lock as getClientAuthState above.
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    organization_id: data.organization_id,
    organization_name: await getOrgName(data.organization_id),
    name: data.name,
    email: data.email,
    profile_id: data.profile_id!,
  };
}

/**
 * Guard used at the top of every /client/* server component. Redirects
 * to /client/login when not signed in, or to the dashboard if signed in
 * as a non-client (e.g. an org member who also has an account).
 */
export async function requireClient(): Promise<CurrentClient> {
  const client = await getCurrentClient();
  if (!client) {
    redirect("/client/login");
  }
  return client;
}

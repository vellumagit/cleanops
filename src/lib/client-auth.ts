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

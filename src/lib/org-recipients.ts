import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type OrgRecipient = {
  profileId: string;
  fullName: string | null;
  email: string;
};

/**
 * Resolve the people who manage an org's operations (owner / admin /
 * manager) as email recipients. Emails live on auth.users, fetched via the
 * admin API. Used for internal ops notifications like shift accept/decline —
 * "the account(s) that sent the job to the employee".
 */
export async function getOrgManagementRecipients(
  orgId: string,
): Promise<OrgRecipient[]> {
  const db = createSupabaseAdminClient();
  const { data: members } = (await db
    .from("memberships")
    .select("profile_id, profile:profiles ( full_name )")
    .eq("organization_id", orgId)
    .in("role", ["owner", "admin", "manager"])
    .eq("status", "active")
    .not("profile_id", "is", null)) as unknown as {
    data: Array<{
      profile_id: string | null;
      profile: { full_name: string | null } | null;
    }> | null;
  };

  const recipients: OrgRecipient[] = [];
  for (const m of members ?? []) {
    if (!m.profile_id) continue;
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${m.profile_id}`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        },
      },
    );
    if (!res.ok) continue;
    const u = (await res.json()) as { email?: string };
    if (!u.email) continue;
    recipients.push({
      profileId: m.profile_id,
      fullName: m.profile?.full_name ?? null,
      email: u.email,
    });
  }
  return recipients;
}

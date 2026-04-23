import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { memberDisplayName } from "@/lib/member-display";
import { MembersTable, type MemberRow } from "./members-table";

export const metadata = { title: "Team members" };

export default async function MembersPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("memberships")
    .select(
      `
        id,
        role,
        status,
        pay_rate_cents,
        created_at,
        profile_id,
        display_name,
        profile:profiles ( full_name, phone, avatar_url )
      `,
    )
    .eq("organization_id", membership.organization_id)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const rows: MemberRow[] = (data ?? []).map((m) => ({
    id: m.id,
    profile_id: m.profile_id,
    role: m.role,
    status: m.status,
    pay_rate_cents: m.pay_rate_cents,
    created_at: m.created_at,
    full_name: memberDisplayName(m),
    phone: m.profile?.phone ?? null,
    is_self: m.profile_id === membership.profile_id,
  }));

  return (
    <PageShell
      title="Team members"
      description="Manage roles, pay rates, and access for your team."
    >
      <MembersTable rows={rows} currentRole={membership.role} />
    </PageShell>
  );
}

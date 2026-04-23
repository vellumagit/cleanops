import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { memberDisplayName } from "@/lib/member-display";
import { EmployeesTable, type EmployeeRow } from "./employees-table";
import { PendingInvitations, type InvitationRow } from "./pending-invitations";
import { InviteDialog } from "./invite-dialog";
import { AddManualEmployeeDialog } from "./add-manual-dialog";

export const metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();
  const isAdmin = membership.role === "owner" || membership.role === "admin";
  const canInvite = isAdmin; // managers can view but not invite
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

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
        contact_email,
        contact_phone,
        profile:profiles ( full_name, phone )
      `,
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  const rows: EmployeeRow[] = (data ?? []).map((m) => ({
    id: m.id,
    role: m.role,
    status: m.status,
    pay_rate_cents: m.pay_rate_cents,
    created_at: m.created_at,
    full_name: memberDisplayName(m),
    phone: m.contact_phone ?? m.profile?.phone ?? null,
    // Shadow memberships have no linked profile, so no login / no app access.
    is_shadow: m.profile_id === null,
  }));

  // Fetch pending invitations (only visible to admins/owners)
  let invitations: InvitationRow[] = [];
  if (isAdmin) {
    const { data: inviteData } = await supabase
      .from("invitations")
      .select("id, email, role, token, created_at, expires_at, accepted_at")
      .eq("organization_id", membership.organization_id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false })
      .limit(100);

    // Capture "now" once so every row uses the same reference point.
    // Server component — deterministic per request.
    // eslint-disable-next-line react-hooks/purity
    const nowMs = Date.now();
    invitations = (inviteData ?? []).map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      token: inv.token,
      created_at: inv.created_at,
      expires_at: inv.expires_at,
      expired: new Date(inv.expires_at).getTime() < nowMs,
    }));
  }

  return (
    <PageShell
      title="Employees"
      description="Cleaners, team leads, and admins on your team."
      actions={
        isAdmin ? (
          <div className="flex items-center gap-2">
            <AddManualEmployeeDialog />
            <InviteDialog siteUrl={siteUrl} />
          </div>
        ) : undefined
      }
    >
      {isAdmin && invitations.length > 0 && (
        <PendingInvitations invitations={invitations} siteUrl={siteUrl} />
      )}
      <EmployeesTable rows={rows} />
    </PageShell>
  );
}

import { toEngagement } from "@/lib/engagement";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { memberDisplayName } from "@/lib/member-display";
import { EmployeesTable, type EmployeeRow } from "./employees-table";
import { PendingInvitations, type InvitationRow } from "./pending-invitations";
import { InviteDialog } from "./invite-dialog";
import { AddManualEmployeeDialog } from "./add-manual-dialog";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const tz = await getOrgTimezone(membership.organization_id);
  const supabase = await createSupabaseServerClient();
  const isAdmin = membership.role === "owner" || membership.role === "admin";
  const canInvite = isAdmin; // managers can view but not invite
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  // Use admin client because pay_rate_cents is RLS-locked from end-
  // user JWTs (migration 20260601040000). Explicit org filter keeps
  // the bypass from leaking other orgs' data.
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("memberships")
    .select(
      `
        id,
        role,
        status,
        pay_rate_cents,
        engagement,
        created_at,
        profile_id,
        display_name,
        contact_email,
        contact_phone,
        profile:profiles ( full_name, phone )
      `,
    )
    .eq("organization_id", membership.organization_id)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  // Cast, not `as never` on the select: one column PostgREST's generated types
  // don't know about turns the ENTIRE row type into SelectQueryError, so every
  // field below stops resolving. Drop this cast once the types are regenerated
  // against 20260808010000.
  type MemberRow = {
    id: string;
    role: "owner" | "admin" | "manager" | "employee";
    status: "active" | "invited" | "disabled";
    pay_rate_cents: number | null;
    engagement: string | null;
    created_at: string;
    profile_id: string | null;
    display_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    profile: { full_name: string | null; phone: string | null } | null;
  };

  const rows: EmployeeRow[] = ((data ?? []) as unknown as MemberRow[]).map((m) => ({
    id: m.id,
    role: m.role,
    status: m.status,
    pay_rate_cents: m.pay_rate_cents,
    engagement: toEngagement(m.engagement),
    created_at: m.created_at,
    full_name: memberDisplayName(m),
    phone: m.contact_phone ?? m.profile?.phone ?? null,
    contact_email: m.contact_email ?? null,
    contact_phone: m.contact_phone ?? null,
    // Shadow memberships have no linked profile, so no login / no app access.
    is_shadow: m.profile_id === null,
    is_self: m.id === membership.id,
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
        <PendingInvitations
          tz={tz}
          invitations={invitations}
          siteUrl={siteUrl}
        />
      )}
      <EmployeesTable tz={tz} rows={rows} viewerRole={membership.role} />
    </PageShell>
  );
}

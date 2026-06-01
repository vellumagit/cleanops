import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { memberDisplayName } from "@/lib/member-display";
import {
  EmployeeEditForm,
  type EmployeeEditDefaults,
} from "./employee-edit-form";
import { DeleteEmployeeForm } from "./delete-employee-form";
import { ForceDeleteForm } from "./force-delete-form";
import { RecoveryLinkCard } from "./recovery-link-card";

export const metadata = { title: "Edit employee" };

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireMembership(["owner", "admin"]);
  const { id } = await params;

  // Use admin client so we can read memberships across the org without RLS
  // complications — the access check above (owner/admin) is the gate.
  const admin = createSupabaseAdminClient();

  const { data: member, error } = (await admin
    .from("memberships")
    .select(
      "id, organization_id, profile_id, role, status, pay_rate_cents, display_name, contact_email, contact_phone, profile:profiles(full_name, phone)",
    )
    .eq("id", id)
    .eq("organization_id", viewer.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      profile_id: string | null;
      role: "owner" | "admin" | "manager" | "employee";
      status: "active" | "invited" | "disabled";
      pay_rate_cents: number | null;
      display_name: string | null;
      contact_email: string | null;
      contact_phone: string | null;
      profile: { full_name: string | null; phone: string | null } | null;
    } | null;
    error: { message: string } | null;
  };

  // Notes and address live in the admin-only membership_admin_data table.
  // Fetched separately so the blanket memberships SELECT policy can't expose
  // these fields to employees querying the Supabase REST API directly.
  const { data: adminData } = (await admin
    .from("membership_admin_data" as never)
    .select("notes, address")
    .eq("membership_id" as never, id as never)
    .maybeSingle()) as unknown as {
    data: { notes: string | null; address: string | null } | null;
  };

  if (error) throw error;
  if (!member) notFound();

  const isSelf = member.id === viewer.id;

  // Derive the display name the form should pre-fill:
  // If there's an admin override (display_name) use that; otherwise fall
  // back to their profile name. Shadow employees only have display_name.
  const currentDisplayName = memberDisplayName({
    display_name: member.display_name,
    profile: member.profile,
  });

  const defaults: EmployeeEditDefaults = {
    display_name: currentDisplayName,
    contact_email: member.contact_email,
    contact_phone: member.contact_phone ?? member.profile?.phone ?? null,
    address: adminData?.address ?? null,
    notes: adminData?.notes ?? null,
    role: member.role,
    pay_rate_cents: member.pay_rate_cents,
    status: member.status,
    is_shadow: member.profile_id === null,
  };

  return (
    <PageShell
      title="Edit employee"
      description={currentDisplayName}
      actions={
        <Link
          href="/app/employees"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <div className="max-w-2xl space-y-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <EmployeeEditForm
            memberId={member.id}
            defaults={defaults}
            viewerRole={viewer.role as "owner" | "admin" | "manager" | "employee"}
            isSelf={isSelf}
          />
        </div>

        {/* Emergency password recovery — hand-deliverable reset link for
            when the employee can't reset themselves (email rate-limited,
            stuck in spam, lost access to inbox, etc). Hidden for shadow
            members (no auth account) and for self-edit (use the normal
            settings flow on your own account). */}
        {!defaults.is_shadow && !isSelf && (
          <RecoveryLinkCard
            memberId={member.id}
            memberName={currentDisplayName}
          />
        )}

        {/* Danger zone — two flavors of delete for owners.
            "Delete employee" is the gentle path: requires the member to
            be Disabled first, leaves their auth login account intact.
            "Force-remove" is the nuclear path: works on any status and
            also wipes the auth user. Use this when an account is broken
            (couldn't reset password, never accepted invite, MFA-stuck)
            and you want a clean slate to re-invite from. */}
        {viewer.role === "owner" && !isSelf && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
            <h2 className="text-sm font-semibold text-destructive">
              Danger zone
            </h2>

            {member.status === "disabled" && (
              <div className="mt-3 border-b border-destructive/20 pb-4">
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">Delete employee.</strong>{" "}
                  Permanently removes this employee from your organization but
                  leaves their login account intact. Historical bookings and
                  timesheets that reference them are preserved — their name
                  will show as &ldquo;Unknown&rdquo; on those records.
                  Employees with payroll run history cannot be deleted.
                </p>
                <div className="mt-3">
                  <DeleteEmployeeForm
                    memberId={member.id}
                    name={currentDisplayName}
                  />
                </div>
              </div>
            )}

            <div className={member.status === "disabled" ? "mt-4" : "mt-3"}>
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">Force-remove.</strong>{" "}
                Removes this employee AND deletes their login account in one
                step. Use when the account is broken or stuck and you want to
                re-invite the same email from scratch. Works regardless of
                status.
              </p>
              <div className="mt-3">
                <ForceDeleteForm
                  memberId={member.id}
                  name={currentDisplayName}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}

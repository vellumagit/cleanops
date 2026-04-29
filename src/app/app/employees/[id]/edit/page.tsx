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
      "id, organization_id, profile_id, role, status, pay_rate_cents, display_name, contact_email, contact_phone, address, notes, profile:profiles(full_name, phone)",
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
      address: string | null;
      notes: string | null;
      profile: { full_name: string | null; phone: string | null } | null;
    } | null;
    error: { message: string } | null;
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
    address: member.address,
    notes: member.notes,
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
      <div className="max-w-2xl">
        <div className="rounded-lg border border-border bg-card p-6">
          <EmployeeEditForm
            memberId={member.id}
            defaults={defaults}
            viewerRole={viewer.role as "owner" | "admin" | "manager" | "employee"}
            isSelf={isSelf}
          />
        </div>
      </div>
    </PageShell>
  );
}

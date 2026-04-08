import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { EmployeesTable, type EmployeeRow } from "./employees-table";

export const metadata = { title: "Employees" };

export default async function EmployeesPage() {
  await requireMembership();
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
        profile:profiles ( full_name, phone )
      `,
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows: EmployeeRow[] = (data ?? []).map((m) => ({
    id: m.id,
    role: m.role,
    status: m.status,
    pay_rate_cents: m.pay_rate_cents,
    created_at: m.created_at,
    full_name: m.profile?.full_name ?? "Unnamed",
    phone: m.profile?.phone ?? null,
  }));

  return (
    <PageShell
      title="Employees"
      description="Cleaners, team leads, and admins on your team."
    >
      <EmployeesTable rows={rows} />
    </PageShell>
  );
}

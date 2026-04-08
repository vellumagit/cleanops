import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ContractsTable, type ContractRow } from "./contracts-table";

export const metadata = { title: "Contracts" };

export default async function ContractsPage() {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("contracts")
    .select(
      `
        id,
        status,
        service_type,
        start_date,
        end_date,
        agreed_price_cents,
        payment_terms,
        client:clients ( name )
      `,
    )
    .order("start_date", { ascending: false })
    .limit(200);

  if (error) throw error;

  const rows: ContractRow[] = (data ?? []).map((c) => ({
    id: c.id,
    status: c.status,
    service_type: c.service_type,
    start_date: c.start_date,
    end_date: c.end_date,
    agreed_price_cents: c.agreed_price_cents,
    payment_terms: c.payment_terms,
    client_name: c.client?.name ?? "—",
  }));

  return (
    <PageShell
      title="Contracts"
      description="Active and past service agreements with clients."
      actions={
        canEdit ? (
          <Link
            href="/app/contracts/new"
            className={buttonVariants({ variant: "default" })}
          >
            <Plus className="h-4 w-4" />
            New contract
          </Link>
        ) : null
      }
    >
      <ContractsTable rows={rows} canEdit={canEdit} />
    </PageShell>
  );
}

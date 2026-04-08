import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { InvoicesTable, type InvoiceRow } from "./invoices-table";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("invoices")
    .select(
      `
        id,
        status,
        amount_cents,
        due_date,
        sent_at,
        paid_at,
        created_at,
        client:clients ( name )
      `,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;

  const rows: InvoiceRow[] = (data ?? []).map((i) => ({
    id: i.id,
    status: i.status,
    amount_cents: i.amount_cents,
    due_date: i.due_date,
    sent_at: i.sent_at,
    paid_at: i.paid_at,
    created_at: i.created_at,
    client_name: i.client?.name ?? "—",
  }));

  return (
    <PageShell
      title="Invoices"
      description="Bills sent to clients. Auto-generatable from completed bookings."
      actions={
        canEdit ? (
          <Link
            href="/app/invoices/new"
            className={buttonVariants({ variant: "default" })}
          >
            <Plus className="h-4 w-4" />
            New invoice
          </Link>
        ) : null
      }
    >
      <InvoicesTable rows={rows} canEdit={canEdit} />
    </PageShell>
  );
}

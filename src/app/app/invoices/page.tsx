import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgCurrency } from "@/lib/org-currency";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ArchivedToggle } from "@/components/archived-toggle";
import { InvoicesTable, type InvoiceRow } from "./invoices-table";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);
  const { archived } = await searchParams;
  const showArchived = archived === "1";

  let query = supabase
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
    );

  query = showArchived
    ? query.not("archived_at" as never, "is" as never, null as never)
    : query.is("archived_at" as never, null as never);

  const { data, error } = await query
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
      title={showArchived ? "Invoices — archived" : "Invoices"}
      description={
        showArchived
          ? "Paid or voided invoices older than your archive threshold."
          : "Bills sent to clients. Auto-generatable from completed bookings."
      }
      actions={
        <div className="flex items-center gap-2">
          <ArchivedToggle
            basePath="/app/invoices"
            showingArchived={showArchived}
          />
          {canEdit && !showArchived && (
            <Link
              href="/app/invoices/new"
              className={buttonVariants({ variant: "default" })}
            >
              <Plus className="h-4 w-4" />
              New invoice
            </Link>
          )}
        </div>
      }
    >
      <InvoicesTable
        rows={rows}
        canEdit={canEdit && !showArchived}
        currency={currency}
      />
    </PageShell>
  );
}

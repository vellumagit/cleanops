import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { centsToDollarString } from "@/lib/validators/common";
import { InvoiceForm } from "../../invoice-form";
import { fetchInvoiceFormOptions } from "../../options";
import { DeleteInvoiceForm } from "./delete-form";

export const metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMembership(["owner", "admin"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select(
      "id, client_id, booking_id, status, amount_cents, due_date",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!invoice) notFound();

  const { clients, bookings } = await fetchInvoiceFormOptions();

  return (
    <PageShell title="Edit invoice">
      <div className="max-w-2xl space-y-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <InvoiceForm
            mode="edit"
            id={invoice.id}
            clients={clients}
            bookings={bookings}
            defaults={{
              client_id: invoice.client_id,
              booking_id: invoice.booking_id,
              status: invoice.status,
              amount_dollars: centsToDollarString(invoice.amount_cents),
              due_date: invoice.due_date,
            }}
          />
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Deleting will remove this invoice and any line items.
          </p>
          <div className="mt-4">
            <DeleteInvoiceForm id={invoice.id} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}

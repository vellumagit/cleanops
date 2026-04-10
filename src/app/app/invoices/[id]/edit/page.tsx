import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { centsToDollarString } from "@/lib/validators/common";
import { InvoiceForm } from "../../invoice-form";
import { fetchInvoiceFormOptions } from "../../options";
import { DeleteInvoiceForm } from "./delete-form";
import { LineItemsEditor, type ExistingLineItem } from "./line-items-editor";

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
      `id, client_id, booking_id, status, amount_cents, due_date,
       line_items:invoice_line_items ( id, label, quantity, unit_price_cents, sort_order )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!invoice) notFound();

  const { clients, bookings } = await fetchInvoiceFormOptions();

  const lineItems: ExistingLineItem[] = (invoice.line_items ?? []).map((li) => ({
    id: li.id,
    label: li.label,
    quantity: li.quantity,
    unit_price_cents: li.unit_price_cents,
    sort_order: li.sort_order,
  }));

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
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Line items</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Add services, fees, and extras. Saving line items will
            recompute the invoice total automatically.
          </p>
          <div className="mt-4">
            <LineItemsEditor invoiceId={invoice.id} existing={lineItems} />
          </div>
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

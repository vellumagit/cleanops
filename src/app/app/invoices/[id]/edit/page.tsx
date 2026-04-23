import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgCurrency } from "@/lib/org-currency";
import { taxRateBpsToPercentString } from "@/lib/org-tax";
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
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);

  const { data: invoice, error } = (await supabase
    .from("invoices")
    .select(
      `id, client_id, booking_id, status, amount_cents, due_date,
       tax_rate_bps, tax_amount_cents, tax_label,
       line_items:invoice_line_items ( id, label, quantity, unit_price_cents, sort_order )`,
    )
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data:
      | {
          id: string;
          client_id: string;
          booking_id: string | null;
          status: string;
          amount_cents: number;
          due_date: string | null;
          tax_rate_bps: number | null;
          tax_amount_cents: number | null;
          tax_label: string | null;
          line_items:
            | Array<{
                id: string;
                label: string;
                quantity: number;
                unit_price_cents: number;
                sort_order: number;
              }>
            | null;
        }
      | null;
    error: { message: string } | null;
  };

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

  // The form edits the SUBTOTAL; amount_cents in the DB is the total
  // (subtotal + tax). Derive subtotal for the form by backing tax out.
  const subtotalCents =
    invoice.amount_cents - (invoice.tax_amount_cents ?? 0);

  return (
    <PageShell title="Edit invoice">
      <div className="max-w-2xl space-y-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <InvoiceForm
            mode="edit"
            id={invoice.id}
            currency={currency}
            clients={clients}
            bookings={bookings}
            defaults={{
              client_id: invoice.client_id,
              booking_id: invoice.booking_id,
              status: invoice.status,
              subtotal_dollars: centsToDollarString(subtotalCents),
              due_date: invoice.due_date,
              tax_rate_percent: taxRateBpsToPercentString(invoice.tax_rate_bps),
              tax_label: invoice.tax_label,
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

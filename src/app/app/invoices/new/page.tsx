import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { InvoiceForm } from "../invoice-form";
import { fetchInvoiceFormOptions } from "../options";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  await requireMembership(["owner", "admin", "manager"]);
  const { clients, bookings } = await fetchInvoiceFormOptions();

  return (
    <PageShell title="New invoice" description="Bill a client for work delivered.">
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <InvoiceForm mode="create" clients={clients} bookings={bookings} />
      </div>
    </PageShell>
  );
}

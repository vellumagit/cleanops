import { requireMembership } from "@/lib/auth";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTaxDefaults, taxRateBpsToPercentString } from "@/lib/org-tax";
import { PageShell } from "@/components/page-shell";
import { InvoiceForm } from "../invoice-form";
import { fetchInvoiceFormOptions } from "../options";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const { clients, bookings } = await fetchInvoiceFormOptions();
  const currency = await getOrgCurrency(membership.organization_id);
  const taxDefaults = await getOrgTaxDefaults(membership.organization_id);

  return (
    <PageShell title="New invoice" description="Bill a client for work delivered.">
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <InvoiceForm
          mode="create"
          clients={clients}
          bookings={bookings}
          currency={currency}
          orgDefaultTaxRatePercent={taxRateBpsToPercentString(
            taxDefaults.rateBps,
          )}
          orgDefaultTaxLabel={taxDefaults.label ?? ""}
        />
      </div>
    </PageShell>
  );
}

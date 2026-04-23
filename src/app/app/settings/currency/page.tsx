import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTaxDefaults, taxRateBpsToPercentString } from "@/lib/org-tax";
import { PageShell } from "@/components/page-shell";
import { CurrencyForm } from "./currency-form";
import { TaxForm } from "./tax-form";

export const metadata = { title: "Currency & tax" };

export default async function CurrencySettingsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const current = await getOrgCurrency(membership.organization_id);
  const taxDefaults = await getOrgTaxDefaults(membership.organization_id);

  return (
    <PageShell
      title="Currency & tax"
      description="How invoice amounts display, and the default tax (GST, HST, VAT, etc.) applied to new invoices."
      actions={
        <Link
          href="/app/settings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Settings
        </Link>
      }
    >
      <div className="space-y-10">
        <section>
          <h2 className="text-sm font-semibold">Currency</h2>
          <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
            What currency your invoices, estimates, and dashboard metrics
            display in.
          </p>
          <CurrencyForm current={current} />
        </section>

        <section className="border-t border-border pt-8">
          <h2 className="text-sm font-semibold">Default tax</h2>
          <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
            Pre-fill this on every new invoice. Each invoice still has its
            own toggle if you need to issue one without tax.
          </p>
          <TaxForm
            currentRatePercent={taxRateBpsToPercentString(taxDefaults.rateBps)}
            currentLabel={taxDefaults.label ?? ""}
          />
        </section>
      </div>
    </PageShell>
  );
}

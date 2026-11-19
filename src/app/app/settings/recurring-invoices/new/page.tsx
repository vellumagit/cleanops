import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { RecurringInvoiceForm } from "../form";
import { getOrgCurrency } from "@/lib/org-currency";
import { formatTaxRate } from "@/lib/invoice-tax";

export const metadata = { title: "New recurring invoice" };

export default async function NewRecurringInvoicePage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const supabase = await createSupabaseServerClient();

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .order("name");

  const currency = await getOrgCurrency(membership.organization_id);
  // The company's own tax setting starts a new series; it can be changed or
  // switched off on the form.
  const { data: org } = (await supabase
    .from("organizations")
    .select("default_tax_rate_bps, default_tax_label")
    .eq("id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: { default_tax_rate_bps: number | null; default_tax_label: string | null } | null;
  };

  return (
    <PageShell
      title="New recurring invoice"
      description="Generates an invoice automatically on the schedule you set."
      actions={
        <Link
          href="/app/settings/recurring-invoices"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <div className="max-w-2xl">
        <RecurringInvoiceForm
          mode="new"
          currency={currency}
          orgTax={{
            ratePercent: formatTaxRate(org?.default_tax_rate_bps).replace("%", ""),
            label: org?.default_tax_label ?? "",
          }}
          clients={(clients ?? []).map((c) => ({
            id: c.id,
            name: c.name,
          }))}
        />
      </div>
    </PageShell>
  );
}

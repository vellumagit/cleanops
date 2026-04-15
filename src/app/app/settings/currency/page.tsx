import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { getOrgCurrency } from "@/lib/org-currency";
import { PageShell } from "@/components/page-shell";
import { CurrencyForm } from "./currency-form";

export const metadata = { title: "Currency" };

export default async function CurrencySettingsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const current = await getOrgCurrency(membership.organization_id);

  return (
    <PageShell
      title="Currency"
      description="What currency your invoices, estimates, and dashboard metrics display in."
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
      <CurrencyForm current={current} />
    </PageShell>
  );
}

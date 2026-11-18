import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { can, requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { PayInvoiceTable } from "@/components/pay-invoice-table";
import { formatCurrencyCents } from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTimezone } from "@/lib/org-timezone";
import { listPayInvoices } from "@/lib/pay-invoice-list";
import type { PayInvoiceKind } from "@/lib/pay-invoice";

export const metadata = { title: "Pay invoices" };

/**
 * Payroll → Invoices: every pay invoice the company has, for every person
 * and every period, newest first, each with its PDF.
 *
 * Owners and admins see both kinds. A manager sees contractor invoices only,
 * and only with the "On-call pool & subcontractor pay" switch on: the same
 * line the PDF route draws (employee payroll is owner and admin territory).
 */
export default async function PayInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const isOffice = membership.role === "owner" || membership.role === "admin";
  if (!isOffice && !can(membership, "subcontractors")) {
    // requireMembership let a manager in; without the switch there is
    // nothing here for them.
    redirect("/app");
  }
  const kinds: PayInvoiceKind[] = isOffice ? ["employee", "contractor"] : ["contractor"];

  const [{ person }, currency, tz, all] = await Promise.all([
    searchParams,
    getOrgCurrency(membership.organization_id),
    getOrgTimezone(membership.organization_id),
    listPayInvoices(membership.organization_id, { kinds }),
  ]);

  // The people who have at least one invoice, for the filter.
  const people = [...new Map(all.map((r) => [r.membershipId, r.name])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const chosen = person && people.some(([id]) => id === person) ? person : "";
  const rows = chosen ? all.filter((r) => r.membershipId === chosen) : all;
  const paid = rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.totalCents, 0);
  const payable = rows.filter((r) => r.status === "finalized").reduce((s, r) => s + r.totalCents, 0);

  return (
    <PageShell
      title="Pay invoices"
      description="One invoice per person per pay period, for your records and theirs."
      actions={
        <Link href="/app/payroll" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <ArrowLeft className="h-4 w-4" />
          Payroll
        </Link>
      }
    >
      <div className="max-w-5xl space-y-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="person" className="block text-xs font-medium text-muted-foreground">
              Person
            </label>
            <select
              id="person"
              name="person"
              defaultValue={chosen}
              className="mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Everyone</option>
              {people.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Show
          </button>
          <p className="ml-auto text-sm text-muted-foreground">
            {rows.length} invoice{rows.length === 1 ? "" : "s"} · paid{" "}
            <span className="font-semibold text-foreground">{formatCurrencyCents(paid, currency)}</span> · payable{" "}
            <span className="font-semibold text-foreground">{formatCurrencyCents(payable, currency)}</span>
          </p>
        </form>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            No pay invoices yet. One appears for each person as soon as a pay period or a contractor statement is run.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <PayInvoiceTable rows={rows} currency={currency} showName timezone={tz} />
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Each invoice covers the dates of the pay run it came from. A draft is visible here but not to the person
          until the run is finalized.
        </p>
      </div>
    </PageShell>
  );
}

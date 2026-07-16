import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { formatCurrencyCents } from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { getSubcontractorPayables } from "@/lib/subcontractor-payables";

export const metadata = { title: "Subcontractor pay" };

export default async function SubcontractorPayablesPage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const [{ rows, totalOutstandingCents }, currency] = await Promise.all([
    getSubcontractorPayables(membership.organization_id),
    getOrgCurrency(membership.organization_id),
  ]);

  return (
    <PageShell
      title="Subcontractor pay"
      description="What you owe each subcontractor for completed jobs."
      actions={
        <Link
          href="/app/freelancers"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Subcontractor bench
        </Link>
      }
    >
      <div className="space-y-6">
        {/* ── Total outstanding ── */}
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Outstanding
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {formatCurrencyCents(totalOutstandingCents, currency)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Total still owed across all subcontractors.
          </p>
        </div>

        {/* ── Rows ── */}
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
            <p className="text-sm font-medium text-foreground">
              No subcontractor pay yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Once a subcontractor claims a shift offer and its booking is
              completed, what you owe them shows up here.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Subcontractor</th>
                    <th className="px-4 py-2.5 text-right font-medium">Jobs</th>
                    <th className="px-4 py-2.5 text-right font-medium">Earned</th>
                    <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Outstanding
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {rows.map((r) => (
                    <tr
                      key={r.contactId}
                      className="transition-colors hover:bg-muted/50"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/app/freelancers/payables/${r.contactId}`}
                          className="font-medium text-foreground hover:underline underline-offset-2"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {r.jobCount}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatCurrencyCents(r.earnedCents, currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatCurrencyCents(r.paidCents, currency)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                          r.outstandingCents > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {formatCurrencyCents(r.outstandingCents, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}

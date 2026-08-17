import Link from "next/link";
import { Plus, Wallet, ChevronRight, HandCoins } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { NewPayrollRunForm } from "./new-run-form";
import { markTipsPaidAction } from "./actions";
import { getTipsOwed } from "@/lib/invoice-tips";
import { getSubcontractorPayables } from "@/lib/subcontractor-payables";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const tz = await getOrgTimezone(membership.organization_id);
  const admin = createSupabaseAdminClient();
  const currency = await getOrgCurrency(membership.organization_id);

  const { data: rawRuns } = (await admin
    .from("payroll_runs" as never)
    .select(
      "id, period_start, period_end, status, total_cents, finalized_at, paid_at, created_at",
    )
    .eq("organization_id" as never, membership.organization_id as never)
    .order("period_start" as never, { ascending: false } as never)
    .limit(50)) as unknown as {
    data: Array<{
      id: string;
      period_start: string;
      period_end: string;
      status: "draft" | "finalized" | "paid";
      total_cents: number;
      finalized_at: string | null;
      paid_at: string | null;
      created_at: string;
    }> | null;
  };

  const runs = rawRuns ?? [];

  // Subcontractors are paid outside payroll runs — they are contractors, not
  // employees, and rolling them into a run total would misstate both the run
  // and their tax treatment. Shown here because "what am I paying out this
  // period" is the question this page answers, and the answer was incomplete.
  const { rows: subRows, totalOutstandingCents: subOutstandingCents } =
    await getSubcontractorPayables(membership.organization_id);
  const subOwedCount = subRows.filter((r) => r.outstandingCents > 0).length;

  // Tips are the same shape of problem as subcontractor pay: money the
  // business is holding that belongs to a specific person, settled outside a
  // payroll run. It belongs on the page that answers "what am I paying out".
  const tipsOwed = await getTipsOwed(membership.organization_id);

  return (
    <PageShell
      title="Payroll"
      description="Snapshot hours, bonuses, and PTO into pay periods. Export or mark paid when ready."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Runs list */}
        <div>
          <h2 className="mb-3 text-sm font-semibold">Pay periods</h2>
          {runs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
              <p className="text-sm font-medium">No payroll runs yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create your first pay period using the form on the right.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/app/payroll/${r.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {formatDate(r.period_start, tz)} →{" "}
                        {formatDate(r.period_end, tz)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Created {formatDate(r.created_at, tz)}
                        {r.paid_at && ` · Paid ${formatDate(r.paid_at, tz)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-semibold tabular-nums">
                        {formatCurrencyCents(r.total_cents, currency)}
                      </span>
                      <StatusBadge
                        tone={
                          r.status === "paid"
                            ? "green"
                            : r.status === "finalized"
                              ? "blue"
                              : "neutral"
                        }
                      >
                        {r.status}
                      </StatusBadge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* New run form + subcontractor payables */}
        <aside className="space-y-4">
          <div className="sticky top-4 space-y-4">
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Plus className="h-4 w-4" />
                New pay period
              </h2>
              <NewPayrollRunForm />
            </div>

            <Link
              href="/app/freelancers/payables"
              className="block rounded-lg border border-border bg-card p-5 transition-colors hover:bg-muted/40"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Wallet className="h-4 w-4" />
                  Subcontractor pay
                </h2>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <p
                className={
                  subOutstandingCents > 0
                    ? "mt-2 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400"
                    : "mt-2 text-2xl font-bold tabular-nums text-muted-foreground"
                }
              >
                {formatCurrencyCents(subOutstandingCents, currency)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {subOutstandingCents > 0
                  ? `Outstanding to ${subOwedCount} subcontractor${subOwedCount === 1 ? "" : "s"}.`
                  : "Nothing outstanding."}{" "}
                Paid separately from payroll runs — subcontractors are
                contractors, so their pay is never part of a run total.
              </p>
            </Link>

            {/* Tips held on behalf of cleaners. Only rendered when there ARE
                any — an empty card would be a permanent reminder of a feature
                most orgs never switch on. */}
            {tipsOwed.rows.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <HandCoins className="h-4 w-4" />
                  Tips to pass on
                </h2>
                <p className="mt-2 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  {formatCurrencyCents(tipsOwed.totalCents, currency)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Clients tipped this by card. It landed in your Stripe balance
                  along with the invoice, so it&rsquo;s yours to hand on.
                </p>

                <ul className="mt-3 space-y-1.5">
                  {tipsOwed.rows.map((r) => (
                    <li
                      key={r.membershipId ?? "unattributed"}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {r.tipCount} tip{r.tipCount === 1 ? "" : "s"}
                          {r.membershipId === null
                            ? " — nobody was assigned to these jobs"
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums">
                          {formatCurrencyCents(r.amountCents, currency)}
                        </span>
                        <form action={markTipsPaidAction}>
                          <input
                            type="hidden"
                            name="membership_id"
                            value={r.membershipId ?? ""}
                          />
                          <button
                            type="submit"
                            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted"
                          >
                            Mark paid
                          </button>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>
    </PageShell>
  );
}

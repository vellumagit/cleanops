import Link from "next/link";
import { Plus, Wallet, ChevronRight } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { NewPayrollRunForm } from "./new-run-form";
import { getSubcontractorPayables } from "@/lib/subcontractor-payables";

export const metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();
  const currency = await getOrgCurrency(membership.organization_id);

  const { data: rawRuns } = (await admin
    .from("payroll_runs" as never)
    .select("id, period_start, period_end, status, total_cents, finalized_at, paid_at, created_at")
    .eq("organization_id" as never, membership.organization_id as never)
    .order("period_start" as never, { ascending: false } as never)
    .limit(50) as unknown as {
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
  });

  const runs = rawRuns ?? [];

  // Subcontractors are paid outside payroll runs — they are contractors, not
  // employees, and rolling them into a run total would misstate both the run
  // and their tax treatment. Shown here because "what am I paying out this
  // period" is the question this page answers, and the answer was incomplete.
  const { rows: subRows, totalOutstandingCents: subOutstandingCents } =
    await getSubcontractorPayables(membership.organization_id);
  const subOwedCount = subRows.filter((r) => r.outstandingCents > 0).length;

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
                        {formatDate(r.period_start)} → {formatDate(r.period_end)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Created {formatDate(r.created_at)}
                        {r.paid_at && ` · Paid ${formatDate(r.paid_at)}`}
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
          </div>
        </aside>
      </div>
    </PageShell>
  );
}

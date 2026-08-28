import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Users, Wallet } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyCents } from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";

export const metadata = { title: "Pay period" };

function shortDate(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${ymd}T00:00:00Z`));
}

/**
 * One period, both pay systems, one page — the answer to "how much do I
 * owe my employees and how much do I owe my contractors for that pay
 * period." Each half links into its own system for settling.
 */
export default async function PayPeriodPage({
  params,
}: {
  params: Promise<{ range: string }>;
}) {
  const membership = await requireMembership(["owner", "admin"]);
  const { range } = await params;
  const m = range.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
  if (!m) notFound();
  const [, periodStart, periodEnd] = m;

  const admin = createSupabaseAdminClient();
  const currency = await getOrgCurrency(membership.organization_id);

  const [{ data: payrollRuns }, { data: subRuns }] = await Promise.all([
    admin
      .from("payroll_runs" as never)
      .select("id, status, total_cents, notes, created_at, paid_at")
      .eq("organization_id" as never, membership.organization_id as never)
      .eq("period_start" as never, periodStart as never)
      .eq("period_end" as never, periodEnd as never)
      .order("created_at" as never, { ascending: false } as never)
      .limit(1) as unknown as Promise<{
      data: Array<{
        id: string;
        status: "draft" | "finalized" | "paid";
        total_cents: number;
        notes: string | null;
        created_at: string;
        paid_at: string | null;
      }> | null;
    }>,
    admin
      .from("subcontractor_pay_runs" as never)
      .select("id, status, total_cents, created_at, paid_at")
      .eq("organization_id" as never, membership.organization_id as never)
      .eq("period_start" as never, periodStart as never)
      .eq("period_end" as never, periodEnd as never)
      .order("created_at" as never, { ascending: false } as never)
      .limit(1) as unknown as Promise<{
      data: Array<{
        id: string;
        status: string;
        total_cents: number;
        created_at: string;
        paid_at: string | null;
      }> | null;
    }>,
  ]);

  const payrollRun = payrollRuns?.[0] ?? null;
  const subRun = subRuns?.[0] ?? null;

  const [{ data: payrollItems }, { data: subItems }] = await Promise.all([
    payrollRun
      ? (admin
          .from("payroll_items" as never)
          .select(
            "employee_name, hours_worked, regular_pay_cents, bonus_cents, pto_pay_cents, total_cents",
          )
          .eq("payroll_run_id" as never, payrollRun.id as never)
          .order("total_cents" as never, {
            ascending: false,
          } as never) as unknown as Promise<{
          data: Array<{
            employee_name: string;
            hours_worked: number;
            regular_pay_cents: number;
            bonus_cents: number;
            pto_pay_cents: number;
            total_cents: number;
          }> | null;
        }>)
      : Promise.resolve({ data: null }),
    subRun
      ? (admin
          .from("subcontractor_pay_items" as never)
          .select("payee_name, minutes, total_cents")
          .eq("run_id" as never, subRun.id as never)
          .order("total_cents" as never, {
            ascending: false,
          } as never) as unknown as Promise<{
          data: Array<{
            payee_name: string;
            minutes: number;
            total_cents: number;
          }> | null;
        }>)
      : Promise.resolve({ data: null }),
  ]);

  const combined =
    (payrollRun?.total_cents ?? 0) + (subRun?.total_cents ?? 0);

  const tone = (status: string) =>
    status === "paid" ? "green" : status === "finalized" ? "blue" : "neutral";

  return (
    <PageShell
      title={`Pay period ${shortDate(periodStart)} → ${shortDate(periodEnd)}`}
      description={
        combined > 0
          ? `${formatCurrencyCents(combined, currency)} owed across both pay systems this period.`
          : "Nothing was owed in this period."
      }
      actions={
        <Link
          href="/app/payroll"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ChevronLeft className="h-4 w-4" />
          Payroll
        </Link>
      }
    >
      <div className="max-w-3xl space-y-6">
        {!payrollRun && !subRun && (
          <p className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
            This period hasn&rsquo;t been prepared yet — start it from the
            Payroll page.
          </p>
        )}

        {/* ── Employees ─────────────────────────────────────────────── */}
        {payrollRun && (
          <section className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4" />
                Employees
              </h2>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold tabular-nums">
                  {formatCurrencyCents(payrollRun.total_cents, currency)}
                </span>
                <StatusBadge tone={tone(payrollRun.status)}>
                  {payrollRun.status}
                </StatusBadge>
                <Link
                  href={`/app/payroll/${payrollRun.id}`}
                  className={buttonVariants({ size: "sm" })}
                >
                  {payrollRun.status === "draft"
                    ? "Review & finalize"
                    : payrollRun.status === "finalized"
                      ? "Mark as paid"
                      : "Open run"}
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
            {payrollRun.notes && (
              <p className="border-b border-border bg-amber-50 px-5 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                {payrollRun.notes}
              </p>
            )}
            <ul className="divide-y divide-border/60">
              {(payrollItems ?? []).map((i, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
                >
                  <span className="min-w-0 truncate font-medium">
                    {i.employee_name}
                  </span>
                  <span className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
                    <span className="tabular-nums">{i.hours_worked}h</span>
                    {i.bonus_cents > 0 && (
                      <span className="tabular-nums">
                        +{formatCurrencyCents(i.bonus_cents, currency)} bonus
                      </span>
                    )}
                    {i.pto_pay_cents > 0 && (
                      <span className="tabular-nums">
                        +{formatCurrencyCents(i.pto_pay_cents, currency)} PTO
                      </span>
                    )}
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {formatCurrencyCents(i.total_cents, currency)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!payrollRun && subRun && (
          <p className="text-xs text-muted-foreground">
            No unpaid employee hours, bonuses, or PTO landed in this period.
          </p>
        )}

        {/* ── Contractors ───────────────────────────────────────────── */}
        {subRun && (
          <section className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Wallet className="h-4 w-4" />
                Contractors
              </h2>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold tabular-nums">
                  {formatCurrencyCents(subRun.total_cents, currency)}
                </span>
                <StatusBadge tone={tone(subRun.status)}>
                  {subRun.status}
                </StatusBadge>
                <Link
                  href="/app/payroll/contractors"
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                >
                  {subRun.status === "paid" ? "Open statements" : "Settle"}
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
            <ul className="divide-y divide-border/60">
              {(subItems ?? []).map((i, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
                >
                  <span className="min-w-0 truncate font-medium">
                    {i.payee_name}
                  </span>
                  <span className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {Math.floor(i.minutes / 60)}h {i.minutes % 60}m
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {formatCurrencyCents(i.total_cents, currency)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-border px-5 py-2 text-[11px] text-muted-foreground">
              Contractors settle through statements, never inside a payroll
              run — different tax treatment, same period.
            </p>
          </section>
        )}
        {!subRun && payrollRun && (
          <p className="text-xs text-muted-foreground">
            No unpaid contractor hours landed in this period. (On-call bench
            payouts settle per job on{" "}
            <Link href="/app/payroll/contractors" className="underline">
              Contractor pay
            </Link>
            .)
          </p>
        )}
      </div>
    </PageShell>
  );
}

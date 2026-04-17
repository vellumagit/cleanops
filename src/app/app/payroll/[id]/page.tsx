import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, DollarSign, Trash2 } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { formatCurrencyCents, formatDate, formatDateTime } from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import {
  finalizePayrollRunAction,
  markPayrollPaidAction,
  deletePayrollRunAction,
} from "../actions";

export const metadata = { title: "Payroll run" };

export default async function PayrollRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership(["owner", "admin"]);
  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const currency = await getOrgCurrency(membership.organization_id);

  const { data: runRaw } = (await admin
    .from("payroll_runs" as never)
    .select(
      "id, organization_id, period_start, period_end, status, total_cents, notes, finalized_at, paid_at, created_at",
    )
    .eq("id" as never, id as never)
    .maybeSingle() as unknown as {
    data: {
      id: string;
      organization_id: string;
      period_start: string;
      period_end: string;
      status: "draft" | "finalized" | "paid";
      total_cents: number;
      notes: string | null;
      finalized_at: string | null;
      paid_at: string | null;
      created_at: string;
    } | null;
  });

  if (!runRaw || runRaw.organization_id !== membership.organization_id) notFound();

  const { data: itemsRaw } = (await admin
    .from("payroll_items" as never)
    .select(
      "id, employee_id, employee_name, hours_worked, regular_pay_cents, bonus_cents, pto_hours, pto_pay_cents, total_cents",
    )
    .eq("payroll_run_id" as never, id as never)
    .order("employee_name" as never, { ascending: true } as never) as unknown as {
    data: Array<{
      id: string;
      employee_id: string;
      employee_name: string;
      hours_worked: number;
      regular_pay_cents: number;
      bonus_cents: number;
      pto_hours: number;
      pto_pay_cents: number;
      total_cents: number;
    }> | null;
  });

  const run = runRaw;
  const items = itemsRaw ?? [];

  const totals = items.reduce(
    (acc, i) => ({
      hours: acc.hours + Number(i.hours_worked),
      regular: acc.regular + i.regular_pay_cents,
      bonus: acc.bonus + i.bonus_cents,
      pto: acc.pto + i.pto_pay_cents,
      total: acc.total + i.total_cents,
    }),
    { hours: 0, regular: 0, bonus: 0, pto: 0, total: 0 },
  );

  return (
    <PageShell
      title={`${formatDate(run.period_start)} → ${formatDate(run.period_end)}`}
      description={`Payroll run created ${formatDate(run.created_at)}`}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/app/payroll"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <StatusBadge
            tone={
              run.status === "paid"
                ? "green"
                : run.status === "finalized"
                  ? "blue"
                  : "neutral"
            }
          >
            {run.status}
          </StatusBadge>
        </div>
      }
    >
      <div className="mb-6 rounded-lg border border-border bg-card p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Employees</div>
            <div className="mt-0.5 text-lg font-bold tabular-nums">
              {items.length}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Hours</div>
            <div className="mt-0.5 text-lg font-bold tabular-nums">
              {totals.hours.toFixed(1)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Bonuses</div>
            <div className="mt-0.5 text-lg font-bold tabular-nums">
              {formatCurrencyCents(totals.bonus, currency)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatCurrencyCents(totals.total, currency)}
            </div>
          </div>
        </div>
      </div>

      {/* Items table */}
      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Employee</th>
              <th className="px-4 py-3 text-right font-medium">Hours</th>
              <th className="px-4 py-3 text-right font-medium">Regular</th>
              <th className="px-4 py-3 text-right font-medium">Bonus</th>
              <th className="px-4 py-3 text-right font-medium">PTO</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-3 font-medium">{i.employee_name}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {Number(i.hours_worked).toFixed(1)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                  {formatCurrencyCents(i.regular_pay_cents, currency)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                  {formatCurrencyCents(i.bonus_cents, currency)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                  {formatCurrencyCents(i.pto_pay_cents, currency)}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                  {formatCurrencyCents(i.total_cents, currency)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-muted/30">
            <tr className="text-sm">
              <td className="px-4 py-3 font-semibold">Totals</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {totals.hours.toFixed(1)}
              </td>
              <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                {formatCurrencyCents(totals.regular, currency)}
              </td>
              <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                {formatCurrencyCents(totals.bonus, currency)}
              </td>
              <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                {formatCurrencyCents(totals.pto, currency)}
              </td>
              <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatCurrencyCents(totals.total, currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Timestamps */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>Created {formatDateTime(run.created_at)}</span>
        {run.finalized_at && (
          <span>Finalized {formatDateTime(run.finalized_at)}</span>
        )}
        {run.paid_at && <span>Paid {formatDateTime(run.paid_at)}</span>}
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {run.status === "draft" && (
          <form action={finalizePayrollRunAction}>
            <input type="hidden" name="id" value={run.id} />
            <SubmitButton variant="default" size="sm" pendingLabel="Finalizing…">
              <CheckCircle2 className="h-4 w-4" />
              Finalize
            </SubmitButton>
          </form>
        )}
        {run.status === "finalized" && (
          <form action={markPayrollPaidAction}>
            <input type="hidden" name="id" value={run.id} />
            <SubmitButton variant="default" size="sm" pendingLabel="Marking paid…">
              <DollarSign className="h-4 w-4" />
              Mark as paid
            </SubmitButton>
          </form>
        )}
        <form action={deletePayrollRunAction} className="ml-auto flex items-center gap-2">
          <input type="hidden" name="id" value={run.id} />
          {run.status !== "draft" && (
            <input
              type="text"
              name="confirm"
              placeholder='Type "DELETE" to confirm'
              required
              className="rounded-md border border-red-500/40 bg-background px-3 py-1.5 text-xs"
            />
          )}
          <SubmitButton variant="outline" size="sm" pendingLabel="Deleting…">
            <Trash2 className="h-4 w-4" />
            Delete {run.status === "draft" ? "draft" : "run"}
          </SubmitButton>
        </form>
      </div>
    </PageShell>
  );
}

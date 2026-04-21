import Link from "next/link";
import { ArrowLeft, Plus, Pause, Play, Trash2 } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgCurrency } from "@/lib/org-currency";
import { formatCurrencyCents } from "@/lib/format";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import {
  toggleRecurringInvoiceAction,
  deleteRecurringInvoiceAction,
} from "./actions";

export const metadata = { title: "Recurring invoices" };

type SeriesRow = {
  id: string;
  name: string;
  cadence: "weekly" | "biweekly" | "monthly" | "quarterly";
  amount_cents: number;
  active: boolean;
  next_run_at: string;
  last_generated_at: string | null;
  due_days: number;
  client: { name: string | null } | null;
};

export default async function RecurringInvoicesPage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const admin = createSupabaseAdminClient();
  const currency = await getOrgCurrency(membership.organization_id);

  const { data } = (await admin
    .from("invoice_series" as never)
    .select(
      `id, name, cadence, amount_cents, active, next_run_at, last_generated_at, due_days,
       client:clients ( name )`,
    )
    .eq("organization_id" as never, membership.organization_id as never)
    .order("created_at" as never, { ascending: false } as never)) as unknown as {
    data: SeriesRow[] | null;
  };

  const series = data ?? [];

  return (
    <PageShell
      title="Recurring invoices"
      description="Auto-generate invoices on a schedule for contract clients. Runs daily at 06:30 UTC."
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/app/settings"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <Link
            href="/app/settings/recurring-invoices/new"
            className={buttonVariants({ size: "sm" })}
          >
            <Plus className="h-4 w-4" />
            New series
          </Link>
        </div>
      }
    >
      {series.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No recurring invoices yet.
          </p>
          <Link
            href="/app/settings/recurring-invoices/new"
            className={
              buttonVariants({ size: "sm" }) + " mt-4 inline-flex"
            }
          >
            <Plus className="h-4 w-4" />
            Create your first
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {series.map((s) => {
            const cadenceLabel =
              s.cadence === "biweekly" ? "Every 2 weeks" : s.cadence;
            const nextRun = new Date(s.next_run_at);
            const isOverdue = s.active && nextRun.getTime() < Date.now();
            return (
              <li
                key={s.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{s.name}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
                        {cadenceLabel}
                      </span>
                      {!s.active && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          Paused
                        </span>
                      )}
                      {isOverdue && (
                        <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-700">
                          Due now
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.client?.name ?? "—"} ·{" "}
                      {formatCurrencyCents(s.amount_cents, currency)} · Net{" "}
                      {s.due_days}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Next run:{" "}
                      {nextRun.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                      {s.last_generated_at
                        ? ` · Last generated ${new Date(s.last_generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                        : " · Never generated yet"}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <form action={toggleRecurringInvoiceAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={String(s.active)}
                      />
                      <SubmitButton
                        variant="outline"
                        size="sm"
                        pendingLabel="…"
                      >
                        {s.active ? (
                          <>
                            <Pause className="h-4 w-4" />
                            Pause
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4" />
                            Resume
                          </>
                        )}
                      </SubmitButton>
                    </form>
                    <form action={deleteRecurringInvoiceAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <SubmitButton
                        variant="ghost"
                        size="sm"
                        pendingLabel="…"
                        className="text-red-700 hover:bg-red-500/10 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}

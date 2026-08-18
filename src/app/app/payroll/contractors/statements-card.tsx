"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { FileText, Loader2, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import {
  formatCurrencyCents,
  formatDurationMinutes,
  type CurrencyCode,
} from "@/lib/format";
import type { PayRunSummary } from "@/lib/subcontractor-payables";
import {
  generateSubcontractorRunAction,
  markSubcontractorRunPaidAction,
  deleteSubcontractorRunAction,
} from "./run-actions";

/**
 * The bi-weekly ritual, as a card: pick a period, generate, and every
 * subcontractor's believed hours in it freeze into one statement — per-person
 * totals priced exactly as the ledger prices them. Unpaid statements still
 * count as owed above; "Mark paid" settles the whole period in one tap.
 */
export function StatementsCard({
  runs,
  currency,
  defaultStart,
  defaultEnd,
  canManage,
}: {
  runs: PayRunSummary[];
  currency: CurrencyCode;
  /** Org-local YYYY-MM-DD defaults — computed server-side so the browser's
   *  timezone can't shift the suggested period (the payroll form's old bug). */
  defaultStart: string;
  defaultEnd: string;
  canManage: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function generate(formData: FormData) {
    startTransition(async () => {
      const res = await generateSubcontractorRunAction(formData);
      if (!res.ok) toast.error(res.error);
      else toast.success("Statement generated");
    });
  }

  function markPaid(runId: string) {
    if (
      !confirm(
        "Mark this statement paid? This settles every line on it — don't also record a separate payout for the same period.",
      )
    )
      return;
    const fd = new FormData();
    fd.set("run_id", runId);
    startTransition(async () => {
      const res = await markSubcontractorRunPaidAction(fd);
      if (!res.ok) toast.error(res.error);
      else toast.success("Statement marked paid");
    });
  }

  function remove(runId: string) {
    if (
      !confirm(
        "Delete this statement? Its hours go back to the floating balance and the period can be regenerated.",
      )
    )
      return;
    const fd = new FormData();
    fd.set("run_id", runId);
    startTransition(async () => {
      const res = await deleteSubcontractorRunAction(fd);
      if (!res.ok) toast.error(res.error);
      else toast.success("Statement deleted");
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Pay statements
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Freeze a pay period into per-subcontractor totals. Generating
            doesn&apos;t pay it — mark the statement paid when the money moves.
          </p>
        </div>

        {canManage && (
          <form action={generate} className="flex flex-wrap items-end gap-2">
            <div>
              <label
                htmlFor="stmt-start"
                className="mb-1 block text-[11px] font-medium text-muted-foreground"
              >
                From
              </label>
              <Input
                id="stmt-start"
                name="period_start"
                type="date"
                required
                defaultValue={defaultStart}
                disabled={isPending}
                className="h-8 w-36 text-xs"
              />
            </div>
            <div>
              <label
                htmlFor="stmt-end"
                className="mb-1 block text-[11px] font-medium text-muted-foreground"
              >
                To
              </label>
              <Input
                id="stmt-end"
                name="period_end"
                type="date"
                required
                defaultValue={defaultEnd}
                disabled={isPending}
                className="h-8 w-36 text-xs"
              />
            </div>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Generate"
              )}
            </Button>
          </form>
        )}
      </div>

      {runs.length === 0 ? (
        <p className="px-5 py-5 text-xs text-muted-foreground">
          No statements yet. Generate one to freeze the current pay period.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {runs.map((run) => (
            <li key={run.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {run.periodStart}
                  {" → "}
                  {run.periodEnd}
                  <StatusBadge tone={run.status === "paid" ? "green" : "amber"}>
                    {run.status === "paid" ? "Paid" : "Owed"}
                  </StatusBadge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tabular-nums">
                    {formatCurrencyCents(run.totalCents, currency)}
                  </span>
                  {canManage && run.status !== "paid" && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => markPaid(run.id)}
                        disabled={isPending}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Mark paid
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => remove(run.id)}
                        disabled={isPending}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Delete statement"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <ul className="mt-2 space-y-1">
                {run.items.map((item) => (
                  <li
                    key={item.membershipId}
                    className="flex items-baseline justify-between gap-3 text-xs"
                  >
                    <span className="min-w-0 truncate text-muted-foreground">
                      {item.payeeName}
                      <span className="ml-2 tabular-nums">
                        {formatDurationMinutes(item.minutes)} ·{" "}
                        {item.entryCount} shift
                        {item.entryCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatCurrencyCents(item.totalCents, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

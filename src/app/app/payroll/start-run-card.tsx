"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CalendarRange,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createPayrollRunAction } from "./actions";

/**
 * The one next action, Gusto-style: the next period is pre-computed, the
 * unpaid-hours bucket (Square-style) shows what's waiting in it, flagged
 * shifts block visibly (Jobber-style), and one button starts the run.
 * Typing dates — the old sidebar form — survives only behind a link.
 */
export function StartRunCard({
  suggestedStart,
  suggestedEnd,
  periodLabel,
  unpaidHoursLabel,
  unpaidEstimate,
  unpaidPeople,
  flaggedCount,
  sinceLabel,
}: {
  suggestedStart: string;
  suggestedEnd: string;
  /** e.g. "Aug 15 → Aug 28" (org-tz, precomputed server-side) */
  periodLabel: string;
  /** e.g. "37h 45m" */
  unpaidHoursLabel: string;
  /** formatted currency, e.g. "$1,203.25" */
  unpaidEstimate: string;
  unpaidPeople: number;
  flaggedCount: number;
  /** e.g. "since Aug 14" or "all time" */
  sinceLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await createPayrollRunAction(formData);
      if (r.ok) {
        router.push(`/app/payroll/${r.id}`);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <div className="rounded-xl border-2 border-primary/30 bg-card p-6">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
        Up next
      </p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <CalendarRange className="h-5 w-5 text-muted-foreground" />
          Pay period {periodLabel}
        </h2>
      </div>

      {/* The bucket: what's sitting unpaid, right now. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Unpaid hours
          </p>
          <p className="mt-0.5 text-lg font-bold tabular-nums">
            {unpaidHoursLabel}
          </p>
          <p className="text-[11px] text-muted-foreground">{sinceLabel}</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Wages waiting
          </p>
          <p className="mt-0.5 text-lg font-bold tabular-nums">
            {unpaidEstimate}
          </p>
          <p className="text-[11px] text-muted-foreground">
            before PTO &amp; bonuses
          </p>
        </div>
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            People
          </p>
          <p className="mt-0.5 text-lg font-bold tabular-nums">
            {unpaidPeople}
          </p>
          <p className="text-[11px] text-muted-foreground">
            with unpaid time
          </p>
        </div>
      </div>

      {flaggedCount > 0 && (
        <Link
          href="/app/timesheets"
          className="mt-3 flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/50"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>
              {flaggedCount} shift{flaggedCount === 1 ? "" : "s"} need
              {flaggedCount === 1 ? "s" : ""} review first
            </strong>{" "}
            — nobody clocked out and the hours are the system&rsquo;s guess.
            Confirm them on Timesheets so this run pays real numbers. They&rsquo;re
            left out of the totals above until then.
          </span>
        </Link>
      )}

      {!customOpen ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <form action={submit}>
            <input type="hidden" name="period_start" value={suggestedStart} />
            <input type="hidden" name="period_end" value={suggestedEnd} />
            <Button type="submit" size="lg" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Computing…
                </>
              ) : (
                <>
                  Start this run
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
          <button
            type="button"
            onClick={() => setCustomOpen(true)}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Different dates?
          </button>
        </div>
      ) : (
        <form action={submit} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="period_start"
              className="mb-1 block text-xs font-medium"
            >
              Period start
            </label>
            <Input
              id="period_start"
              name="period_start"
              type="date"
              required
              defaultValue={suggestedStart}
              disabled={isPending}
            />
          </div>
          <div>
            <label
              htmlFor="period_end"
              className="mb-1 block text-xs font-medium"
            >
              Period end
            </label>
            <Input
              id="period_end"
              name="period_end"
              type="date"
              required
              defaultValue={suggestedEnd}
              disabled={isPending}
            />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Computing…
              </>
            ) : (
              "Create pay period"
            )}
          </Button>
        </form>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

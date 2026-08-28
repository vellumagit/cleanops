import Link from "next/link";
import {
  Wallet,
  ChevronRight,
  HandCoins,
  Users,
  CheckCircle2,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { paySystemFor } from "@/lib/engagement";
import { StartRunCard } from "./start-run-card";
import { PayScheduleDialog } from "./pay-schedule-dialog";
import { suggestedPayPeriod, type PaySchedule } from "@/lib/pay-schedule";
import { periodHref } from "@/lib/pay-period";
import { markTipsPaidAction } from "./actions";
import { getTipsOwed } from "@/lib/invoice-tips";
import { getSubcontractorPayables } from "@/lib/subcontractor-payables";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "Payroll" };

/** "YYYY-MM-DD" + n days, pure date math — no timezone involved. */
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shortDate(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(`${ymd}T00:00:00Z`));
}

export default async function PayrollPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();
  const [tz, currency] = await Promise.all([
    getOrgTimezone(membership.organization_id),
    getOrgCurrency(membership.organization_id),
  ]);

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
  // "In progress" = anything a human hasn't finished. Paid runs are history.
  const inProgress = runs.filter((r) => r.status !== "paid");
  const currentRun = inProgress[0] ?? null;

  // Contractor statements for the same table — one period, both systems.
  const { data: rawSubRuns } = (await admin
    .from("subcontractor_pay_runs" as never)
    .select("id, period_start, period_end, status, total_cents, paid_at")
    .eq("organization_id" as never, membership.organization_id as never)
    .order("period_start" as never, { ascending: false } as never)
    .limit(50)) as unknown as {
    data: Array<{
      id: string;
      period_start: string;
      period_end: string;
      status: string;
      total_cents: number;
      paid_at: string | null;
    }> | null;
  };
  const subStatementRuns = rawSubRuns ?? [];

  // Merge both systems into period rows keyed by exact window.
  type PeriodRow = {
    start: string;
    end: string;
    emp: (typeof runs)[number] | null;
    sub: (typeof subStatementRuns)[number] | null;
  };
  const periodMap = new Map<string, PeriodRow>();
  for (const r of runs) {
    const k = `${r.period_start}_${r.period_end}`;
    periodMap.set(k, {
      start: r.period_start,
      end: r.period_end,
      emp: r,
      sub: null,
    });
  }
  for (const r of subStatementRuns) {
    const k = `${r.period_start}_${r.period_end}`;
    const row = periodMap.get(k);
    if (row) row.sub = r;
    else
      periodMap.set(k, {
        start: r.period_start,
        end: r.period_end,
        emp: null,
        sub: r,
      });
  }
  const periodRows = [...periodMap.values()].sort((a, b) =>
    a.start < b.start ? 1 : -1,
  );

  // Subcontractors are paid outside payroll runs — they are contractors, not
  // employees, and rolling them into a run total would misstate both the run
  // and their tax treatment. Shown here because "what am I paying out this
  // period" is the question this page answers, and the answer was incomplete.
  const { rows: subRows, totalOutstandingCents: subOutstandingCents } =
    await getSubcontractorPayables(membership.organization_id);
  const subOwedCount = subRows.filter((r) => r.outstandingCents > 0).length;

  // Head-count per PAY SYSTEM, not per source — engagement is an accounting
  // fact; where someone was sourced (roster vs bench) changes nothing about
  // how they're paid.
  const { data: rosterRows } = (await admin
    .from("memberships")
    .select("id, engagement, pay_rate_cents")
    .eq("organization_id", membership.organization_id)
    .eq("status", "active")) as unknown as {
    data: Array<{
      id: string;
      engagement: string | null;
      pay_rate_cents: number | null;
    }> | null;
  };
  const roster = rosterRows ?? [];
  const employeeRoster = roster.filter(
    (r) => paySystemFor(r.engagement) === "payroll",
  );
  const employeeCount = employeeRoster.length;
  const rosterContractorCount = roster.length - employeeCount;
  const benchContractorCount = subRows.filter((r) => !r.isRoster).length;
  const contractorCount = rosterContractorCount + benchContractorCount;

  // ── The unpaid bucket (Square's mental model) ─────────────────────────
  // Every completed employee-system entry no run has swallowed yet — the
  // hours a run exists to pay. Flagged (auto-capped) shifts are counted
  // separately and excluded from the totals: guesses must not preview as
  // wages. Engagement snapshot beats current engagement, same rule as the
  // run itself.
  const rateById = new Map(roster.map((r) => [r.id, r.pay_rate_cents]));
  const engagementById = new Map(roster.map((r) => [r.id, r.engagement]));
  let unpaidMinutes = 0;
  let unpaidCents = 0;
  let flaggedCount = 0;
  const unpaidPeople = new Set<string>();
  if (roster.length > 0) {
    const { data: unstamped } = (await admin
      .from("time_entries")
      .select(
        "employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, engagement_snapshot, needs_review",
      )
      .in(
        "employee_id",
        roster.map((r) => r.id),
      )
      .is("payroll_run_id", null)
      .not("clock_out_at", "is", null)
      .limit(2000)) as unknown as {
      data: Array<{
        employee_id: string;
        clock_in_at: string;
        clock_out_at: string;
        pay_rate_cents_snapshot: number | null;
        engagement_snapshot: string | null;
        needs_review: boolean | null;
      }> | null;
    };
    for (const e of unstamped ?? []) {
      const engagement =
        e.engagement_snapshot ?? engagementById.get(e.employee_id) ?? null;
      if (paySystemFor(engagement) !== "payroll") continue;
      if (e.needs_review) {
        flaggedCount += 1;
        continue;
      }
      const mins = Math.max(
        0,
        Math.round(
          (new Date(e.clock_out_at).getTime() -
            new Date(e.clock_in_at).getTime()) /
            60_000,
        ),
      );
      if (mins === 0) continue;
      const rate =
        e.pay_rate_cents_snapshot ?? rateById.get(e.employee_id) ?? 0;
      unpaidMinutes += mins;
      unpaidCents += Math.round((mins * rate) / 60);
      unpaidPeople.add(e.employee_id);
    }
  }
  const unpaidHoursLabel = `${Math.floor(unpaidMinutes / 60)}h ${String(
    unpaidMinutes % 60,
  ).padStart(2, "0")}m`;

  // ── The suggested next period ─────────────────────────────────────────
  // With a pay schedule set (Brian's "1st–15th and 16th–end of month"),
  // periods follow the org's calendar: the last completed window, or the
  // in-progress one when that's already been run. Without a schedule, the
  // old heuristic: day after the last run ended, through today.
  const { data: orgSchedule } = (await admin
    .from("organizations")
    .select("pay_schedule, pay_anchor" as never)
    .eq("id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: { pay_schedule: string | null; pay_anchor: string | null } | null;
  };
  const paySchedule = (orgSchedule?.pay_schedule ?? null) as PaySchedule | null;
  const payAnchor = orgSchedule?.pay_anchor ?? null;

  const today = todayInTz(tz);
  const latestEnd = runs[0]?.period_end ?? null;
  let suggestedStart: string;
  let suggestedEnd: string;
  let periodEndsAhead: string | null = null;
  if (paySchedule) {
    const p = suggestedPayPeriod(paySchedule, payAnchor, today, latestEnd);
    suggestedStart = p.start;
    suggestedEnd = p.end;
    if (!p.complete) periodEndsAhead = shortDate(p.end);
  } else {
    suggestedStart = latestEnd ? addDays(latestEnd, 1) : addDays(today, -13);
    if (suggestedStart > today) suggestedStart = today;
    suggestedEnd = today;
  }
  const sinceLabel = latestEnd
    ? `since ${shortDate(latestEnd)}`
    : "all unpaid time";

  const lastPaidRun = runs.find((r) => r.status === "paid") ?? null;

  // Tips: money the business is holding that belongs to a specific person,
  // settled outside a payroll run — same shape of problem as contractor pay.
  const tipsOwed = await getTipsOwed(membership.organization_id);

  return (
    <PageShell
      title="Payroll"
      description="What you owe, who you owe it to, and the one next step."
    >
      <div className="max-w-4xl space-y-6">
        {/* ── THE one next action ─────────────────────────────────────────
            Either finish the run already in flight, or start the next one.
            Never both — two "next steps" is how pages get confusing. */}
        {currentRun ? (
          <div className="rounded-xl border-2 border-amber-400/70 bg-card p-6 dark:border-amber-700/70">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              Finish what&rsquo;s started
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold">
                Pay period {shortDate(currentRun.period_start)} →{" "}
                {shortDate(currentRun.period_end)}
              </h2>
              <StatusBadge
                tone={currentRun.status === "finalized" ? "blue" : "neutral"}
              >
                {currentRun.status}
              </StatusBadge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {formatCurrencyCents(currentRun.total_cents, currency)}
              </span>{" "}
              {currentRun.status === "draft"
                ? "computed and waiting for your review. Finalize it, then mark it paid once the money goes out."
                : "finalized — mark it paid once the money has actually gone out."}
            </p>
            <Link
              href={periodHref(currentRun.period_start, currentRun.period_end)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Open this period
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <StartRunCard
            suggestedStart={suggestedStart}
            suggestedEnd={suggestedEnd}
            periodLabel={`${shortDate(suggestedStart)} → ${shortDate(suggestedEnd)}`}
            unpaidHoursLabel={unpaidHoursLabel}
            unpaidEstimate={formatCurrencyCents(unpaidCents, currency)}
            unpaidPeople={unpaidPeople.size}
            flaggedCount={flaggedCount}
            sinceLabel={sinceLabel}
            endsAhead={periodEndsAhead}
          />
        )}

        <PayScheduleDialog schedule={paySchedule} anchor={payAnchor} />

        {/* ── The two pay systems, as peers ──────────────────────────────
            Employees are paid in periods; contractors per job, never inside
            a run — the split is engagement, an accounting fact. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4" />
                Employees
              </h2>
              <span className="text-xs text-muted-foreground">
                {employeeCount}
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {lastPaidRun
                ? formatCurrencyCents(lastPaidRun.total_cents, currency)
                : "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {lastPaidRun
                ? `Last pay period, paid ${formatDate(lastPaidRun.paid_at ?? lastPaidRun.period_end, tz)}.`
                : "No pay period has been run yet."}{" "}
              Paid in periods, with hours, PTO and bonuses rolled in.
            </p>
          </div>

          <Link
            href="/app/payroll/contractors"
            className="rounded-xl border border-border bg-card p-5 transition-colors hover:bg-muted/40"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Wallet className="h-4 w-4" />
                Contractors
              </h2>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {contractorCount}
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
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
                ? `Outstanding to ${subOwedCount} of them.`
                : "Nothing outstanding."}{" "}
              Paid per job, never inside a payroll run
              {benchContractorCount > 0
                ? ` — your own roster and the on-call bench together`
                : ""}
              .
            </p>
          </Link>
        </div>

        {/* Tips held on behalf of cleaners — only rendered when there ARE
            any, so it never sits as an empty reminder. */}
        {tipsOwed.rows.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5">
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

        {/* ── Pay periods: one table, both systems ─────────────────────
            Each row is a window; Employees and Contractors are columns, so
            "what did that period cost" reads across, and clicking opens the
            period page that breaks both halves down. */}
        <div>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" />
            Pay periods
          </h2>
          {periodRows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
              Prepared periods collect here — employees and contractors side
              by side.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Period</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Employees
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Contractors
                    </th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {periodRows.map((row) => {
                    const unfinished =
                      (row.emp && row.emp.status !== "paid") ||
                      (row.sub && row.sub.status !== "paid");
                    return (
                      <tr
                        key={`${row.start}_${row.end}`}
                        className={
                          unfinished
                            ? "border-b border-border/60 bg-amber-50/50 last:border-0 dark:bg-amber-950/10"
                            : "border-b border-border/60 last:border-0"
                        }
                      >
                        <td className="px-4 py-2">
                          <Link
                            href={periodHref(row.start, row.end)}
                            className="font-medium hover:underline"
                          >
                            {shortDate(row.start)} → {shortDate(row.end)}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-right">
                          {row.emp ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="font-mono tabular-nums">
                                {formatCurrencyCents(
                                  row.emp.total_cents,
                                  currency,
                                )}
                              </span>
                              <StatusBadge
                                tone={
                                  row.emp.status === "paid"
                                    ? "green"
                                    : row.emp.status === "finalized"
                                      ? "blue"
                                      : "neutral"
                                }
                              >
                                {row.emp.status}
                              </StatusBadge>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {row.sub ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="font-mono tabular-nums">
                                {formatCurrencyCents(
                                  row.sub.total_cents,
                                  currency,
                                )}
                              </span>
                              <StatusBadge
                                tone={
                                  row.sub.status === "paid" ? "green" : "blue"
                                }
                              >
                                {row.sub.status}
                              </StatusBadge>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">
                          {formatCurrencyCents(
                            (row.emp?.total_cents ?? 0) +
                              (row.sub?.total_cents ?? 0),
                            currency,
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

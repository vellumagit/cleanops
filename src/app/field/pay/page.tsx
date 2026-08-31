import Link from "next/link";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { FieldHeader } from "@/components/field-shell";
import { formatCurrencyCents } from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTimezone } from "@/lib/org-timezone";
import { periodContaining, type PaySchedule } from "@/lib/pay-schedule";
import {
  zonedYmd,
  zonedMidnightUtc,
  zonedDayStartUtc,
} from "@/lib/wall-clock";

function addYmdDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const metadata = { title: "My pay" };

/**
 * "My pay" — a cleaner's own earnings, current period and past statements.
 *
 * Everything money-shaped was office-only: payroll tables are
 * deliberately unreadable from an end-user JWT (RLS + the pay_rate
 * column lock), and the "your statement was marked paid — $X" text
 * linked people to /field/hours, which shows no dollars at all. This
 * page is the safe read path: server-side, admin client, every query
 * double-scoped to THIS member in THIS org — the same pattern the clock
 * action uses to snapshot the rate.
 *
 * Two layers, clearly separated:
 *   1. The current period so far — an ESTIMATE from closed shifts ×
 *      rate. Labeled as such; bonuses/PTO land when the office runs
 *      payroll, and flagged shifts can still change.
 *   2. Statements — finalized/paid runs, the frozen numbers. Drafts the
 *      office is still reviewing are excluded on purpose.
 */
export default async function FieldPayPage() {
  const membership = await requireMembership();
  const tz = await getOrgTimezone(membership.organization_id);
  const currency = await getOrgCurrency(membership.organization_id);
  const admin = createSupabaseAdminClient();

  // Org pay calendar + my own rate — one round trip each.
  const [{ data: org }, { data: me }] = await Promise.all([
    (admin
      .from("organizations")
      .select("pay_schedule, pay_anchor" as never)
      .eq("id", membership.organization_id)
      .maybeSingle()) as unknown as Promise<{
      data: { pay_schedule: string | null; pay_anchor: string | null } | null;
    }>,
    (admin
      .from("memberships")
      .select("pay_rate_cents")
      .eq("id", membership.id)
      .eq("organization_id", membership.organization_id)
      .maybeSingle()) as unknown as Promise<{
      data: { pay_rate_cents: number | null } | null;
    }>,
  ]);

  const schedule = (org?.pay_schedule ?? null) as PaySchedule | null;
  const anchor = org?.pay_anchor ?? null;
  const todayYmd = zonedYmd(new Date(), tz);
  // A usable pay calendar needs a schedule, and weekly/biweekly need their
  // anchor too — periodContaining's anchorless fallback starts a period
  // TODAY, which would make this card's total reset to zero every morning.
  // Orgs that run payroll by hand get a stable trailing window instead.
  const hasCalendar =
    schedule != null &&
    (schedule === "semimonthly" || schedule === "monthly" || anchor != null);
  const period = hasCalendar
    ? periodContaining(schedule, anchor, todayYmd)
    : { start: addYmdDays(todayYmd, -13), end: todayYmd };
  const periodStartUtc = zonedMidnightUtc(period.start, tz);
  // Exclusive bound = the org-local start of the day AFTER period.end —
  // a flat +24h drifts an hour off the run machines' window across DST.
  const periodEndUtc = zonedDayStartUtc(zonedMidnightUtc(period.end, tz), tz, 1);

  const myRate = me?.pay_rate_cents ?? null;

  // Current-period shifts (mine only).
  const { data: entries } = (await admin
    .from("time_entries")
    .select("clock_in_at, clock_out_at, needs_review, pay_rate_cents_snapshot")
    .eq("employee_id", membership.id)
    .eq("organization_id", membership.organization_id)
    .gte("clock_in_at", periodStartUtc.toISOString())
    .lt("clock_in_at", periodEndUtc.toISOString())
    // Hours already frozen into a run/statement live in the Statements
    // section — counting them here too showed the same money twice.
    .is("payroll_run_id", null)
    .is("subcontractor_run_id" as never, null as never)
    .limit(500)) as unknown as {
    data: Array<{
      clock_in_at: string;
      clock_out_at: string | null;
      needs_review: boolean | null;
      pay_rate_cents_snapshot: number | null;
    }> | null;
  };

  let minutesSoFar = 0;
  let estimateCents = 0;
  let openShifts = 0;
  let flaggedShifts = 0;
  let missingRate = false;
  for (const e of entries ?? []) {
    if (!e.clock_out_at) {
      openShifts++;
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
    minutesSoFar += mins;
    if (e.needs_review) flaggedShifts++;
    // Same pricing rule as the payroll run machine: the rate frozen when
    // the shift happened wins; today's rate is only the fallback.
    const rate = e.pay_rate_cents_snapshot ?? myRate;
    if (rate == null) missingRate = true;
    else estimateCents += Math.round((mins * rate) / 60);
  }

  // Past statements — finalized/paid only, both pay systems (a member who
  // switched engagement mid-year has history in each).
  const [{ data: payrollItems }, { data: subItems }] = await Promise.all([
    (admin
      .from("payroll_items")
      .select(
        "id, hours_worked, regular_pay_cents, bonus_cents, pto_pay_cents, total_cents, run:payroll_runs!inner ( period_start, period_end, status, paid_at )",
      )
      .eq("employee_id", membership.id)
      .eq("organization_id", membership.organization_id)
      .in("run.status", ["finalized", "paid"])
      // Order on the item's own created_at: PostgREST can't order parents
      // by an embedded column, and runs are created chronologically.
      .order("created_at", { ascending: false })
      .limit(60)) as unknown as Promise<{
      data: Array<{
        id: string;
        hours_worked: number;
        regular_pay_cents: number;
        bonus_cents: number;
        pto_pay_cents: number;
        total_cents: number;
        run: {
          period_start: string;
          period_end: string;
          status: string;
          paid_at: string | null;
        } | null;
      }> | null;
    }>,
    (admin
      .from("subcontractor_pay_items" as never)
      .select(
        "id, minutes, entry_count, total_cents, run:subcontractor_pay_runs!inner ( period_start, period_end, status, paid_at )",
      )
      .eq("membership_id" as never, membership.id as never)
      .eq(
        "organization_id" as never,
        membership.organization_id as never,
      )
      .in("run.status" as never, ["finalized", "paid"] as never)
      .order("created_at" as never, { ascending: false } as never)
      .limit(60)) as unknown as Promise<{
      data: Array<{
        id: string;
        minutes: number;
        entry_count: number;
        total_cents: number;
        run: {
          period_start: string;
          period_end: string;
          status: string;
          paid_at: string | null;
        } | null;
      }> | null;
    }>,
  ]);

  type Statement = {
    id: string;
    periodStart: string;
    periodEnd: string;
    hours: number;
    totalCents: number;
    extraCents: number; // bonuses + PTO on top of hourly (employee runs)
    paid: boolean;
    paidAt: string | null;
  };
  const statements: Statement[] = [
    ...(payrollItems ?? [])
      .filter((i) => i.run)
      .map((i) => ({
        id: i.id,
        periodStart: i.run!.period_start,
        periodEnd: i.run!.period_end,
        hours: Number(i.hours_worked),
        totalCents: i.total_cents,
        extraCents: i.bonus_cents + i.pto_pay_cents,
        paid: i.run!.status === "paid",
        paidAt: i.run!.paid_at,
      })),
    ...(subItems ?? [])
      .filter((i) => i.run)
      .map((i) => ({
        id: i.id,
        periodStart: i.run!.period_start,
        periodEnd: i.run!.period_end,
        hours: i.minutes / 60,
        totalCents: i.total_cents,
        extraCents: 0,
        paid: i.run!.status === "paid",
        paidAt: i.run!.paid_at,
      })),
  ].sort((a, b) => b.periodStart.localeCompare(a.periodStart));

  const fmtDay = (ymd: string) =>
    new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  return (
    <>
      <FieldHeader
        title="My pay"
        description="What this period has added up to, and every statement before it."
      />

      <Link
        href="/field/hours"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        My hours
      </Link>

      {/* Current period — the estimate layer. */}
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {hasCalendar ? "This period" : "Last 14 days"} ·{" "}
          {fmtDay(period.start)} – {fmtDay(period.end)}
        </p>
        <p className="mt-1 text-3xl font-bold tabular-nums">
          {missingRate || (estimateCents === 0 && minutesSoFar === 0)
            ? `${(minutesSoFar / 60).toFixed(1)}h`
            : formatCurrencyCents(estimateCents, currency)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          <span>
            {`${(minutesSoFar / 60).toFixed(1)}h worked so far`}
            {openShifts > 0
              ? ` · ${openShifts} shift${openShifts === 1 ? "" : "s"} still running`
              : ""}
          </span>
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          <span>
            Estimate from your closed shifts — bonuses, PTO and any
            corrections land when the office runs payroll for this period.
          </span>
        </p>
        {flaggedShifts > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/15 px-2 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {`${flaggedShifts} shift${flaggedShifts === 1 ? "" : "s"} awaiting manager confirmation — the total can still change.`}
            </span>
          </p>
        )}
      </div>

      {/* Statements — the frozen layer. */}
      <div className="mb-2 mt-6 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Statements
        </h2>
      </div>
      {statements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-10 text-center text-base text-muted-foreground">
          No pay statements yet — your first appears when the office runs
          your period.
        </div>
      ) : (
        <ul className="space-y-2">
          {statements.map((s) => (
            <li
              key={s.id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold">
                    <span>
                      {fmtDay(s.periodStart)} – {fmtDay(s.periodEnd)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    <span>
                      {`${s.hours.toFixed(1)}h`}
                      {s.extraCents > 0
                        ? ` · includes ${formatCurrencyCents(s.extraCents, currency)} bonus/PTO`
                        : ""}
                    </span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-bold tabular-nums">
                    {formatCurrencyCents(s.totalCents, currency)}
                  </p>
                  {s.paid ? (
                    <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      Paid
                      {s.paidAt
                        ? ` ${new Date(s.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })}`
                        : ""}
                    </p>
                  ) : (
                    <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                      Finalized — payment on the way
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

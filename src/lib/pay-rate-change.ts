import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A pay rate change that starts on a date.
 *
 * Every shift freezes the person's rate when they clock in
 * (time_entries.pay_rate_cents_snapshot), and a pay run prices the shift at
 * that frozen number. So a rate entered late reached nothing already worked:
 * on 2026-11-15 Vira Karpynska's raise was typed in two weeks into the pay
 * period, her ten shifts stayed at the old rate, and no screen could move
 * them. Three weeks earlier her rate had been lowered, apparently by
 * accident, and nothing asked.
 *
 * Now the change says when it starts. Shifts from that moment that are not
 * yet on a pay run take the new rate. Shifts already on a pay run are never
 * touched (the run holds its own totals); they are counted, with what the
 * new rate would have added, so the office knows what is still owed. Every
 * change is a row in pay_rate_changes.
 */

export type RateShift = {
  id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  pay_rate_cents_snapshot: number | null;
  payroll_run_id: string | null;
  subcontractor_run_id: string | null;
};

export type RatePlan = {
  /** Unpaid shifts to move to the new rate. */
  repriceIds: string[];
  /** Shifts from the date already on a pay run, at a different rate. */
  onRuns: number;
  /** What the new rate would add to those (negative for a cut), in cents. */
  owedCents: number;
};

/** The rule, without a database. `shifts` are the person's, from the date on. */
export function planRateChange(shifts: readonly RateShift[], newRateCents: number): RatePlan {
  const plan: RatePlan = { repriceIds: [], onRuns: 0, owedCents: 0 };
  let owed = 0;
  for (const s of shifts) {
    if (s.pay_rate_cents_snapshot === newRateCents) continue;
    if (s.payroll_run_id == null && s.subcontractor_run_id == null) {
      plan.repriceIds.push(s.id);
      continue;
    }
    plan.onRuns += 1;
    if (!s.clock_out_at) continue;
    const minutes = Math.max(0, (Date.parse(s.clock_out_at) - Date.parse(s.clock_in_at)) / 60_000);
    // A shift with no frozen rate was priced at nothing or left out; the
    // whole of it at the new rate is what is owed.
    owed += (minutes / 60) * (newRateCents - (s.pay_rate_cents_snapshot ?? 0));
  }
  plan.owedCents = Math.round(owed);
  return plan;
}

const dollars = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

/** What to tell the person who saved it. Null when there is nothing to add to "Saved". */
export function rateChangeNotice(plan: RatePlan, name: string, newRateCents: number): string | null {
  if (plan.repriceIds.length === 0 && plan.onRuns === 0) return null;
  const parts: string[] = [];
  if (plan.repriceIds.length > 0) {
    const n = plan.repriceIds.length;
    parts.push(`${n} unpaid shift${n === 1 ? "" : "s"} for ${name} ${n === 1 ? "is" : "are"} now at ${dollars(newRateCents)}/hr.`);
  }
  if (plan.onRuns > 0) {
    const n = plan.onRuns;
    const diff =
      plan.owedCents === 0
        ? ""
        : plan.owedCents > 0
          ? ` The new rate would add ${dollars(plan.owedCents)}.`
          : ` The new rate would take off ${dollars(plan.owedCents)}.`;
    parts.push(
      `${n} shift${n === 1 ? " is" : "s are"} already on a pay run and ${n === 1 ? "was" : "were"} not changed.${diff} If that run is still a draft, delete it and prepare it again.`,
    );
  }
  return parts.join(" ");
}

/**
 * The first moment a "starting from" date covers, or an error sentence.
 * Blank means from now: only shifts clocked in after this save.
 */
export function effectiveFrom(
  fromYmd: string,
  todayYmd: string,
  midnightUtc: (ymd: string) => Date,
  now: Date,
): { at: Date; backdated: boolean } | { error: string } {
  const ymd = fromYmd.trim();
  if (ymd === "") return { at: now, backdated: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || Number.isNaN(Date.parse(`${ymd}T00:00:00Z`))) {
    return { error: "Pick the date the new rate starts from." };
  }
  if (ymd > todayYmd) {
    return { error: "The start date can't be in the future. To plan a raise, change the rate on the day it starts." };
  }
  const yearAgo = new Date(Date.parse(`${todayYmd}T00:00:00Z`) - 366 * 86_400_000).toISOString().slice(0, 10);
  if (ymd < yearAgo) return { error: "The start date can't be more than a year back." };
  return { at: midnightUtc(ymd), backdated: true };
}

/** Rows per read, at the API's own cap. A year of shifts is far under ten pages. */
const PAGE = 1000;
const MAX_PAGES = 10;

/**
 * Re-price the person's unpaid shifts from `from`, and record the change.
 * The membership's own rate is the caller's to write; this is everything
 * that follows from it. Throws if the shifts can't be read or written, so a
 * save never reports a re-pricing that did not happen.
 */
export async function applyRateChange(
  admin: SupabaseClient,
  opts: {
    organizationId: string;
    membershipId: string;
    oldRateCents: number | null;
    newRateCents: number | null;
    from: Date;
    /** False for "from now": nothing already worked is touched. */
    backdated: boolean;
    changedBy: string | null;
  },
): Promise<RatePlan> {
  let plan: RatePlan = { repriceIds: [], onRuns: 0, owedCents: 0 };

  if (opts.backdated && opts.newRateCents != null) {
    const shifts: RateShift[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = (await admin
        .from("time_entries")
        .select("id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, payroll_run_id, subcontractor_run_id" as never)
        .eq("organization_id", opts.organizationId)
        .eq("employee_id", opts.membershipId)
        .gte("clock_in_at", opts.from.toISOString())
        .order("clock_in_at")
        .order("id")
        .range(page * PAGE, page * PAGE + PAGE - 1)) as unknown as {
        data: RateShift[] | null;
        error: { message: string } | null;
      };
      if (error) throw new Error(error.message);
      shifts.push(...(data ?? []));
      if ((data ?? []).length < PAGE) break;
    }
    plan = planRateChange(shifts, opts.newRateCents);

    for (let i = 0; i < plan.repriceIds.length; i += 150) {
      const { error } = await admin
        .from("time_entries")
        .update({ pay_rate_cents_snapshot: opts.newRateCents } as never)
        .eq("organization_id", opts.organizationId)
        .eq("employee_id", opts.membershipId)
        // Asked again at write time: a run prepared in the last second has
        // stamped these, and a stamped shift is the run's.
        .is("payroll_run_id", null)
        .is("subcontractor_run_id" as never, null as never)
        .in("id", plan.repriceIds.slice(i, i + 150));
      if (error) throw new Error(error.message);
    }
  }

  const { error: logErr } = await admin.from("pay_rate_changes" as never).insert({
    organization_id: opts.organizationId,
    membership_id: opts.membershipId,
    old_rate_cents: opts.oldRateCents,
    new_rate_cents: opts.newRateCents,
    effective_from: opts.from.toISOString(),
    shifts_repriced: plan.repriceIds.length,
    shifts_on_runs: plan.onRuns,
    owed_cents: plan.owedCents,
    changed_by: opts.changedBy,
  } as never);
  if (logErr) throw new Error(logErr.message);

  return plan;
}

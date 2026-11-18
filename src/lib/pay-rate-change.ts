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
 * Blank means from now: only shifts clocked in after this save. A past date
 * is backdated (unpaid shifts from it are re-priced). A FUTURE date is
 * scheduled: nothing changes today, and the rate changes on that day.
 */
export function effectiveFrom(
  fromYmd: string,
  todayYmd: string,
  midnightUtc: (ymd: string) => Date,
  now: Date,
): { at: Date; backdated: boolean; scheduled: boolean } | { error: string } {
  const ymd = fromYmd.trim();
  if (ymd === "") return { at: now, backdated: false, scheduled: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || Number.isNaN(Date.parse(`${ymd}T00:00:00Z`))) {
    return { error: "Pick the date the new rate starts from." };
  }
  if (ymd > todayYmd) {
    // Planned ahead. Refused until 2026-11-18 ("change the rate on the day
    // it starts"), which left the office to remember to come back.
    const yearAhead = new Date(Date.parse(`${todayYmd}T00:00:00Z`) + 366 * 86_400_000).toISOString().slice(0, 10);
    if (ymd > yearAhead) return { error: "The start date can't be more than a year ahead." };
    return { at: midnightUtc(ymd), backdated: false, scheduled: true };
  }
  const yearAgo = new Date(Date.parse(`${todayYmd}T00:00:00Z`) - 366 * 86_400_000).toISOString().slice(0, 10);
  if (ymd < yearAgo) return { error: "The start date can't be more than a year back." };
  return { at: midnightUtc(ymd), backdated: true, scheduled: false };
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
/**
 * Move the person's unpaid shifts from `from` onto the new rate, and say
 * what was moved and what a pay run already holds. Throws if the shifts
 * can't be read or written.
 */
async function repriceFrom(
  admin: SupabaseClient,
  opts: { organizationId: string; membershipId: string; newRateCents: number; from: Date },
): Promise<RatePlan> {
  let plan: RatePlan = { repriceIds: [], onRuns: 0, owedCents: 0 };
  {
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
  return plan;
}

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
    plan = await repriceFrom(admin, {
      organizationId: opts.organizationId,
      membershipId: opts.membershipId,
      newRateCents: opts.newRateCents,
      from: opts.from,
    });
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

// ---------------------------------------------------------------------------
// A change planned for a future date
// ---------------------------------------------------------------------------

/**
 * Save a rate change that starts on a future day. Nothing about the person
 * changes now: the row waits (scheduled, applied_at null) until its day.
 * One waiting change per person: a new one replaces the old.
 */
export async function scheduleRateChange(
  admin: SupabaseClient,
  opts: {
    organizationId: string;
    membershipId: string;
    oldRateCents: number | null;
    newRateCents: number | null;
    from: Date;
    changedBy: string | null;
  },
): Promise<void> {
  const { error: clearErr } = await admin
    .from("pay_rate_changes" as never)
    .delete()
    .eq("organization_id" as never, opts.organizationId as never)
    .eq("membership_id" as never, opts.membershipId as never)
    .eq("scheduled" as never, true as never)
    .is("applied_at" as never, null as never);
  if (clearErr) throw new Error(clearErr.message);

  const { error } = await admin.from("pay_rate_changes" as never).insert({
    organization_id: opts.organizationId,
    membership_id: opts.membershipId,
    old_rate_cents: opts.oldRateCents,
    new_rate_cents: opts.newRateCents,
    effective_from: opts.from.toISOString(),
    scheduled: true,
    applied_at: null,
    changed_by: opts.changedBy,
  } as never);
  if (error) throw new Error(error.message);
}

/**
 * Apply every scheduled change whose day has come: for one person (asked
 * when they clock in, so their first shift of the day is at the new rate),
 * or for everyone (the nightly job). Each change is claimed before it is
 * applied, so two callers at the same moment apply it once. Unpaid shifts
 * from the start day take the new rate, which covers a shift worked between
 * midnight and the moment this ran. Returns how many were applied.
 */
export async function applyDueRateChanges(
  admin: SupabaseClient,
  opts: { organizationId?: string; membershipId?: string; now?: Date } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  let q = admin
    .from("pay_rate_changes" as never)
    .select("id, organization_id, membership_id, new_rate_cents, effective_from")
    .eq("scheduled" as never, true as never)
    .is("applied_at" as never, null as never)
    .lte("effective_from" as never, now.toISOString() as never);
  if (opts.organizationId) q = q.eq("organization_id" as never, opts.organizationId as never);
  if (opts.membershipId) q = q.eq("membership_id" as never, opts.membershipId as never);
  const { data: due, error } = (await q
    .order("effective_from" as never, { ascending: true } as never)
    .limit(500)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      membership_id: string;
      new_rate_cents: number | null;
      effective_from: string;
    }> | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);

  let applied = 0;
  for (const c of due ?? []) {
    // Claim it: only a change still waiting matches.
    const { data: claimed, error: claimErr } = (await admin
      .from("pay_rate_changes" as never)
      .update({ applied_at: now.toISOString() } as never)
      .eq("id" as never, c.id as never)
      .is("applied_at" as never, null as never)
      .select("id")) as unknown as { data: Array<{ id: string }> | null; error: { message: string } | null };
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed?.length) continue;

    try {
      const { data: member } = (await admin
        .from("memberships")
        .select("pay_rate_cents")
        .eq("id", c.membership_id)
        .eq("organization_id", c.organization_id)
        .maybeSingle()) as unknown as { data: { pay_rate_cents: number | null } | null };
      const { error: rateErr } = await admin
        .from("memberships")
        .update({ pay_rate_cents: c.new_rate_cents } as never)
        .eq("id", c.membership_id)
        .eq("organization_id", c.organization_id);
      if (rateErr) throw new Error(rateErr.message);

      const plan =
        c.new_rate_cents == null
          ? { repriceIds: [], onRuns: 0, owedCents: 0 }
          : await repriceFrom(admin, {
              organizationId: c.organization_id,
              membershipId: c.membership_id,
              newRateCents: c.new_rate_cents,
              from: new Date(c.effective_from),
            });
      // The history line now says what the rate really was on the day, and
      // what was re-priced.
      await admin
        .from("pay_rate_changes" as never)
        .update({
          old_rate_cents: member?.pay_rate_cents ?? null,
          shifts_repriced: plan.repriceIds.length,
          shifts_on_runs: plan.onRuns,
          owed_cents: plan.owedCents,
        } as never)
        .eq("id" as never, c.id as never);
      applied += 1;
    } catch (err) {
      // Give the claim back so the next clock-in or tonight's job tries
      // again, rather than leaving a raise marked applied that was not.
      await admin
        .from("pay_rate_changes" as never)
        .update({ applied_at: null } as never)
        .eq("id" as never, c.id as never);
      throw err;
    }
  }
  return applied;
}

/**
 * applyDueRateChanges for a clock-in: never lets a problem here stop
 * someone starting their shift. A failure is logged and the nightly job
 * picks the change up.
 */
export async function applyDueRateChangesQuietly(
  admin: SupabaseClient,
  opts: { organizationId: string; membershipId: string },
): Promise<void> {
  try {
    await applyDueRateChanges(admin, opts);
  } catch (err) {
    console.error("[pay-rate] scheduled change not applied at clock-in:", err);
  }
}

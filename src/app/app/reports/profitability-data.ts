import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The two report RPCs added in 20260914010000_profitability_reports.sql.
 *
 * Both run SECURITY INVOKER, so the caller's own RLS applies; the Reports
 * page and the CSV export are the only callers and both are owner/admin
 * gated. Each is one round trip that returns the aggregates already summed
 * next to the data, so there is no row cap to warn about here — unlike the
 * in-memory sums the rest of the page still does.
 *
 * Labor here is computed the way payroll computes it (whole minutes, the
 * entry's wage snapshot, round(min × rate / 60)), so a job's cost on this
 * page and its cost on the pay run are the same cents.
 */

export type ProfitTotals = {
  jobs: number;
  jobs_with_time: number;
  revenue_cents: number;
  labor_cents: number;
  margin_cents: number;
  quoted_minutes: number;
  worked_minutes: number;
  unassigned_minutes: number;
  unassigned_labor_cents: number;
  contractor_bills_cents: number;
};

export type ProfitGroup = {
  jobs: number;
  revenue_cents: number;
  labor_cents: number;
  margin_cents: number;
  quoted_minutes: number;
  worked_minutes: number;
};

export type ProfitByClient = ProfitGroup & {
  client_id: string;
  client_name: string;
};

export type ProfitByService = ProfitGroup & { service: string };

export type ProfitJob = {
  id: string;
  client_name: string;
  scheduled_at: string;
  service: string;
  quoted_minutes: number;
  worked_minutes: number;
  revenue_cents: number;
  labor_cents: number;
  margin_cents: number;
  crew: number;
};

export type JobProfitability = {
  totals: ProfitTotals;
  by_client: ProfitByClient[];
  by_service: ProfitByService[];
  worst_jobs: ProfitJob[];
};

export type CleanerRow = {
  employee_id: string;
  name: string;
  engagement: "employee" | "subcontractor";
  status: string;
  minutes: number;
  jobs: number;
  labor_cents: number;
  revenue_cents: number;
  quoted_minutes: number;
  needs_review: number;
  avg_rating: number | null;
  reviews: number;
  bonus_cents: number;
  no_clock_in_flags: number;
};

const EMPTY_TOTALS: ProfitTotals = {
  jobs: 0,
  jobs_with_time: 0,
  revenue_cents: 0,
  labor_cents: 0,
  margin_cents: 0,
  quoted_minutes: 0,
  worked_minutes: 0,
  unassigned_minutes: 0,
  unassigned_labor_cents: 0,
  contractor_bills_cents: 0,
};

// Any client shape works — the page passes the user-scoped server client,
// the CSV route passes the admin client. Typed loosely because the generated
// database types don't know these functions yet.
type AnyClient = Pick<SupabaseClient, "rpc">;

/** Never throws: a report that fails renders as empty, not as an error page. */
export async function fetchJobProfitability(
  supabase: AnyClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<JobProfitability> {
  const { data } = (await supabase.rpc("report_job_profitability" as never, {
    p_org: orgId,
    p_from: fromIso,
    p_to: toIso,
  } as never)) as unknown as { data: Partial<JobProfitability> | null };
  return {
    totals: { ...EMPTY_TOTALS, ...(data?.totals ?? {}) },
    by_client: data?.by_client ?? [],
    by_service: data?.by_service ?? [],
    worst_jobs: data?.worst_jobs ?? [],
  };
}

export async function fetchCleanerScorecard(
  supabase: AnyClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<CleanerRow[]> {
  const { data } = (await supabase.rpc("report_cleaner_scorecard" as never, {
    p_org: orgId,
    p_from: fromIso,
    p_to: toIso,
  } as never)) as unknown as { data: CleanerRow[] | null };
  return Array.isArray(data) ? data : [];
}

/** Margin as a whole-number percentage of revenue, or null when nothing was billed. */
export function marginPct(revenueCents: number, marginCents: number): number | null {
  if (revenueCents <= 0) return null;
  return Math.round((marginCents / revenueCents) * 100);
}

/** Worked minus quoted, as a signed percentage of quoted; null when nothing was quoted. */
export function overrunPct(quotedMinutes: number, workedMinutes: number): number | null {
  if (quotedMinutes <= 0) return null;
  return Math.round(((workedMinutes - quotedMinutes) / quotedMinutes) * 100);
}

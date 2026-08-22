import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CoveringRun = {
  id: string;
  period_start: string;
  period_end: string;
};

/**
 * The pay run whose period overlaps [startYmd, endYmd], if one exists.
 *
 * Runs are generated FROM the rows that exist at generation time — they
 * never re-read the period afterward. So a time entry, bonus, or PTO
 * approval dated into a period a run already covers is invisible to the
 * pay system: no future run's window reaches back, and the covering run
 * was built before the row existed. The row would sit there looking
 * recorded while never being paid. Callers use this to refuse those
 * writes up front and point at the unlock (delete the run, add the row,
 * regenerate) instead of letting hours or money silently orphan.
 *
 * Overlap, not containment, to match how runs themselves gather PTO — a
 * range straddling a period boundary belongs to the run that overlaps it.
 */
export async function runCoveringWindow(
  db: SupabaseClient,
  organizationId: string,
  startYmd: string,
  endYmd: string,
  table: "payroll_runs" | "subcontractor_pay_runs",
): Promise<CoveringRun | null> {
  const { data } = (await db
    .from(table)
    .select("id, period_start, period_end")
    .eq("organization_id", organizationId)
    .lte("period_start", endYmd)
    .gte("period_end", startYmd)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle()) as unknown as { data: CoveringRun | null };
  return data ?? null;
}

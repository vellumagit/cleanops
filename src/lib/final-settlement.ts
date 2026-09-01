import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrgTimezone } from "@/lib/org-timezone";
import { zonedYmd } from "@/lib/wall-clock";

/**
 * Everything the business still owes one person, on one number.
 *
 * The offboarding audit found the debts scattered across four tables with
 * four different visibilities: unpaid hours WOULD be picked up by the next
 * run (invisible until then), pending bonuses would be skipped forever,
 * tips owed sat on the payroll page's org-wide card, and approved future
 * PTO sat nowhere at all. This aggregates them per person so the employee
 * file (and the edit page, before the owner flips the switch) can show a
 * settlement instead of a shrug.
 *
 * Pricing matches the run machines exactly — pay_rate_cents_snapshot first,
 * current member rate as fallback, minutes = whole minutes, integer cents
 * per entry (see src/lib/subcontractor-run.ts). "The same shift must not be
 * worth two different amounts depending on which screen you open."
 *
 * PTO is counted but NOT priced into the total: whether approved-but-unused
 * time off gets paid out on exit is the owner's call (and jurisdiction's),
 * so it's surfaced as hours awaiting a decision, never silently added.
 */

export type FinalSettlement = {
  /** Closed, reviewed, unpaid hours — the next run WILL pay these. */
  unpaidMinutes: number;
  unpaidHoursCents: number;
  unpaidEntryCount: number;
  /** Closed but needs_review — blocked from every run until confirmed. */
  flaggedCount: number;
  /** Pending bonuses no future run will pick up once they're off-roster. */
  bonusCents: number;
  bonusCount: number;
  /** Tips collected by the business, not yet handed over. */
  tipsCents: number;
  tipsCount: number;
  /** Approved time off reaching today or later — pay-or-void decision. */
  ptoHours: number;
  ptoCount: number;
  /** hours + bonuses + tips. PTO deliberately excluded (see above). */
  totalCents: number;
};

export async function getFinalSettlement(
  admin: SupabaseClient,
  organizationId: string,
  membershipId: string,
  /** memberships.pay_rate_cents — fallback for legacy entries without a snapshot. */
  fallbackRateCents: number | null,
): Promise<FinalSettlement> {
  // The ORG's today, not the server's. Vercel runs in UTC, so a plain
  // toISOString() cutoff rolls over mid-evening in the Americas and drops
  // time off that ends today out of the "still owed" count — the one
  // number this whole screen exists to get right.
  const todayYmd = zonedYmd(
    new Date(),
    await getOrgTimezone(organizationId),
  );

  const [
    { data: entries },
    { count: flagged },
    { data: bonuses },
    { data: tips },
    { data: pto },
  ] = await Promise.all([
    admin
      .from("time_entries")
      .select(
        "clock_in_at, clock_out_at, pay_rate_cents_snapshot" as never,
      )
      .eq("organization_id", organizationId)
      .eq("employee_id", membershipId)
      .is("payroll_run_id", null)
      .is("subcontractor_run_id" as never, null as never)
      .eq("needs_review" as never, false as never)
      .not("clock_out_at", "is", null)
      // PostgREST's hard cap. One person exceeding 1000 unpaid entries
      // would under-report here — the run machines refuse loudly at the
      // same cap, so the money itself can never be silently short-paid.
      .limit(1000) as unknown as Promise<{
      data: Array<{
        clock_in_at: string | null;
        clock_out_at: string | null;
        pay_rate_cents_snapshot: number | null;
      }> | null;
    }>,
    admin
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("employee_id", membershipId)
      .is("payroll_run_id", null)
      .is("subcontractor_run_id" as never, null as never)
      .eq("needs_review" as never, true as never) as unknown as Promise<{
      count: number | null;
    }>,
    // payroll_run_id NULL on bonuses and PTO: rows a prepared run already
    // claimed WILL be paid by it — counting them here would double the debt.
    admin
      .from("bonuses")
      .select("amount_cents")
      .eq("organization_id", organizationId)
      .eq("employee_id", membershipId)
      .eq("status", "pending")
      .is("payroll_run_id", null) as unknown as Promise<{
      data: Array<{ amount_cents: number }> | null;
    }>,
    admin
      .from("invoice_tips" as never)
      .select("amount_cents")
      .eq("organization_id" as never, organizationId as never)
      .eq("membership_id" as never, membershipId as never)
      .is("paid_out_at" as never, null as never) as unknown as Promise<{
      data: Array<{ amount_cents: number }> | null;
    }>,
    admin
      .from("pto_requests")
      .select("hours")
      .eq("organization_id", organizationId)
      .eq("employee_id", membershipId)
      .eq("status", "approved")
      .is("payroll_run_id" as never, null as never)
      .gte("end_date", todayYmd) as unknown as Promise<{
      data: Array<{ hours: number | string }> | null;
    }>,
  ]);

  let unpaidMinutes = 0;
  let unpaidHoursCents = 0;
  let unpaidEntryCount = 0;
  for (const e of entries ?? []) {
    if (!e.clock_in_at || !e.clock_out_at) continue;
    const mins = Math.max(
      0,
      Math.round(
        (new Date(e.clock_out_at).getTime() -
          new Date(e.clock_in_at).getTime()) /
          60_000,
      ),
    );
    if (mins === 0) continue;
    const rate = e.pay_rate_cents_snapshot ?? fallbackRateCents ?? 0;
    unpaidMinutes += mins;
    unpaidHoursCents += Math.round((mins * rate) / 60);
    unpaidEntryCount += 1;
  }

  const bonusCents = (bonuses ?? []).reduce((s, b) => s + b.amount_cents, 0);
  const tipsCents = (tips ?? []).reduce((s, t) => s + t.amount_cents, 0);
  const ptoHours = (pto ?? []).reduce((s, p) => s + Number(p.hours || 0), 0);

  return {
    unpaidMinutes,
    unpaidHoursCents,
    unpaidEntryCount,
    flaggedCount: flagged ?? 0,
    bonusCents,
    bonusCount: bonuses?.length ?? 0,
    tipsCents,
    tipsCount: tips?.length ?? 0,
    ptoHours,
    ptoCount: pto?.length ?? 0,
    totalCents: unpaidHoursCents + bonusCents + tipsCents,
  };
}

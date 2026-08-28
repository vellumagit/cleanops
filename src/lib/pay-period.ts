import "server-only";

import { createPayrollRunForOrg } from "@/lib/payroll-run-create";
import { createContractorRunForOrg } from "@/lib/contractor-run-create";

/**
 * One period, both pay systems. Brian: "when I click start this run, I
 * wanna go into the next section, breaking down how much do I owe my
 * employees AND how much do I owe my contractors, for that pay period."
 *
 * Preparing a period creates the employee payroll run and the contractor
 * statement for the same window (each skipping cleanly when its side has
 * nothing to pay). STRICTLY the window: the original straggler sweep
 * vacuumed months of old unpaid hours into whatever period ran next —
 * Olha showed 143h in a 15-day window ("clearly not taking just from
 * August first to the fifteenth"). Brian's rule now: old hours get
 * settled by going BACK and preparing their own period, which the
 * Payroll page offers directly. Flagged shifts on EITHER side still
 * block the whole prepare.
 */

export type PreparedPeriod =
  | {
      ok: true;
      href: string;
      payroll: { id: string; totalCents: number } | null;
      contractor: { id: string; totalCents: number } | null;
    }
  | { ok: false; error: string; flagged?: number };

export function periodHref(periodStart: string, periodEnd: string): string {
  return `/app/payroll/periods/${periodStart}_${periodEnd}`;
}

export async function preparePayPeriod(opts: {
  organizationId: string;
  createdByMembershipId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<PreparedPeriod> {
  const base = { ...opts, includeStragglers: false };

  const payroll = await createPayrollRunForOrg(base);
  if (!payroll.ok && !payroll.nothing) {
    // Real failure (flags, race, insert error) — stop before touching the
    // contractor side so the period never half-exists.
    return { ok: false, error: payroll.error, flagged: payroll.flagged };
  }

  const contractor = await createContractorRunForOrg(base);
  if (!contractor.ok && !contractor.nothing) {
    // Unwind is unnecessary: the payroll run (if created) is a valid draft
    // on its own; surface the contractor error with that context.
    const prefix = payroll.ok
      ? "Employee run created, but the contractor statement failed: "
      : "";
    return {
      ok: false,
      error: `${prefix}${contractor.error}`,
      flagged: contractor.flagged,
    };
  }

  if (!payroll.ok && !contractor.ok) {
    return {
      ok: false,
      error:
        "Nothing unpaid in this window — no employee hours, bonuses, or PTO, and no contractor hours.",
    };
  }

  return {
    ok: true,
    href: periodHref(opts.periodStart, opts.periodEnd),
    payroll: payroll.ok ? { id: payroll.id, totalCents: payroll.totalCents } : null,
    contractor: contractor.ok
      ? { id: contractor.id, totalCents: contractor.totalCents }
      : null,
  };
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrgTimezone } from "@/lib/org-timezone";
import { zonedYmd } from "@/lib/wall-clock";
import { periodHref } from "@/lib/pay-period";

/**
 * Everything still open when someone leaves.
 *
 * Two kinds of money:
 *   - NOT YET IN A RUN — hours no run has claimed, pending bonuses, tips
 *     owed, approved future PTO. These have no automatic collector once the
 *     person is off the roster (a bonus never joins a run; PTO for a
 *     departed person is a decision, not a payout).
 *   - IN A RUN, NOT YET PAID — lines on a payroll run or contractor
 *     statement whose run hasn't been marked paid. Jim (2026-09-04): every
 *     shift sat on three finalized-but-unpaid runs, and the card said
 *     "Nothing owed" because it only counted the first kind. The money was
 *     owed; the card had handed responsibility to runs nobody finished.
 *
 * Plus the one non-money thing that bites: jobs they are still assigned
 * to in the future. Deactivation sweeps those, but a person deactivated
 * before the sweep existed, or re-assigned afterwards by hand, can still
 * be the only cleaner on Tuesday's job.
 */

export type InFlightRun = {
  kind: "payroll" | "contractor";
  runId: string;
  periodStart: string;
  periodEnd: string;
  /** payroll: draft | finalized; contractor: finalized. Never "paid". */
  status: string;
  cents: number;
  href: string;
};

export type OpenShift = {
  bookingId: string;
  scheduledAt: string;
  status: string;
  clientName: string | null;
};

export type FinalSettlement = {
  unpaidMinutes: number;
  unpaidHoursCents: number;
  unpaidEntryCount: number;
  flaggedCount: number;
  bonusCents: number;
  bonusCount: number;
  tipsCents: number;
  tipsCount: number;
  ptoHours: number;
  ptoCount: number;
  /** Runs that claimed their hours but were never marked paid. */
  inFlightRuns: InFlightRun[];
  inFlightCents: number;
  /** Future jobs they are still the cleaner on. */
  openShifts: OpenShift[];
  openShiftCount: number;
  /** Unclaimed hours + bonuses + tips + in-flight runs. */
  totalCents: number;
  /** True when nothing on the card needs a human. */
  allClear: boolean;
};

const OPEN_BOOKING_STATUSES = ["pending", "confirmed", "en_route", "in_progress"];

export async function getFinalSettlement(
  admin: SupabaseClient,
  organizationId: string,
  membershipId: string,
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
  const nowIso = new Date().toISOString();

  const [
    { data: entries },
    { count: flagged },
    { data: bonuses },
    { data: tips },
    { data: pto },
    { data: payrollLines },
    { data: contractorLines },
    { data: primaryShifts },
    { data: crewShifts },
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
    // claimed WILL be paid by it — and that run shows up below as in-flight.
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
    // Their line on every payroll run. The run's status decides whether
    // it's still owed; the embed comes back null for runs filtered out,
    // so the JS below drops those.
    admin
      .from("payroll_items")
      .select(
        "total_cents, run:payroll_runs!inner ( id, status, period_start, period_end )",
      )
      .eq("organization_id", organizationId)
      .eq("employee_id", membershipId)
      .neq("run.status", "paid") as unknown as Promise<{
      data: Array<{
        total_cents: number;
        run: {
          id: string;
          status: string;
          period_start: string;
          period_end: string;
        } | null;
      }> | null;
    }>,
    admin
      .from("subcontractor_pay_items" as never)
      .select(
        "total_cents, run:subcontractor_pay_runs!inner ( id, status, period_start, period_end )",
      )
      .eq("organization_id" as never, organizationId as never)
      .eq("membership_id" as never, membershipId as never)
      .neq("run.status" as never, "paid" as never) as unknown as Promise<{
      data: Array<{
        total_cents: number;
        run: {
          id: string;
          status: string;
          period_start: string;
          period_end: string;
        } | null;
      }> | null;
    }>,
    admin
      .from("bookings")
      .select("id, scheduled_at, status, client:clients ( name )")
      .eq("organization_id", organizationId)
      .eq("assigned_to", membershipId)
      .is("archived_at", null)
      .gte("scheduled_at", nowIso)
      .in("status", OPEN_BOOKING_STATUSES)
      .order("scheduled_at", { ascending: true })
      .limit(50) as unknown as Promise<{
      data: Array<{
        id: string;
        scheduled_at: string;
        status: string;
        client: { name: string } | null;
      }> | null;
    }>,
    admin
      .from("booking_assignees")
      .select(
        "booking:bookings!inner ( id, scheduled_at, status, organization_id, archived_at, client:clients ( name ) )",
      )
      .eq("membership_id", membershipId)
      .eq("booking.organization_id", organizationId)
      .is("booking.archived_at", null)
      .gte("booking.scheduled_at", nowIso)
      .in("booking.status", OPEN_BOOKING_STATUSES)
      .limit(50) as unknown as Promise<{
      data: Array<{
        booking: {
          id: string;
          scheduled_at: string;
          status: string;
          client: { name: string } | null;
        } | null;
      }> | null;
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

  const inFlightRuns: InFlightRun[] = [];
  for (const l of payrollLines ?? []) {
    if (!l.run || l.run.status === "paid") continue;
    inFlightRuns.push({
      kind: "payroll",
      runId: l.run.id,
      periodStart: l.run.period_start,
      periodEnd: l.run.period_end,
      status: l.run.status,
      cents: l.total_cents ?? 0,
      href: periodHref(l.run.period_start, l.run.period_end),
    });
  }
  for (const l of contractorLines ?? []) {
    if (!l.run || l.run.status === "paid") continue;
    inFlightRuns.push({
      kind: "contractor",
      runId: l.run.id,
      periodStart: l.run.period_start,
      periodEnd: l.run.period_end,
      status: l.run.status,
      cents: l.total_cents ?? 0,
      href: periodHref(l.run.period_start, l.run.period_end),
    });
  }
  inFlightRuns.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const inFlightCents = inFlightRuns.reduce((s, r) => s + r.cents, 0);

  // Future jobs, primary and crew, deduped by booking.
  const shiftMap = new Map<string, OpenShift>();
  for (const b of primaryShifts ?? []) {
    shiftMap.set(b.id, {
      bookingId: b.id,
      scheduledAt: b.scheduled_at,
      status: b.status,
      clientName: b.client?.name ?? null,
    });
  }
  for (const r of crewShifts ?? []) {
    const b = r.booking;
    if (!b || shiftMap.has(b.id)) continue;
    shiftMap.set(b.id, {
      bookingId: b.id,
      scheduledAt: b.scheduled_at,
      status: b.status,
      clientName: b.client?.name ?? null,
    });
  }
  const openShifts = [...shiftMap.values()].sort((a, b) =>
    a.scheduledAt.localeCompare(b.scheduledAt),
  );

  const totalCents = unpaidHoursCents + bonusCents + tipsCents + inFlightCents;
  const allClear =
    totalCents === 0 &&
    (pto?.length ?? 0) === 0 &&
    (flagged ?? 0) === 0 &&
    openShifts.length === 0;

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
    inFlightRuns,
    inFlightCents,
    openShifts,
    openShiftCount: openShifts.length,
    totalCents,
    allClear,
  };
}

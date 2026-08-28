import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgTimezone } from "@/lib/org-timezone";
import { zonedDayStartUtc, zonedMidnightUtc } from "@/lib/wall-clock";

/**
 * Employee payroll-run creation, moved verbatim from createPayrollRunAction
 * so the cron autodraft and the "prepare period" button share one machine.
 * Every hard-won invariant travels with it:
 *
 * - Org-local calendar-day window, half-open end (the #80 bug class).
 * - needs_review hours BLOCK the run — capped guesses must not become money.
 * - Hours-only buckets for people flipped to subcontractor since (their
 *   employee-era hours still settle here; their current PTO/bonuses don't).
 * - Zero-value people are dropped AND their rows left unstamped.
 * - CLAIM-guarded stamps: a concurrent run for the same window loses the
 *   race, claims fewer rows than it priced, and unwinds completely.
 *
 * New here: `includeStragglers` sweeps unpaid employee hours from BEFORE
 * the period into it (Brian: "no hours found ... which is definitely
 * untrue" — old unpaid time made the window-only run look like a liar).
 * Swept time is named in the run's notes, never silent.
 */

export type CreateRunOutcome =
  | { ok: true; id: string; totalCents: number }
  | {
      ok: false;
      error: string;
      /** True when the window simply had nothing to pay. */
      nothing?: boolean;
      /** Set when capped shifts block the run. */
      flagged?: number;
    };

export async function createPayrollRunForOrg(opts: {
  organizationId: string;
  createdByMembershipId: string;
  periodStart: string;
  periodEnd: string;
  includeStragglers?: boolean;
}): Promise<CreateRunOutcome> {
  const {
    organizationId,
    createdByMembershipId,
    periodStart: period_start,
    periodEnd: period_end,
    includeStragglers = false,
  } = opts;
  const admin = createSupabaseAdminClient();

  const orgTz = await getOrgTimezone(organizationId);
  const fromIso = zonedMidnightUtc(period_start, orgTz).toISOString();
  const toIso = zonedDayStartUtc(
    zonedMidnightUtc(period_end, orgTz),
    orgTz,
    1,
  ).toISOString();

  // Refuse to pay hours the system doesn't believe. With stragglers on,
  // an old capped shift blocks too — sweeping it in silently would be
  // exactly the invented-hours-to-bank-transfer path.
  let flaggedQuery = admin
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("payroll_run_id", null)
    .lt("clock_in_at", toIso)
    .or("engagement_snapshot.eq.employee,engagement_snapshot.is.null")
    .eq("needs_review" as never, true as never);
  if (!includeStragglers) flaggedQuery = flaggedQuery.gte("clock_in_at", fromIso);
  const { count: unreviewed } = (await flaggedQuery) as unknown as {
    count: number | null;
  };
  if ((unreviewed ?? 0) > 0) {
    return {
      ok: false,
      flagged: unreviewed ?? 0,
      error: `${unreviewed} shift${unreviewed === 1 ? "" : "s"} still need${unreviewed === 1 ? "s" : ""} review — nobody clocked out and the system capped the hours. Confirm or correct them on the Timesheets page, then run payroll.`,
    };
  }

  let entriesQuery = admin
    .from("time_entries")
    .select(
      "id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, engagement_snapshot" as never,
    )
    .eq("organization_id", organizationId)
    .is("payroll_run_id", null)
    .lt("clock_in_at", toIso)
    .or("engagement_snapshot.eq.employee,engagement_snapshot.is.null")
    .not("clock_out_at", "is", null);
  if (!includeStragglers) entriesQuery = entriesQuery.gte("clock_in_at", fromIso);

  const [{ data: entries }, { data: employees }, { data: bonuses }, { data: ptoRequests }] =
    await Promise.all([
      entriesQuery as unknown as Promise<{
        data: Array<{
          id: string;
          employee_id: string | null;
          clock_in_at: string | null;
          clock_out_at: string | null;
          pay_rate_cents_snapshot: number | null;
          engagement_snapshot: string | null;
        }> | null;
      }>,
      // Every active EMPLOYEE — the one place the two pay systems partition.
      admin
        .from("memberships")
        .select(
          "id, pay_rate_cents, display_name, profile:profiles ( full_name )",
        )
        .eq("status", "active")
        .eq("engagement" as never, "employee" as never)
        .eq("organization_id", organizationId) as unknown as Promise<{
        data: Array<{
          id: string;
          pay_rate_cents: number | null;
          display_name: string | null;
          profile: { full_name: string | null } | null;
        }> | null;
      }>,
      // Bonuses and PTO stay strictly window-scoped even in straggler mode:
      // hours were the complaint, and both of these already have their own
      // straddle rules.
      admin
        .from("bonuses")
        .select("id, employee_id, amount_cents, status, period_end")
        .eq("organization_id", organizationId)
        .is("payroll_run_id", null)
        .gte("period_end", period_start)
        .lte("period_end", period_end)
        .in("status", ["pending"]) as unknown as Promise<{
        data: Array<{
          id: string;
          employee_id: string | null;
          amount_cents: number | null;
        }> | null;
      }>,
      admin
        .from("pto_requests")
        .select("id, employee_id, hours, status")
        .eq("organization_id", organizationId)
        .eq("status", "approved")
        .is("payroll_run_id" as never, null as never)
        .lte("start_date", period_end)
        .gte("end_date", period_start) as unknown as Promise<{
        data: Array<{ id: string; employee_id: string; hours: number }> | null;
      }>,
    ]);

  type Bucket = {
    employeeName: string;
    minutes: number;
    regularCents: number;
    bonusCents: number;
    ptoHours: number;
    ptoCents: number;
    payRateCents: number;
  };

  const buckets = new Map<string, Bucket>();
  const countedEntries: Array<{ id: string; employeeId: string }> = [];
  const countedBonuses: Array<{ id: string; employeeId: string }> = [];
  const countedPto: Array<{ id: string; employeeId: string }> = [];

  for (const emp of employees ?? []) {
    buckets.set(emp.id, {
      employeeName:
        emp.display_name?.trim() || emp.profile?.full_name?.trim() || "Unknown",
      minutes: 0,
      regularCents: 0,
      bonusCents: 0,
      ptoHours: 0,
      ptoCents: 0,
      payRateCents: emp.pay_rate_cents ?? 0,
    });
  }

  // Flipped-to-subcontractor owners of employee-era hours: hours-only buckets.
  const hoursOnly = new Set<string>();
  {
    const flippedIds = Array.from(
      new Set(
        (entries ?? [])
          .filter(
            (e) =>
              e.engagement_snapshot === "employee" &&
              e.employee_id &&
              !buckets.has(e.employee_id),
          )
          .map((e) => e.employee_id as string),
      ),
    );
    if (flippedIds.length > 0) {
      const { data: flipped } = (await admin
        .from("memberships")
        .select("id, pay_rate_cents, display_name, profile:profiles ( full_name )")
        .in("id", flippedIds)
        .eq("organization_id", organizationId)) as unknown as {
        data: Array<{
          id: string;
          pay_rate_cents: number | null;
          display_name: string | null;
          profile: { full_name: string | null } | null;
        }> | null;
      };
      for (const m of flipped ?? []) {
        hoursOnly.add(m.id);
        buckets.set(m.id, {
          employeeName:
            m.display_name?.trim() || m.profile?.full_name?.trim() || "Unknown",
          minutes: 0,
          regularCents: 0,
          bonusCents: 0,
          ptoHours: 0,
          ptoCents: 0,
          payRateCents: m.pay_rate_cents ?? 0,
        });
      }
    }
  }

  // Sum hours worked; track how much predates the window for the note.
  let stragglerMinutes = 0;
  for (const e of entries ?? []) {
    if (!e.employee_id || !e.clock_in_at || !e.clock_out_at) continue;
    const bucket = buckets.get(e.employee_id);
    if (!bucket) continue;
    countedEntries.push({ id: e.id, employeeId: e.employee_id });
    const mins = Math.max(
      0,
      Math.round(
        (new Date(e.clock_out_at).getTime() -
          new Date(e.clock_in_at).getTime()) /
          60_000,
      ),
    );
    bucket.minutes += mins;
    if (e.clock_in_at < fromIso) stragglerMinutes += mins;
    // Wage snapshot first, current wage second — the booking's billing
    // rate never pays anyone.
    const rate = e.pay_rate_cents_snapshot ?? bucket.payRateCents;
    bucket.regularCents += Math.round((mins * rate) / 60);
  }

  for (const b of bonuses ?? []) {
    if (!b.employee_id) continue;
    if (hoursOnly.has(b.employee_id)) continue;
    const bucket = buckets.get(b.employee_id);
    if (!bucket) continue;
    countedBonuses.push({ id: b.id, employeeId: b.employee_id });
    bucket.bonusCents += b.amount_cents ?? 0;
  }

  for (const p of ptoRequests ?? []) {
    if (hoursOnly.has(p.employee_id)) continue;
    const bucket = buckets.get(p.employee_id);
    if (!bucket) continue;
    countedPto.push({ id: p.id, employeeId: p.employee_id });
    const h = Number(p.hours) || 0;
    bucket.ptoHours += h;
    bucket.ptoCents += Math.round(h * bucket.payRateCents);
  }

  const items = [...buckets.entries()]
    .map(([employeeId, b]) => ({
      employeeId,
      ...b,
      totalCents: b.regularCents + b.bonusCents + b.ptoCents,
    }))
    .filter((i) => i.minutes > 0 || i.bonusCents > 0 || i.ptoCents > 0);

  if (items.length === 0) {
    return {
      ok: false,
      nothing: true,
      error: "No unpaid employee hours, bonuses, or PTO for this period.",
    };
  }

  const runTotalCents = items.reduce((s, i) => s + i.totalCents, 0);

  const stragglerNote =
    stragglerMinutes > 0
      ? `Includes ${Math.floor(stragglerMinutes / 60)}h ${String(stragglerMinutes % 60).padStart(2, "0")}m of unpaid time from before this period — swept in so nothing is left behind.`
      : null;

  const { data: run, error: runErr } = (await admin
    .from("payroll_runs")
    .insert({
      organization_id: organizationId,
      period_start,
      period_end,
      status: "draft",
      total_cents: runTotalCents,
      created_by: createdByMembershipId,
      ...(stragglerNote ? { notes: stragglerNote } : {}),
    } as never)
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };
  if (runErr || !run) {
    return { ok: false, error: runErr?.message ?? "Failed to create payroll run." };
  }

  const itemsToInsert = items.map((i) => ({
    payroll_run_id: run.id,
    organization_id: organizationId,
    employee_id: i.employeeId,
    employee_name: i.employeeName,
    hours_worked: Math.round((i.minutes / 60) * 100) / 100,
    regular_pay_cents: i.regularCents,
    bonus_cents: i.bonusCents,
    pto_hours: i.ptoHours,
    pto_pay_cents: i.ptoCents,
    total_cents: i.totalCents,
  }));

  const { error: itemsErr } = (await admin
    .from("payroll_items")
    .insert(itemsToInsert as never)) as unknown as {
    error: { message: string } | null;
  };
  if (itemsErr) {
    await admin.from("payroll_runs").delete().eq("id", run.id);
    return { ok: false, error: itemsErr.message };
  }

  // Stamp ONLY rows belonging to people who survived the zero-value filter,
  // claim-guarded so a concurrent run can't double-pay.
  const included = new Set(items.map((i) => i.employeeId));
  const stampEntryIds = countedEntries
    .filter((c) => included.has(c.employeeId))
    .map((c) => c.id);
  const stampBonusIds = countedBonuses
    .filter((c) => included.has(c.employeeId))
    .map((c) => c.id);
  const stampPtoIds = countedPto
    .filter((c) => included.has(c.employeeId))
    .map((c) => c.id);

  const expectedClaims =
    stampEntryIds.length + stampBonusIds.length + stampPtoIds.length;
  let claims = 0;
  if (stampEntryIds.length > 0) {
    const { data: got } = (await admin
      .from("time_entries")
      .update({ payroll_run_id: run.id })
      .is("payroll_run_id", null)
      .in("id", stampEntryIds)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    claims += got?.length ?? 0;
  }
  if (stampBonusIds.length > 0) {
    const { data: got } = (await admin
      .from("bonuses")
      .update({ payroll_run_id: run.id })
      .is("payroll_run_id", null)
      .in("id", stampBonusIds)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    claims += got?.length ?? 0;
  }
  if (stampPtoIds.length > 0) {
    const { data: got } = (await admin
      .from("pto_requests")
      .update({ payroll_run_id: run.id } as never)
      .is("payroll_run_id" as never, null as never)
      .in("id", stampPtoIds)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    claims += got?.length ?? 0;
  }
  if (claims !== expectedClaims) {
    await (admin
      .from("time_entries")
      .update({ payroll_run_id: null })
      .eq("payroll_run_id", run.id) as unknown as Promise<unknown>);
    await (admin
      .from("bonuses")
      .update({ payroll_run_id: null })
      .eq("payroll_run_id", run.id) as unknown as Promise<unknown>);
    await (admin
      .from("pto_requests")
      .update({ payroll_run_id: null } as never)
      .eq("payroll_run_id" as never, run.id as never) as unknown as Promise<unknown>);
    await admin.from("payroll_runs").delete().eq("id", run.id);
    return {
      ok: false,
      error:
        "Another payroll run consumed some of these hours at the same moment — check the runs list before trying again.",
    };
  }

  return { ok: true, id: run.id, totalCents: runTotalCents };
}

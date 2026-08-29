import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgTimezone } from "@/lib/org-timezone";
import { zonedDayStartUtc, zonedMidnightUtc } from "@/lib/wall-clock";
import { memberDisplayName } from "@/lib/member-display";
import { groupEntriesForRun, runTotalCents } from "@/lib/subcontractor-run";

/**
 * Subcontractor statement creation, moved verbatim from
 * generateSubcontractorRunAction so the period-prepare flow and the cron
 * autodraft share it with the payroll-run twin. Sub-era hours only
 * (engagement snapshot), capped needs_review hours block, claim-guarded
 * stamps unwind on a lost race. `includeStragglers` sweeps older unpaid
 * sub-era hours into the statement, same rule as the payroll side.
 */

export type CreateStatementOutcome =
  | { ok: true; id: string; totalCents: number }
  | { ok: false; error: string; nothing?: boolean; flagged?: number };

export async function createContractorRunForOrg(opts: {
  organizationId: string;
  createdByMembershipId: string;
  periodStart: string;
  periodEnd: string;
  includeStragglers?: boolean;
}): Promise<CreateStatementOutcome> {
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

  const { data: subs } = (await admin
    .from("memberships")
    .select("id, pay_rate_cents, display_name, profile:profiles ( full_name )")
    .eq("organization_id", organizationId)
    .eq("engagement" as never, "subcontractor" as never)) as unknown as {
    data: Array<{
      id: string;
      pay_rate_cents: number | null;
      display_name: string | null;
      profile: { full_name: string | null } | null;
    }> | null;
  };
  const subIds = (subs ?? []).map((s) => s.id);
  const eraFilter =
    subIds.length > 0
      ? `engagement_snapshot.eq.subcontractor,and(engagement_snapshot.is.null,employee_id.in.(${subIds.join(",")}))`
      : "engagement_snapshot.eq.subcontractor";

  let flaggedQuery = admin
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("payroll_run_id", null)
    .is("subcontractor_run_id" as never, null as never)
    .lt("clock_in_at", toIso)
    .or(eraFilter)
    .eq("needs_review" as never, true as never);
  if (!includeStragglers) flaggedQuery = flaggedQuery.gte("clock_in_at", fromIso);
  const { count: unreviewed } = (await flaggedQuery) as unknown as {
    count: number | null;
  };
  if ((unreviewed ?? 0) > 0) {
    return {
      ok: false,
      flagged: unreviewed ?? 0,
      error: `${unreviewed} shift${unreviewed === 1 ? "" : "s"} still need${unreviewed === 1 ? "s" : ""} review — nobody clocked out and the system capped the hours. Confirm or correct them on Timesheets, then generate.`,
    };
  }

  let entriesQuery = admin
    .from("time_entries")
    .select(
      "id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot" as never,
    )
    .eq("organization_id", organizationId)
    .is("payroll_run_id", null)
    .is("subcontractor_run_id" as never, null as never)
    .eq("needs_review" as never, false as never)
    .not("clock_out_at", "is", null)
    .lt("clock_in_at", toIso)
    .or(eraFilter);
  if (!includeStragglers) entriesQuery = entriesQuery.gte("clock_in_at", fromIso);
  const { data: entries } = (await entriesQuery) as unknown as {
    data: Array<{
      id: string;
      employee_id: string | null;
      clock_in_at: string | null;
      clock_out_at: string | null;
      pay_rate_cents_snapshot: number | null;
    }> | null;
  };

  // PostgREST caps unranged selects at 1000 rows; a bigger window would
  // silently price an arbitrary subset. Refuse loudly — split the period.
  if ((entries?.length ?? 0) >= 1000) {
    return {
      ok: false,
      error:
        "This window has too many time entries to price safely in one statement. Split it into shorter periods and generate each.",
    };
  }

  const rateById = new Map<string, number | null>(
    (subs ?? []).map((s) => [s.id, s.pay_rate_cents]),
  );
  const nameById = new Map<string, string>(
    (subs ?? []).map((s) => [s.id, memberDisplayName(s)]),
  );
  const missingIds = Array.from(
    new Set(
      (entries ?? [])
        .map((e) => e.employee_id)
        .filter((id): id is string => !!id && !rateById.has(id)),
    ),
  );
  if (missingIds.length > 0) {
    const { data: extras } = (await admin
      .from("memberships")
      .select("id, pay_rate_cents, display_name, profile:profiles ( full_name )")
      .in("id", missingIds)
      .eq("organization_id", organizationId)) as unknown as {
      data: Array<{
        id: string;
        pay_rate_cents: number | null;
        display_name: string | null;
        profile: { full_name: string | null } | null;
      }> | null;
    };
    for (const m of extras ?? []) {
      rateById.set(m.id, m.pay_rate_cents);
      nameById.set(m.id, memberDisplayName(m));
    }
  }

  const items = groupEntriesForRun(entries ?? [], rateById);
  if (items.length === 0) {
    return {
      ok: false,
      nothing: true,
      error: "No unpaid subcontractor hours in this period.",
    };
  }

  const { data: run, error: runErr } = (await admin
    .from("subcontractor_pay_runs" as never)
    .insert({
      organization_id: organizationId,
      period_start,
      period_end,
      status: "finalized",
      total_cents: runTotalCents(items),
      created_by: createdByMembershipId,
    } as never)
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };
  if (runErr || !run) {
    return {
      ok: false,
      error: runErr?.message ?? "Could not create the statement.",
    };
  }

  const { error: itemsErr } = (await admin
    .from("subcontractor_pay_items" as never)
    .insert(
      items.map((i) => ({
        run_id: run.id,
        organization_id: organizationId,
        membership_id: i.membershipId,
        payee_name: nameById.get(i.membershipId) ?? "Unknown",
        minutes: i.minutes,
        entry_count: i.entryCount,
        total_cents: i.totalCents,
      })) as never,
    )) as unknown as { error: { message: string } | null };
  if (itemsErr) {
    await admin
      .from("subcontractor_pay_runs" as never)
      .delete()
      .eq("id" as never, run.id as never);
    return { ok: false, error: itemsErr.message };
  }

  const entryIds = items.flatMap((i) => i.entryIds);
  const { data: claimedRows, error: stampErr } = (await admin
    .from("time_entries")
    .update({ subcontractor_run_id: run.id } as never)
    .is("subcontractor_run_id" as never, null as never)
    // Both columns: a concurrent EMPLOYEE run can claim the same legacy
    // null-snapshot row via payroll_run_id; checking only our own column
    // would let both claims succeed and pay the hours twice.
    .is("payroll_run_id", null)
    .in("id", entryIds)
    .select("id")) as unknown as {
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  };
  if (stampErr || (claimedRows?.length ?? 0) !== entryIds.length) {
    await admin
      .from("time_entries")
      .update({ subcontractor_run_id: null } as never)
      .eq("subcontractor_run_id" as never, run.id as never);
    await admin
      .from("subcontractor_pay_runs" as never)
      .delete()
      .eq("id" as never, run.id as never);
    return {
      ok: false,
      error:
        stampErr?.message ??
        "Another statement consumed some of these hours at the same moment — check the statements list before trying again.",
    };
  }

  return { ok: true, id: run.id, totalCents: runTotalCents(items) };
}

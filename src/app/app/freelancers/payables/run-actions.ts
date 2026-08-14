"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import { getOrgTimezone } from "@/lib/org-timezone";
import { zonedDayStartUtc, zonedMidnightUtc } from "@/lib/wall-clock";
import { memberDisplayName } from "@/lib/member-display";
import { groupEntriesForRun, runTotalCents } from "@/lib/subcontractor-run";

// ── Pay-period statements (subcontractor pay runs) ───────────────────────────
//
// The bi-weekly ritual (#83), done the payroll way: freeze a period's
// subcontractor-era hours into a run + per-person items, stamp the consumed
// entries so no later run can pay them again, and mark the run paid when the
// money moves. Only SUB-ERA hours (engagement_snapshot) enter a run, and
// capped needs_review hours block generation exactly as they block payroll.

type Result = { ok: true } | { ok: false; error: string };

async function ownerAdmin() {
  const { membership } = await getActionContext();
  const ok = ["owner", "admin"].includes(membership.role);
  return { membership, ok };
}

export async function generateSubcontractorRunAction(
  formData: FormData,
): Promise<Result> {
  const { membership, ok } = await ownerAdmin();
  if (!ok) {
    return { ok: false, error: "Only owners and admins can generate statements." };
  }

  const period_start = String(formData.get("period_start") ?? "").trim();
  const period_end = String(formData.get("period_end") ?? "").trim();
  if (!period_start || !period_end) {
    return { ok: false, error: "Period start and end are required." };
  }
  if (period_end < period_start) {
    return { ok: false, error: "Period end must be on or after start." };
  }

  const orgTz = await getOrgTimezone(membership.organization_id);
  // Org-local calendar days, half-open — the #80 bug class. An evening shift
  // on the period's last day belongs to THIS statement, not the next one.
  const fromIso = zonedMidnightUtc(period_start, orgTz).toISOString();
  const toIso = zonedDayStartUtc(
    zonedMidnightUtc(period_end, orgTz),
    orgTz,
    1,
  ).toISOString();

  const admin = createSupabaseAdminClient();

  // Current subs — the null-snapshot fallback arm and most rate lookups.
  const { data: subs } = (await admin
    .from("memberships")
    .select("id, pay_rate_cents, display_name, profile:profiles ( full_name )")
    .eq("organization_id", membership.organization_id)
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

  // Same refusal payroll makes: capped hours are a ceiling, not an
  // observation, and a statement must not turn them into money.
  const { count: unreviewed } = (await admin
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", membership.organization_id)
    .is("payroll_run_id", null)
    .is("subcontractor_run_id" as never, null as never)
    .gte("clock_in_at", fromIso)
    .lt("clock_in_at", toIso)
    .or(eraFilter)
    .eq("needs_review" as never, true as never)) as unknown as {
    count: number | null;
  };
  if ((unreviewed ?? 0) > 0) {
    return {
      ok: false,
      error: `${unreviewed} shift${unreviewed === 1 ? "" : "s"} in this period still need${unreviewed === 1 ? "s" : ""} review — nobody clocked out and the system capped the hours. Confirm or correct them on Timesheets, then generate.`,
    };
  }

  const { data: entries } = (await admin
    .from("time_entries")
    .select(
      "id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, booking:bookings ( hourly_rate_cents )" as never,
    )
    .eq("organization_id", membership.organization_id)
    .is("payroll_run_id", null)
    .is("subcontractor_run_id" as never, null as never)
    .eq("needs_review" as never, false as never)
    .not("clock_out_at", "is", null)
    .gte("clock_in_at", fromIso)
    .lt("clock_in_at", toIso)
    .or(eraFilter)) as unknown as {
    data: Array<{
      id: string;
      employee_id: string | null;
      clock_in_at: string | null;
      clock_out_at: string | null;
      pay_rate_cents_snapshot: number | null;
      booking: { hourly_rate_cents: number | null } | null;
    }> | null;
  };

  // Rates + names for every owner in the window — including people flipped
  // to employee since (their sub-era hours still settle through here).
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
      .eq("organization_id", membership.organization_id)) as unknown as {
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
    return { ok: false, error: "No unpaid subcontractor hours in this period." };
  }

  const { data: run, error: runErr } = (await admin
    .from("subcontractor_pay_runs" as never)
    .insert({
      organization_id: membership.organization_id,
      period_start,
      period_end,
      status: "finalized",
      total_cents: runTotalCents(items),
      created_by: membership.id,
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
        organization_id: membership.organization_id,
        membership_id: i.membershipId,
        payee_name: nameById.get(i.membershipId) ?? "Unknown",
        minutes: i.minutes,
        entry_count: i.entryCount,
        total_cents: i.totalCents,
      })) as never,
    )) as unknown as { error: { message: string } | null };
  if (itemsErr) {
    // Entries not yet stamped — deleting the run leaves no trace.
    await admin
      .from("subcontractor_pay_runs" as never)
      .delete()
      .eq("id" as never, run.id as never);
    return { ok: false, error: itemsErr.message };
  }

  // Stamp ONLY the entries the items actually priced.
  const entryIds = items.flatMap((i) => i.entryIds);
  const { error: stampErr } = (await admin
    .from("time_entries")
    .update({ subcontractor_run_id: run.id } as never)
    .in("id", entryIds)) as unknown as { error: { message: string } | null };
  if (stampErr) {
    // Unwind rather than leave a statement whose hours can be double-paid.
    await admin
      .from("subcontractor_pay_runs" as never)
      .delete()
      .eq("id" as never, run.id as never);
    return { ok: false, error: stampErr.message };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "settings",
    entity_id: run.id,
    after: {
      entity_name: "subcontractor_pay_run",
      period_start,
      period_end,
      total_cents: runTotalCents(items),
      payees: items.length,
      entries: entryIds.length,
    },
  });

  revalidatePath("/app/freelancers/payables");
  return { ok: true };
}

export async function markSubcontractorRunPaidAction(
  formData: FormData,
): Promise<Result> {
  const { membership, ok } = await ownerAdmin();
  if (!ok) {
    return { ok: false, error: "Only owners and admins can mark statements paid." };
  }
  const runId = String(formData.get("run_id") ?? "").trim();
  if (!runId) return { ok: false, error: "Missing statement." };

  const admin = createSupabaseAdminClient();
  const { data: run } = (await admin
    .from("subcontractor_pay_runs" as never)
    .select("id, status, period_start, period_end, total_cents")
    .eq("id" as never, runId as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      status: string;
      period_start: string;
      period_end: string;
      total_cents: number;
    } | null;
  };
  if (!run) return { ok: false, error: "Statement not found." };
  if (run.status === "paid") return { ok: true };

  const { error } = (await admin
    .from("subcontractor_pay_runs" as never)
    .update({ status: "paid", paid_at: new Date().toISOString() } as never)
    .eq("id" as never, runId as never)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };

  // Tell each subcontractor their statement settled. Best-effort.
  try {
    const { data: items } = (await admin
      .from("subcontractor_pay_items" as never)
      .select("membership_id, total_cents")
      .eq("run_id" as never, runId as never)) as unknown as {
      data: Array<{ membership_id: string; total_cents: number }> | null;
    };
    const { notify } = await import("@/lib/notify");
    const { formatCurrencyCents } = await import("@/lib/format");
    for (const item of items ?? []) {
      await notify({
        organizationId: membership.organization_id,
        audience: "membership",
        membershipId: item.membership_id,
        title: "Your pay statement was marked paid",
        body: `${run.period_start} to ${run.period_end} — ${formatCurrencyCents(item.total_cents)}.`,
        href: "/field/hours",
      });
    }
  } catch {
    // Never fail the payment record over a notification.
  }

  await logAuditEvent({
    membership,
    action: "status_change",
    entity: "settings",
    entity_id: runId,
    before: { entity_name: "subcontractor_pay_run", status: "finalized" },
    after: { entity_name: "subcontractor_pay_run", status: "paid" },
  });

  revalidatePath("/app/freelancers/payables");
  return { ok: true };
}

export async function deleteSubcontractorRunAction(
  formData: FormData,
): Promise<Result> {
  const { membership, ok } = await ownerAdmin();
  if (!ok) {
    return { ok: false, error: "Only owners and admins can delete statements." };
  }
  const runId = String(formData.get("run_id") ?? "").trim();
  if (!runId) return { ok: false, error: "Missing statement." };

  const admin = createSupabaseAdminClient();
  const { data: run } = (await admin
    .from("subcontractor_pay_runs" as never)
    .select("id, status, period_start, period_end")
    .eq("id" as never, runId as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      status: string;
      period_start: string;
      period_end: string;
    } | null;
  };
  if (!run) return { ok: false, error: "Statement not found." };
  if (run.status === "paid") {
    return {
      ok: false,
      error: "This statement is marked paid — it's a record now, not a draft.",
    };
  }

  // FK is ON DELETE SET NULL, so deleting the run releases its entries back
  // to the floating balance and the period can be regenerated.
  const { error } = (await admin
    .from("subcontractor_pay_runs" as never)
    .delete()
    .eq("id" as never, runId as never)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "settings",
    entity_id: runId,
    before: {
      entity_name: "subcontractor_pay_run",
      period_start: run.period_start,
      period_end: run.period_end,
      status: run.status,
    },
  });

  revalidatePath("/app/freelancers/payables");
  return { ok: true };
}

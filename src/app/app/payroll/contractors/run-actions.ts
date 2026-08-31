"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import { createContractorRunForOrg } from "@/lib/contractor-run-create";

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
  // Same range rules as preparePeriodAction: real calendar dates, ordered,
  // bounded — a fat-fingered year must not become a decades-long window.
  const { validatePeriodRange } = await import("../actions");
  const rangeErr = await validatePeriodRange(period_start, period_end);
  if (rangeErr) return { ok: false, error: rangeErr };

  // The machine lives in lib/contractor-run-create (shared with the
  // period-prepare flow and the cron autodraft); this action is the gate
  // + audit around it. Window-only here — the manual generate button keeps
  // its historical strictness; straggler-sweeping belongs to Prepare.
  const result = await createContractorRunForOrg({
    organizationId: membership.organization_id,
    createdByMembershipId: membership.id,
    periodStart: period_start,
    periodEnd: period_end,
    includeStragglers: false,
  });
  if (!result.ok) return { ok: false, error: result.error };
  const run = { id: result.id };

  await logAuditEvent({
    membership,
    action: "create",
    entity: "settings",
    entity_id: run.id,
    after: {
      entity_name: "subcontractor_pay_run",
      period_start,
      period_end,
      total_cents: result.totalCents,
    },
  });

  revalidatePath("/app/payroll/contractors");
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

  // CHECKED claim, same as markPayrollPaidAction: two admins clicking at
  // once both passed the read above, and both used to proceed — duplicate
  // "statement paid" texts to every contractor and a phantom second
  // transition in the audit log. Only the click that flips the row keeps
  // going.
  const { data: claimed, error } = (await admin
    .from("subcontractor_pay_runs" as never)
    .update({ status: "paid", paid_at: new Date().toISOString() } as never)
    .eq("id" as never, runId as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .eq("status" as never, "finalized" as never)
    .select("id")) as unknown as {
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };
  if (!claimed || claimed.length === 0) return { ok: true };

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
        // /field/pay shows the dollars this message promises; /field/hours
        // (the old target) has no money on it at all.
        href: "/field/pay",
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

  revalidatePath("/app/payroll/contractors");
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
  // to the floating balance and the period can be regenerated. Org filter
  // on the DELETE itself, not just the read above — the tenancy boundary
  // belongs on the destructive statement.
  const { error } = (await admin
    .from("subcontractor_pay_runs" as never)
    .delete()
    .eq("id" as never, runId as never)
    .eq("organization_id" as never, membership.organization_id as never)) as unknown as {
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

  revalidatePath("/app/payroll/contractors");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";

// Pay adjustments: putting pay right after a pay period has been paid.
//
// A paid period is locked for good (its hours can't be edited, a missed
// shift can't be added, it can't be deleted or un-paid). An adjustment is
// the way round: an amount for one person, plus or minus, with a note. It
// waits here until the next pay period is prepared, which picks it up as its
// own line (lib/payroll-run-create). Owners and admins only, like pay runs.

type Result = { ok: true } | { ok: false; error: string };

const MAX_CENTS = 10_000_00; // $10,000 either way

function parseAmountCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return cents > 0 && cents <= MAX_CENTS ? cents : null;
}

const isYmd = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export async function createPayAdjustmentAction(formData: FormData): Promise<Result> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Only owners and admins can adjust someone's pay." };
  }

  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const direction = String(formData.get("direction") ?? "").trim();
  const amount = parseAmountCents(String(formData.get("amount") ?? ""));
  const reason = String(formData.get("reason") ?? "").trim();
  const from = String(formData.get("corrects_period_start") ?? "").trim();
  const to = String(formData.get("corrects_period_end") ?? "").trim();

  if (!employeeId) return { ok: false, error: "Pick who this is for." };
  if (direction !== "add" && direction !== "take_back") {
    return { ok: false, error: "Choose whether this pays more or takes back." };
  }
  if (amount == null) {
    return { ok: false, error: "Enter an amount, like 30 or 30.50 (up to $10,000)." };
  }
  if (reason.length === 0) {
    return { ok: false, error: "Write a short note saying what this corrects. It prints on their pay statement." };
  }
  if (reason.length > 500) return { ok: false, error: "Keep the note under 500 characters." };
  if ((from || to) && !(isYmd(from) && isYmd(to) && to >= from)) {
    return { ok: false, error: "Give both dates of the period this corrects, or leave both empty." };
  }

  const admin = createSupabaseAdminClient();
  const { data: person } = (await admin
    .from("memberships")
    .select("id, engagement, status")
    .eq("id", employeeId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: { id: string; engagement: string | null; status: string } | null;
  };
  if (!person) return { ok: false, error: "That person isn't in this company." };
  // Pay periods only pay active employees; an adjustment for anyone else
  // would wait forever.
  if (person.engagement === "subcontractor") {
    return {
      ok: false,
      error: "This person is paid as a subcontractor. Use Add to pay on Payroll, Contractors instead.",
    };
  }
  if (person.status !== "active") {
    return { ok: false, error: "This person isn't active, so no pay period would include it." };
  }

  const amountCents = direction === "take_back" ? -amount : amount;
  const { data: made, error } = (await admin
    .from("pay_adjustments" as never)
    .insert({
      organization_id: membership.organization_id,
      employee_id: employeeId,
      amount_cents: amountCents,
      reason,
      corrects_period_start: from || null,
      corrects_period_end: to || null,
      created_by: membership.id,
    } as never)
    .select("id")
    .single()) as unknown as { data: { id: string } | null; error: { message: string } | null };
  if (error || !made) {
    return { ok: false, error: error?.message ?? "The adjustment wasn't saved. Try again." };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "bonus",
    entity_id: made.id,
    after: { entity_name: "pay_adjustment", employee_id: employeeId, amount_cents: amountCents, reason },
  });
  revalidatePath("/app/payroll", "page");
  return { ok: true };
}

/** Remove an adjustment that no pay period has picked up yet. */
export async function deletePayAdjustmentAction(formData: FormData): Promise<Result> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Only owners and admins can adjust someone's pay." };
  }
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing adjustment." };

  const admin = createSupabaseAdminClient();
  // Only while it is still waiting: once a pay period holds it, it is part
  // of that period's total. Delete the (unpaid) period to release it.
  const { data: gone, error } = (await admin
    .from("pay_adjustments" as never)
    .delete()
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .is("payroll_run_id" as never, null as never)
    .select("id, employee_id, amount_cents, reason")) as unknown as {
    data: Array<{ id: string; employee_id: string; amount_cents: number; reason: string }> | null;
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };
  if (!gone?.length) {
    return {
      ok: false,
      error: "That adjustment is already on a pay period, or is gone. Nothing was removed.",
    };
  }
  await logAuditEvent({
    membership,
    action: "delete",
    entity: "bonus",
    entity_id: id,
    before: { entity_name: "pay_adjustment", employee_id: gone[0].employee_id, amount_cents: gone[0].amount_cents, reason: gone[0].reason },
  });
  revalidatePath("/app/payroll", "page");
  return { ok: true };
}

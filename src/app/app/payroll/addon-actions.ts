"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import { getOrgTimezone } from "@/lib/org-timezone";
import { zonedYmd } from "@/lib/wall-clock";
import { runCoveringWindow } from "@/lib/pay-period-fence";
import { isAddonKind, parseAddonAmount } from "@/lib/pay-addons";

// Add-ons: travel, reimbursements and other fixed amounts for a contractor
// on a day (src/lib/pay-addons.ts). Owners and admins only, like statements.

type Result = { ok: true } | { ok: false; error: string };

const fmtDay = (ymd: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
    new Date(`${ymd}T00:00:00Z`),
  );

function refresh() {
  revalidatePath("/app/payroll", "layout");
  revalidatePath("/field/pay");
}

export async function createAddonAction(formData: FormData): Promise<Result> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Only owners and admins can add to someone's pay." };
  }

  const memberId = String(formData.get("membership_id") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  const amount = parseAddonAmount(String(formData.get("amount") ?? ""));
  const workDate = String(formData.get("work_date") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!memberId) return { ok: false, error: "Pick who this is for." };
  if (!isAddonKind(kind)) return { ok: false, error: "Pick what this is for." };
  if (amount == null) return { ok: false, error: "Enter an amount, like 25 or 25.50 (up to $10,000)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || Number.isNaN(Date.parse(`${workDate}T00:00:00Z`))) {
    return { ok: false, error: "Pick the day this belongs to." };
  }
  if (note.length === 0) return { ok: false, error: "Add a short note, like what the receipt was for." };
  if (note.length > 300) return { ok: false, error: "Keep the note under 300 characters." };

  const admin = createSupabaseAdminClient();
  const today = zonedYmd(new Date(), await getOrgTimezone(membership.organization_id));
  if (workDate > today) return { ok: false, error: "The day can't be in the future." };

  const { data: person } = (await admin
    .from("memberships")
    .select("id, engagement")
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as { data: { id: string; engagement: string | null } | null };
  if (!person) return { ok: false, error: "That person isn't in this company." };
  if (person.engagement !== "subcontractor") {
    return {
      ok: false,
      error: "This person is paid through payroll, not a contractor statement. Add extra pay for them as a bonus on the Bonuses page.",
    };
  }

  // A statement is built from what exists when it is prepared and never
  // looks again. An add-on dated into a prepared period would never be paid.
  const covering = await runCoveringWindow(admin, membership.organization_id, workDate, workDate, "subcontractor_pay_runs");
  if (covering) {
    return {
      ok: false,
      error: `The ${fmtDay(covering.period_start)} – ${fmtDay(covering.period_end)} contractor statement is already prepared, so this wouldn't be paid. Delete that statement on Contractor pay, add this, then prepare the period again.`,
    };
  }

  const { data: inserted, error } = (await admin
    .from("pay_addons" as never)
    .insert({
      organization_id: membership.organization_id,
      membership_id: memberId,
      kind,
      amount_cents: amount,
      work_date: workDate,
      note,
      created_by: membership.id,
    } as never)
    .select("id")
    .single()) as unknown as { data: { id: string } | null; error: { message: string } | null };
  if (error || !inserted) return { ok: false, error: error?.message ?? "Couldn't save the add-on." };

  await logAuditEvent({
    membership,
    action: "create",
    entity: "settings",
    entity_id: inserted.id,
    after: { entity_name: "pay_addon", membership_id: memberId, kind, amount_cents: amount, work_date: workDate, note },
  });
  refresh();
  return { ok: true };
}

export async function deleteAddonAction(formData: FormData): Promise<Result> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Only owners and admins can change someone's pay." };
  }
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing add-on." };

  const admin = createSupabaseAdminClient();
  const { data: row } = (await admin
    .from("pay_addons" as never)
    .select("id, membership_id, kind, amount_cents, work_date, note, subcontractor_run_id")
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      membership_id: string;
      kind: string;
      amount_cents: number;
      work_date: string;
      note: string;
      subcontractor_run_id: string | null;
    } | null;
  };
  if (!row) return { ok: false, error: "That add-on is already gone." };
  if (row.subcontractor_run_id) {
    return {
      ok: false,
      error: "This is on a statement already. Delete that statement on Contractor pay first, then remove it.",
    };
  }

  const { data: gone, error } = (await admin
    .from("pay_addons" as never)
    .delete()
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .is("subcontractor_run_id" as never, null as never)
    .select("id")) as unknown as { data: Array<{ id: string }> | null; error: { message: string } | null };
  if (error) return { ok: false, error: error.message };
  if (!gone || gone.length === 0) {
    return { ok: false, error: "A statement took this add-on a moment ago. Refresh the page." };
  }

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "settings",
    entity_id: id,
    before: { entity_name: "pay_addon", ...row },
  });
  refresh();
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { notifyPtoStatus } from "@/lib/automations";

type Result = { ok: true } | { ok: false; error: string };

// ── PTO request management ────────────────────────────────────

export async function createPtoRequestAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const employee_id = String(formData.get("employee_id") ?? "");
  const start_date = String(formData.get("start_date") ?? "");
  const end_date = String(formData.get("end_date") ?? "");
  const hours = Number(formData.get("hours") ?? 8);
  const reason = String(formData.get("reason") ?? "").trim();

  if (!employee_id || !start_date || !end_date) {
    return { ok: false, error: "Employee, start date, and end date are required." };
  }

  if (new Date(end_date) < new Date(start_date)) {
    return { ok: false, error: "End date must be on or after start date." };
  }

  const { error } = await (supabase
    .from("pto_requests" as never)
    .insert({
      organization_id: membership.organization_id,
      employee_id,
      start_date,
      end_date,
      hours,
      reason: reason || null,
      status: "approved",
      reviewed_by: membership.id,
      reviewed_at: new Date().toISOString(),
    } as never) as unknown as Promise<{ error: { message: string } | null }>);

  if (error) return { ok: false, error: error.message };

  // Update PTO balance
  const year = new Date(start_date).getFullYear();
  await (supabase.rpc as Function)("increment_pto_used" as never, {
    p_employee_id: employee_id,
    p_year: year,
    p_hours: hours,
  }).catch(() => {
    // RPC may not exist yet — non-critical
  });

  revalidatePath("/app/timesheets", "page");
  return { ok: true };
}

// Employee self-service — submits a PENDING request that admins approve
export async function submitSelfPtoRequestAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();

  const start_date = String(formData.get("start_date") ?? "");
  const end_date = String(formData.get("end_date") ?? "");
  const hours = Number(formData.get("hours") ?? 8);
  const reason = String(formData.get("reason") ?? "").trim();

  if (!start_date || !end_date) {
    return { ok: false, error: "Start date and end date are required." };
  }

  if (new Date(end_date) < new Date(start_date)) {
    return { ok: false, error: "End date must be on or after start date." };
  }

  if (hours <= 0 || hours > 200) {
    return { ok: false, error: "Hours must be between 1 and 200." };
  }

  const { error } = await (supabase
    .from("pto_requests" as never)
    .insert({
      organization_id: membership.organization_id,
      employee_id: membership.id,
      start_date,
      end_date,
      hours,
      reason: reason || null,
      status: "pending",
    } as never) as unknown as Promise<{ error: { message: string } | null }>);

  if (error) return { ok: false, error: error.message };

  // Only revalidate the field-side page — the admin page will refresh
  // on their own view. Cross-surface revalidation was causing 30s+
  // freezes because the action waited for the admin layout's many
  // parallel queries to re-run before returning.
  revalidatePath("/field/profile");
  return { ok: true };
}

export async function updatePtoStatusAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!id || !["approved", "declined", "cancelled"].includes(status)) {
    return { ok: false, error: "Invalid request." };
  }

  const { error } = await (supabase
    .from("pto_requests" as never)
    .update({
      status,
      reviewed_by: membership.id,
      reviewed_at: new Date().toISOString(),
    } as never)
    .eq("id" as never, id as never)
    .eq(
      "organization_id" as never,
      membership.organization_id as never,
    ) as unknown as Promise<{ error: { message: string } | null }>);

  if (error) return { ok: false, error: error.message };

  // Fire-and-forget email to the employee about the decision.
  notifyPtoStatus(id);

  revalidatePath("/app/timesheets", "page");
  return { ok: true };
}

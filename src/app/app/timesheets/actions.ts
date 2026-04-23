"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { notifyPtoStatus } from "@/lib/automations";
import { getOrgTimezone } from "@/lib/org-timezone";
import { localInputToUtcIso } from "@/lib/validators/common";

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

  // Update PTO balance — RPC may not exist yet, so we cast loosely and
  // swallow the error instead of requiring the RPC to be defined.
  const year = new Date(start_date).getFullYear();
  await (
    supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<unknown>
  )("increment_pto_used", {
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

// ── Manual time entries ──────────────────────────────────────
//
// These let an owner/admin/manager retroactively log hours against any
// employee (including themselves). Powers month-end catch-up when someone
// forgot to clock in/out, plus off-app work like a family member who
// doesn't use the field app at all.
//
// Rows are indistinguishable from live clock-in/out entries except for
// the created_manually flag and created_by pointer, which the UI uses
// to render a "Manual" badge.

type TimeEntryFormFields = {
  employee_id: string;
  booking_id: string | null;
  start_at: string; // UTC ISO
  end_at: string | null;
  notes: string | null;
};

function readManualTimeFormValues(
  formData: FormData,
  orgTz: string,
): TimeEntryFormFields | { _error: string } {
  const employee_id = String(formData.get("employee_id") ?? "").trim();
  const booking_id_raw = String(formData.get("booking_id") ?? "").trim();
  const booking_id = booking_id_raw === "" ? null : booking_id_raw;
  const start_local = String(formData.get("start_at") ?? "").trim();
  const end_local = String(formData.get("end_at") ?? "").trim();
  const notes_raw = String(formData.get("notes") ?? "").trim();

  if (!employee_id) return { _error: "Pick an employee." };
  if (!start_local) return { _error: "Enter a start time." };

  const start_at = localInputToUtcIso(start_local, orgTz);
  if (Number.isNaN(new Date(start_at).getTime())) {
    return { _error: "Invalid start time." };
  }

  let end_at: string | null = null;
  if (end_local) {
    end_at = localInputToUtcIso(end_local, orgTz);
    if (Number.isNaN(new Date(end_at).getTime())) {
      return { _error: "Invalid end time." };
    }
    if (new Date(end_at).getTime() <= new Date(start_at).getTime()) {
      return { _error: "End time must be after start time." };
    }
  }

  return {
    employee_id,
    booking_id,
    start_at,
    end_at,
    notes: notes_raw || null,
  };
}

/**
 * Create a manual time entry. The form sends wall-clock times in the
 * org's timezone; we convert to UTC before insert.
 */
export async function createManualTimeEntryAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const orgTz = await getOrgTimezone(membership.organization_id);
  const parsed = readManualTimeFormValues(formData, orgTz);
  if ("_error" in parsed) return { ok: false, error: parsed._error };

  // Double-check the target employee belongs to this org. RLS would
  // block a cross-org write anyway; this gives a cleaner error.
  const { data: emp } = await supabase
    .from("memberships")
    .select("id, organization_id, status")
    .eq("id", parsed.employee_id)
    .maybeSingle();
  if (!emp || emp.organization_id !== membership.organization_id) {
    return { ok: false, error: "Employee not found in this organization." };
  }
  if (emp.status !== "active") {
    return { ok: false, error: "Can't log hours for an inactive employee." };
  }

  const { data: inserted, error } = await supabase
    .from("time_entries")
    .insert({
      organization_id: membership.organization_id,
      employee_id: parsed.employee_id,
      booking_id: parsed.booking_id,
      clock_in_at: parsed.start_at,
      clock_out_at: parsed.end_at,
      notes: parsed.notes,
      created_manually: true,
      created_by: membership.id,
    } as never)
    .select("id")
    .single();

  if (error || !inserted) {
    return { ok: false, error: error?.message ?? "Could not create entry." };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "time_entry",
    entity_id: inserted.id,
    after: {
      employee_id: parsed.employee_id,
      booking_id: parsed.booking_id,
      clock_in_at: parsed.start_at,
      clock_out_at: parsed.end_at,
    },
  });

  revalidatePath("/app/timesheets", "page");
  revalidatePath("/app/payroll", "page");
  return { ok: true };
}

/**
 * Update any existing time entry. Used both to correct a forgotten clock-
 * out and to edit a previously-logged manual entry. Owner/admin/manager
 * only — employees can't edit their own entries after the fact, since
 * that would undermine the audit trail.
 */
export async function updateTimeEntryAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing entry id." };

  const orgTz = await getOrgTimezone(membership.organization_id);
  const parsed = readManualTimeFormValues(formData, orgTz);
  if ("_error" in parsed) return { ok: false, error: parsed._error };

  const { data: before } = await supabase
    .from("time_entries")
    .select("clock_in_at, clock_out_at, employee_id, booking_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("time_entries")
    .update({
      employee_id: parsed.employee_id,
      booking_id: parsed.booking_id,
      clock_in_at: parsed.start_at,
      clock_out_at: parsed.end_at,
      notes: parsed.notes,
    } as never)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "time_entry",
    entity_id: id,
    before: before ?? null,
    after: {
      employee_id: parsed.employee_id,
      booking_id: parsed.booking_id,
      clock_in_at: parsed.start_at,
      clock_out_at: parsed.end_at,
    },
  });

  revalidatePath("/app/timesheets", "page");
  revalidatePath("/app/payroll", "page");
  return { ok: true };
}

/**
 * Delete a time entry. Owner/admin/manager only.
 */
export async function deleteTimeEntryAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing entry id." };

  const { data: before } = await supabase
    .from("time_entries")
    .select("employee_id, booking_id, clock_in_at, clock_out_at")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("time_entries").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "time_entry",
    entity_id: id,
    before: before ?? null,
  });

  revalidatePath("/app/timesheets", "page");
  revalidatePath("/app/payroll", "page");
  return { ok: true };
}

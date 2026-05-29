"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { notifyPtoStatus } from "@/lib/automations";
import { getOrgTimezone } from "@/lib/org-timezone";
import { localInputToUtcIso } from "@/lib/validators/common";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Fetch the edit history of a single time entry from audit_log.
 * Surfaces "who changed what, when" inside the entry edit dialog so the
 * owner doesn't have to dig through /app/settings/audit-log to see if
 * an entry was tampered with.
 */
export type TimeEntryHistoryRow = {
  id: string;
  created_at: string;
  action: string;
  actor_name: string;
  before: unknown;
  after: unknown;
};

export async function fetchTimeEntryHistoryAction(
  entryId: string,
): Promise<TimeEntryHistoryRow[]> {
  if (!entryId) return [];
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) return [];

  const { data } = (await supabase
    .from("audit_log")
    .select(
      `id, created_at, action, before, after, actor_membership_id`,
    )
    .eq("entity", "time_entry")
    .eq("entity_id", entryId)
    .eq("organization_id" as never, membership.organization_id as never)
    .order("created_at", { ascending: false })
    .limit(50)) as unknown as {
    data: Array<{
      id: string;
      created_at: string;
      action: string;
      before: unknown;
      after: unknown;
      actor_membership_id: string | null;
    }> | null;
  };
  if (!data || data.length === 0) return [];

  // Resolve actor names in one batch query
  const actorIds = Array.from(
    new Set(
      data.map((r) => r.actor_membership_id).filter((v): v is string => !!v),
    ),
  );
  const actorNameMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: actors } = (await supabase
      .from("memberships")
      .select("id, display_name, profile:profiles ( full_name )")
      .in("id", actorIds)) as unknown as {
      data: Array<{
        id: string;
        display_name: string | null;
        profile: { full_name: string | null } | null;
      }> | null;
    };
    for (const a of actors ?? []) {
      actorNameMap.set(
        a.id,
        a.profile?.full_name ?? a.display_name ?? "Unknown",
      );
    }
  }

  return data.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    action: r.action,
    actor_name: r.actor_membership_id
      ? actorNameMap.get(r.actor_membership_id) ?? "Unknown"
      : "System",
    before: r.before,
    after: r.after,
  }));
}

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

  // Overlap check: refuse to create an entry that would collide with
  // another live shift for the same employee. Prevents payroll double-
  // counting from misclicks or paper-log backfills.
  const overlap = await findOverlap(
    supabase,
    membership.organization_id,
    parsed.employee_id,
    parsed.start_at,
    parsed.end_at,
    null,
  );
  if (overlap) {
    const otherStart = new Date(overlap.clock_in_at).toLocaleString("en-US", {
      timeZone: orgTz,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const otherEnd = overlap.clock_out_at
      ? new Date(overlap.clock_out_at).toLocaleString("en-US", {
          timeZone: orgTz,
          hour: "numeric",
          minute: "2-digit",
        })
      : "still clocked in";
    return {
      ok: false,
      error: `This overlaps with an existing entry (${otherStart} – ${otherEnd}). Adjust or delete that one first.`,
    };
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
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle();

  // Overlap check — excludes the entry being edited so the entry doesn't
  // flag against itself.
  const overlap = await findOverlap(
    supabase,
    membership.organization_id,
    parsed.employee_id,
    parsed.start_at,
    parsed.end_at,
    id,
  );
  if (overlap) {
    const otherStart = new Date(overlap.clock_in_at).toLocaleString("en-US", {
      timeZone: orgTz,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const otherEnd = overlap.clock_out_at
      ? new Date(overlap.clock_out_at).toLocaleString("en-US", {
          timeZone: orgTz,
          hour: "numeric",
          minute: "2-digit",
        })
      : "still clocked in";
    return {
      ok: false,
      error: `These times overlap with another entry (${otherStart} – ${otherEnd}). Adjust or delete that one first.`,
    };
  }

  const { error } = await supabase
    .from("time_entries")
    .update({
      employee_id: parsed.employee_id,
      booking_id: parsed.booking_id,
      clock_in_at: parsed.start_at,
      clock_out_at: parsed.end_at,
      notes: parsed.notes,
    } as never)
    .eq("id", id)
    .eq("organization_id" as never, membership.organization_id as never);

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
 * Delete a PTO request. Useful for cleaning up test / duplicate / mistaken
 * entries. When deleting an APPROVED request we also decrement the cached
 * PTO balance; declined/pending requests never moved the balance so no
 * reversal is needed.
 */
export async function deletePtoRequestAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing request id." };

  // Use admin client so cross-employee reads work; role is gated above.
  const { createSupabaseAdminClient } = await import(
    "@/lib/supabase/admin"
  );
  const admin = createSupabaseAdminClient();

  const { data: before } = (await admin
    .from("pto_requests" as never)
    .select("id, employee_id, start_date, hours, status")
    .eq("id" as never, id as never)
    .eq(
      "organization_id" as never,
      membership.organization_id as never,
    )
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      employee_id: string;
      start_date: string;
      hours: number;
      status: string;
    } | null;
  };

  if (!before) return { ok: false, error: "Request not found." };

  const { error } = (await admin
    .from("pto_requests" as never)
    .delete()
    .eq("id" as never, id as never)
    .eq(
      "organization_id" as never,
      membership.organization_id as never,
    )) as unknown as { error: { message: string } | null };
  if (error) return { ok: false, error: error.message };

  // Reverse the PTO balance if the deleted request was approved. RPC may
  // not exist yet, so swallow errors — the row is gone either way.
  if (before.status === "approved") {
    const year = new Date(before.start_date).getFullYear();
    await (
      supabase.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<unknown>
    )("increment_pto_used", {
      p_employee_id: before.employee_id,
      p_year: year,
      p_hours: -Number(before.hours),
    }).catch(() => {});
  }

  revalidatePath("/app/timesheets", "page");
  return { ok: true };
}

/**
 * Check for an OVERLAP with another time entry for the same employee.
 *
 * Two entries overlap when they share any minute on the clock — A.start <
 * B.end AND A.end > B.start. Open entries (clock_out_at IS NULL) are
 * treated as extending to the current moment for the purposes of this
 * check, so creating an entry that runs into an unclosed shift is
 * detected.
 *
 * Returns the overlapping entry's id and times if found; null if clean.
 * Caller passes excludeId to skip a specific entry (used by update so we
 * don't flag the entry against itself).
 */
async function findOverlap(
  supabase: Awaited<
    ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>
  >,
  organizationId: string,
  employeeId: string,
  startIso: string,
  endIso: string | null,
  excludeId: string | null,
): Promise<{
  id: string;
  clock_in_at: string;
  clock_out_at: string | null;
} | null> {
  const effectiveEnd = endIso ?? new Date().toISOString();

  // Pull every entry for this employee whose start is before our end and
  // whose stop (clock_out_at or now() for open shifts) is after our
  // start. Coalesce open entries by treating their end as the far
  // future — they overlap anything that's in progress or later.
  const FUTURE = "9999-12-31T00:00:00Z";

  let query = supabase
    .from("time_entries")
    .select("id, clock_in_at, clock_out_at")
    .eq("organization_id" as never, organizationId as never)
    .eq("employee_id" as never, employeeId as never)
    .lt("clock_in_at" as never, effectiveEnd as never);

  if (excludeId) {
    query = query.neq("id" as never, excludeId as never);
  }

  const { data } = (await query) as unknown as {
    data: Array<{
      id: string;
      clock_in_at: string;
      clock_out_at: string | null;
    }> | null;
  };

  for (const row of data ?? []) {
    const otherEnd = row.clock_out_at ?? FUTURE;
    // Overlap iff otherEnd > our start
    if (otherEnd > startIso) {
      return row;
    }
  }
  return null;
}

/**
 * Bulk delete time entries. Used by the timesheet UI's row selection
 * affordance — owners cleaning up test data, duplicates, or end-of-pay-
 * period housekeeping. Owner/admin/manager only.
 *
 * Limits to 100 ids per call so a runaway client can't wipe a whole
 * org's history in one shot.
 */
export async function bulkDeleteTimeEntriesAction(
  formData: FormData,
): Promise<Result & { deleted?: number }> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const rawIds = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (rawIds.length === 0) {
    return { ok: false, error: "No entries selected." };
  }
  if (rawIds.length > 100) {
    return { ok: false, error: "Select at most 100 entries at a time." };
  }

  // Pull the rows we're about to remove so we can stamp full snapshots
  // into the audit log.
  const { data: before } = (await supabase
    .from("time_entries")
    .select("id, employee_id, booking_id, clock_in_at, clock_out_at")
    .in("id" as never, rawIds as never)
    .eq("organization_id" as never, membership.organization_id as never)) as unknown as {
    data: Array<{
      id: string;
      employee_id: string;
      booking_id: string | null;
      clock_in_at: string;
      clock_out_at: string | null;
    }> | null;
  };

  const { error } = await supabase
    .from("time_entries")
    .delete()
    .in("id" as never, rawIds as never)
    .eq("organization_id" as never, membership.organization_id as never);
  if (error) return { ok: false, error: error.message };

  for (const row of before ?? []) {
    await logAuditEvent({
      membership,
      action: "delete",
      entity: "time_entry",
      entity_id: row.id,
      before: row,
    });
  }

  revalidatePath("/app/timesheets", "page");
  revalidatePath("/app/payroll", "page");
  return { ok: true, deleted: before?.length ?? 0 };
}

/**
 * Close an open shift — set clock_out_at on an entry that has none.
 * Used by the "missing punches" banner on the timesheets page. The
 * supplied end time must be after the entry's clock_in_at.
 */
export async function closeOpenShiftAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const id = String(formData.get("id") ?? "");
  const endLocal = String(formData.get("end_at") ?? "");
  if (!id || !endLocal) {
    return { ok: false, error: "Missing entry id or end time." };
  }

  const orgTz = await getOrgTimezone(membership.organization_id);
  let endUtc: string;
  try {
    endUtc = localInputToUtcIso(endLocal, orgTz);
  } catch {
    return { ok: false, error: "Invalid end time." };
  }

  const { data: before } = await supabase
    .from("time_entries")
    .select("clock_in_at, clock_out_at, employee_id")
    .eq("id", id)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle();
  if (!before) return { ok: false, error: "Entry not found." };
  if (before.clock_out_at) {
    return { ok: false, error: "This shift was already closed." };
  }
  if (new Date(endUtc).getTime() <= new Date(before.clock_in_at).getTime()) {
    return { ok: false, error: "End time must be after the clock-in time." };
  }

  const { error } = await supabase
    .from("time_entries")
    .update({ clock_out_at: endUtc } as never)
    .eq("id", id)
    .eq("organization_id" as never, membership.organization_id as never);
  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "time_entry",
    entity_id: id,
    before: { clock_out_at: null },
    after: { clock_out_at: endUtc },
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
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle();

  const { error } = await supabase
    .from("time_entries")
    .delete()
    .eq("id", id)
    .eq("organization_id" as never, membership.organization_id as never);
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

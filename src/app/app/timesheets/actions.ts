"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { notifyPtoStatus } from "@/lib/automations";
import { getOrgTimezone } from "@/lib/org-timezone";
import { localInputToUtcIso } from "@/lib/validators/common";
import { endsAfterStart, preserveWithinMinute } from "@/lib/time-entry-edit";
import { encryptField } from "@/lib/field-encryption";

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
      `id, created_at, action, before, after, actor_id`,
    )
    .eq("entity", "time_entry")
    .eq("entity_id", entryId)
    .eq("organization_id", membership.organization_id)
    .order("created_at", { ascending: false })
    .limit(50)) as unknown as {
    data: Array<{
      id: string;
      created_at: string;
      action: string;
      before: unknown;
      after: unknown;
      actor_id: string | null;
    }> | null;
  };
  if (!data || data.length === 0) return [];

  // Resolve actor names in one batch query
  const actorIds = Array.from(
    new Set(
      data.map((r) => r.actor_id).filter((v): v is string => !!v),
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
    actor_name: r.actor_id
      ? actorNameMap.get(r.actor_id) ?? "Unknown"
      : "System",
    before: r.before,
    after: r.after,
  }));
}

// ── PTO request management ────────────────────────────────────

/**
 * Subcontractor time off is unpaid unavailability. Whatever hours the form
 * posted are forced to 0 for a subcontractor — accruesPto() is false for a
 * reason: paid-looking PTO on a contractor's record is the documentary
 * evidence engagement.ts warns decides a CRA misclassification review.
 */
async function isSubcontractorMember(
  memberId: string,
  organizationId: string,
): Promise<boolean> {
  const { createSupabaseAdminClient: createAdmin } = await import(
    "@/lib/supabase/admin"
  );
  const { data } = (await createAdmin()
    .from("memberships")
    .select("engagement" as never)
    .eq("id", memberId)
    .eq("organization_id", organizationId)
    .maybeSingle()) as unknown as {
    data: { engagement: string | null } | null;
  };
  return data?.engagement === "subcontractor";
}

/**
 * Best-effort PTO balance adjustment via the increment_pto_used RPC.
 *
 * Two traps live here, and production hit the second (SOLLOS3-K):
 * the RPC may not exist in an environment, and supabase.rpc() returns a
 * lazy query BUILDER — a thenable with .then() but NO .catch(), so the
 * old `.catch(() => {})` swallow idiom itself threw
 * "rpc(...).catch is not a function" AFTER the main write had already
 * succeeded. Await inside try/catch instead: PostgREST failures resolve
 * with {error} (ignored), and anything genuinely thrown is swallowed.
 */
async function adjustPtoBalance(
  supabase: { rpc: unknown },
  employeeId: string,
  startDate: string,
  hoursDelta: number,
): Promise<void> {
  if (!hoursDelta) return;
  try {
    await (
      supabase.rpc as (
        name: string,
        args: Record<string, unknown>,
      ) => PromiseLike<unknown>
    )("increment_pto_used", {
      p_employee_id: employeeId,
      p_year: new Date(startDate).getFullYear(),
      p_hours: hoursDelta,
    });
  } catch {
    // RPC may not exist yet — non-critical.
  }
}

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
  const postedHours = Number(formData.get("hours") ?? 8);
  const reason = String(formData.get("reason") ?? "").trim();

  if (!employee_id || !start_date || !end_date) {
    return { ok: false, error: "Employee, start date, and end date are required." };
  }

  if (new Date(end_date) < new Date(start_date)) {
    return { ok: false, error: "End date must be on or after start date." };
  }

  const isSub = await isSubcontractorMember(
    employee_id,
    membership.organization_id,
  );
  const hours = isSub ? 0 : postedHours;

  // This inserts as approved directly, so it needs the same fence as
  // approving: paid time off dated into a period a run already covers
  // would never be gathered. Zero-hour unavailability carries no pay and
  // passes freely.
  if (hours > 0) {
    const [{ runCoveringWindow }, { createSupabaseAdminClient }] =
      await Promise.all([
        import("@/lib/pay-period-fence"),
        import("@/lib/supabase/admin"),
      ]);
    const covering = await runCoveringWindow(
      createSupabaseAdminClient(),
      membership.organization_id,
      start_date,
      end_date,
      "payroll_runs",
    );
    if (covering) {
      return {
        ok: false,
        error: `A payroll run already covers ${covering.period_start} – ${covering.period_end}. Delete that pay period and create it again so this time off is included in the pay.`,
      };
    }
  }

  const { error } = await (supabase
    .from("pto_requests")
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
    }) as unknown as Promise<{ error: { message: string } | null }>);

  if (error) return { ok: false, error: error.message };

  // Update PTO balance — best-effort; 0 hours for subcontractors, and
  // unavailability never touches a balance.
  await adjustPtoBalance(supabase, employee_id, start_date, hours);

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
  const postedHours = Number(formData.get("hours") ?? 8);
  const reason = String(formData.get("reason") ?? "").trim();

  if (!start_date || !end_date) {
    return { ok: false, error: "Start date and end date are required." };
  }

  if (new Date(end_date) < new Date(start_date)) {
    return { ok: false, error: "End date must be on or after start date." };
  }

  const isSub = await isSubcontractorMember(
    membership.id,
    membership.organization_id,
  );
  if (!isSub && (postedHours <= 0 || postedHours > 200)) {
    return { ok: false, error: "Hours must be between 1 and 200." };
  }
  const hours = isSub ? 0 : postedHours;

  const { error } = await (supabase
    .from("pto_requests")
    .insert({
      organization_id: membership.organization_id,
      employee_id: membership.id,
      start_date,
      end_date,
      hours,
      reason: reason || null,
      status: "pending",
    }) as unknown as Promise<{ error: { message: string } | null }>);

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

  // Prior state decides the balance side-effect below.
  const { data: before } = (await supabase
    .from("pto_requests")
    .select("status, employee_id, hours, start_date, end_date, payroll_run_id")
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      status: string;
      employee_id: string;
      hours: number;
      start_date: string;
      end_date: string;
      payroll_run_id: string | null;
    } | null;
  };
  if (!before) return { ok: false, error: "Request not found." };

  // Time off a payroll run has swallowed is frozen, same as hours and
  // bonuses: the run's total includes it, so changing it here would leave
  // the run saying one thing and this record another. The unlock is the
  // same too: delete that pay period, fix the request, create it again.
  if (before.payroll_run_id) {
    return {
      ok: false,
      error:
        "This time off is inside a payroll run. Delete that pay period to unlock it first.",
    };
  }

  // Approving time off whose days a payroll run already covers would
  // orphan it: runs gather only approved requests at generation time and
  // never re-read the period, and no future run's window reaches back. It
  // would read "approved" forever while never being paid.
  if (
    status === "approved" &&
    before.status !== "approved" &&
    Number(before.hours) > 0
  ) {
    const [{ runCoveringWindow }, { createSupabaseAdminClient }] =
      await Promise.all([
        import("@/lib/pay-period-fence"),
        import("@/lib/supabase/admin"),
      ]);
    const covering = await runCoveringWindow(
      createSupabaseAdminClient(),
      membership.organization_id,
      before.start_date,
      before.end_date,
      "payroll_runs",
    );
    if (covering) {
      return {
        ok: false,
        error: `A payroll run already covers ${covering.period_start} – ${covering.period_end}. Delete that pay period and create it again so this time off is included in the pay.`,
      };
    }
  }

  const { error } = await (supabase
    .from("pto_requests")
    .update({
      status,
      reviewed_by: membership.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq(
      "organization_id",
      membership.organization_id,
    ) as unknown as Promise<{ error: { message: string } | null }>);

  if (error) return { ok: false, error: error.message };

  // Keep the cached balance symmetric with create/delete: approving spends
  // the hours, un-approving refunds them. Same best-effort RPC pattern as
  // everywhere else — may not exist, non-critical.
  const balanceDelta =
    before.status !== "approved" && status === "approved"
      ? Number(before.hours)
      : before.status === "approved" && status !== "approved"
        ? -Number(before.hours)
        : 0;
  await adjustPtoBalance(
    supabase,
    before.employee_id,
    before.start_date,
    balanceDelta,
  );

  // Fire-and-forget email to the employee about the decision.
  notifyPtoStatus(id);

  // Own surface only — submitSelfPtoRequestAction documents the 30s+
  // freezes cross-surface revalidation caused. The other side is a
  // dynamic page and is fresh on its next request anyway.
  revalidatePath("/app/timesheets", "page");
  return { ok: true };
}

/**
 * Admin edit of a request's substance — dates, hours, reason. The status
 * is deliberately KEPT: the editor is owner/admin/manager, i.e. the
 * approval authority, so their edit re-answers the question itself.
 * (A requester editing their own request goes through
 * updateSelfPtoRequestAction below, which revokes approval instead.)
 */
export async function updatePtoRequestAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const id = String(formData.get("id") ?? "");
  const fields = {
    start_date: String(formData.get("start_date") ?? ""),
    end_date: String(formData.get("end_date") ?? ""),
    hours: Number(formData.get("hours") ?? 0),
  };
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id) return { ok: false, error: "Missing request id." };

  const { data: before } = (await supabase
    .from("pto_requests")
    .select("status, employee_id, hours, start_date, payroll_run_id")
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      status: string;
      employee_id: string;
      hours: number;
      start_date: string;
      payroll_run_id: string | null;
    } | null;
  };
  if (!before) return { ok: false, error: "Request not found." };

  // Time off a payroll run has swallowed is frozen, same as hours and
  // bonuses: the run's total includes it, so changing it here would leave
  // the run saying one thing and this record another. The unlock is the
  // same too: delete that pay period, fix the request, create it again.
  if (before.payroll_run_id) {
    return {
      ok: false,
      error:
        "This time off is inside a payroll run. Delete that pay period to unlock it, fix the request, then create the period again.",
    };
  }

  const isSub = await isSubcontractorMember(
    before.employee_id,
    membership.organization_id,
  );
  if (isSub) fields.hours = 0;

  const { validatePtoFields } = await import("@/lib/pto-rules");
  const invalid = validatePtoFields(fields, { allowZeroHours: isSub });
  if (invalid) return { ok: false, error: invalid };

  // Moving an APPROVED request's dates into a period a run already covers
  // orphans it exactly like approving one there would — the run predates
  // the move and nothing re-reads the period. (A pending request can move
  // freely: the approve fence catches it at decision time.)
  if (before.status === "approved" && fields.hours > 0) {
    const [{ runCoveringWindow }, { createSupabaseAdminClient }] =
      await Promise.all([
        import("@/lib/pay-period-fence"),
        import("@/lib/supabase/admin"),
      ]);
    const covering = await runCoveringWindow(
      createSupabaseAdminClient(),
      membership.organization_id,
      fields.start_date,
      fields.end_date,
      "payroll_runs",
    );
    if (covering) {
      return {
        ok: false,
        error: `A payroll run already covers ${covering.period_start} – ${covering.period_end}. Delete that pay period and create it again so this time off is included in the pay.`,
      };
    }
  }

  const { error } = await (supabase
    .from("pto_requests")
    .update({
      start_date: fields.start_date,
      end_date: fields.end_date,
      hours: fields.hours,
      reason: reason || null,
    })
    .eq("id", id)
    .eq(
      "organization_id",
      membership.organization_id,
    ) as unknown as Promise<{ error: { message: string } | null }>);

  if (error) return { ok: false, error: error.message };

  // An approved request's hours moved — move the cached balance with them.
  if (before.status === "approved" && Number(before.hours) !== fields.hours) {
    await adjustPtoBalance(
      supabase,
      before.employee_id,
      before.start_date,
      fields.hours - Number(before.hours),
    );
  }

  // Tell the person their time off changed under them.
  try {
    const { notify } = await import("@/lib/notify");
    await notify({
      audience: "membership",
      membershipId: before.employee_id,
      organizationId: membership.organization_id,
      title: "Your time off was updated",
      body: `Now ${fields.start_date}${
        fields.end_date !== fields.start_date ? ` to ${fields.end_date}` : ""
      }, ${fields.hours}h (${before.status}).`,
      href: "/field/profile",
    });
  } catch {
    // Best-effort only.
  }

  revalidatePath("/app/timesheets", "page");
  return { ok: true };
}

// ── Requester self-service: cancel / modify own request ──────
//
// Workers have no UPDATE policy on pto_requests (deliberately — approval
// state is not theirs to write), so both actions verify ownership against
// the caller's membership and then write with the admin client, the same
// shape deletePtoRequestAction uses for its role-gated write.

export async function cancelSelfPtoRequestAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing request id." };

  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const admin = createSupabaseAdminClient();

  const { data: before } = (await admin
    .from("pto_requests")
    .select(
      "id, employee_id, start_date, end_date, hours, status, payroll_run_id",
    )
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      employee_id: string;
      start_date: string;
      end_date: string;
      hours: number;
      status: "pending" | "approved" | "declined" | "cancelled";
      payroll_run_id: string | null;
    } | null;
  };

  if (!before || before.employee_id !== membership.id) {
    return { ok: false, error: "Request not found." };
  }

  // Already paid out in a payroll run — cancelling it now would refund
  // hours the run has already counted. Only unwinding the run itself can
  // change this, and that's a manager's move.
  if (before.payroll_run_id) {
    return {
      ok: false,
      error:
        "This time off is already included in a payroll run — ask your manager if it needs to change.",
    };
  }

  const [{ workerCanCancel }, { zonedYmd }] = await Promise.all([
    import("@/lib/pto-rules"),
    import("@/lib/wall-clock"),
  ]);
  const orgTz = await getOrgTimezone(membership.organization_id);
  if (!workerCanCancel(before.status, before.end_date, zonedYmd(new Date(), orgTz))) {
    return {
      ok: false,
      error: "This request can no longer be cancelled — ask your manager.",
    };
  }

  const { error } = (await admin
    .from("pto_requests")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("organization_id", membership.organization_id)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };

  // Refund the cached balance if the cancelled request was approved.
  if (before.status === "approved") {
    await adjustPtoBalance(
      supabase,
      before.employee_id,
      before.start_date,
      -Number(before.hours),
    );
  }

  // The schedule just got days back — management should hear about it.
  try {
    const { notify } = await import("@/lib/notify");
    const { memberDisplayName } = await import("@/lib/member-display");
    const { data: me } = (await admin
      .from("memberships")
      .select("display_name, profile:profiles ( full_name )")
      .eq("id", membership.id)
      .maybeSingle()) as unknown as {
      data: {
        display_name: string | null;
        profile: { full_name: string | null } | null;
      } | null;
    };
    await notify({
      audience: "org-management",
      organizationId: membership.organization_id,
      title: "Time off cancelled",
      body: `${me ? memberDisplayName(me) : "A team member"} cancelled their time off ${before.start_date}${
        before.end_date !== before.start_date ? ` to ${before.end_date}` : ""
      }.`,
      href: "/app/timesheets",
    });
  } catch {
    // Best-effort only.
  }

  // Field surface only — revalidating /app/timesheets from a field action
  // is the exact pattern submitSelfPtoRequestAction documents as causing
  // 30s+ freezes (the action waits on the admin layout's queries).
  revalidatePath("/field/profile");
  return { ok: true };
}

export async function updateSelfPtoRequestAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  const id = String(formData.get("id") ?? "");
  const fields = {
    start_date: String(formData.get("start_date") ?? ""),
    end_date: String(formData.get("end_date") ?? ""),
    hours: Number(formData.get("hours") ?? 0),
  };
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id) return { ok: false, error: "Missing request id." };

  const [{ validatePtoFields, workerCanEdit, statusAfterWorkerEdit }, { zonedYmd }] =
    await Promise.all([import("@/lib/pto-rules"), import("@/lib/wall-clock")]);
  const isSub = await isSubcontractorMember(
    membership.id,
    membership.organization_id,
  );
  if (isSub) fields.hours = 0;
  const invalid = validatePtoFields(fields, { allowZeroHours: isSub });
  if (invalid) return { ok: false, error: invalid };

  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const admin = createSupabaseAdminClient();

  const { data: before } = (await admin
    .from("pto_requests")
    .select(
      "id, employee_id, start_date, end_date, hours, status, payroll_run_id",
    )
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      employee_id: string;
      start_date: string;
      end_date: string;
      hours: number;
      status: "pending" | "approved" | "declined" | "cancelled";
      payroll_run_id: string | null;
    } | null;
  };

  if (!before || before.employee_id !== membership.id) {
    return { ok: false, error: "Request not found." };
  }

  // Same freeze as cancelling: a run already paid these hours.
  if (before.payroll_run_id) {
    return {
      ok: false,
      error:
        "This time off is already included in a payroll run — ask your manager if it needs to change.",
    };
  }

  const orgTz = await getOrgTimezone(membership.organization_id);
  if (!workerCanEdit(before.status, before.start_date, zonedYmd(new Date(), orgTz))) {
    return {
      ok: false,
      error:
        "This request can no longer be changed — cancel it or ask your manager.",
    };
  }

  // Changing an approved request revokes the approval: a manager said yes
  // to specific dates, and different dates are a different question.
  const wasApproved = before.status === "approved";
  const { error } = (await admin
    .from("pto_requests")
    .update({
      start_date: fields.start_date,
      end_date: fields.end_date,
      hours: fields.hours,
      reason: reason || null,
      status: statusAfterWorkerEdit(before.status),
      reviewed_by: null,
      reviewed_at: null,
    })
    .eq("id", id)
    .eq("organization_id", membership.organization_id)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };

  // The approval (and its spent hours) is revoked until re-approved.
  if (wasApproved) {
    await adjustPtoBalance(
      supabase,
      before.employee_id,
      before.start_date,
      -Number(before.hours),
    );
  }

  try {
    const { notify } = await import("@/lib/notify");
    const { memberDisplayName } = await import("@/lib/member-display");
    const { data: me } = (await admin
      .from("memberships")
      .select("display_name, profile:profiles ( full_name )")
      .eq("id", membership.id)
      .maybeSingle()) as unknown as {
      data: {
        display_name: string | null;
        profile: { full_name: string | null } | null;
      } | null;
    };
    await notify({
      audience: "org-management",
      organizationId: membership.organization_id,
      title: wasApproved
        ? "Changed time off needs re-approval"
        : "Time-off request updated",
      body: `${me ? memberDisplayName(me) : "A team member"} now asks for ${fields.start_date}${
        fields.end_date !== fields.start_date ? ` to ${fields.end_date}` : ""
      }, ${fields.hours}h.`,
      href: "/app/timesheets",
    });
  } catch {
    // Best-effort only.
  }

  // Field surface only — see cancelSelfPtoRequestAction above.
  revalidatePath("/field/profile");
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

  // Reject future-dated manual entries. A typo (admin meant "2024" but
  // typed "2124") would otherwise create a permanently-broken
  // "currently clocked in" indicator and pollute payroll forecasts.
  // 5-minute slack allows a manual entry for a shift that JUST
  // started (clock-in is delayed by network or typo).
  if (new Date(start_at).getTime() > Date.now() + 5 * 60 * 1000) {
    return { _error: "Start time can't be in the future." };
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
    // Same forward bound on end_at.
    if (new Date(end_at).getTime() > Date.now() + 5 * 60 * 1000) {
      return { _error: "End time can't be in the future." };
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

  // Snapshot the employee's current pay rate. Manual entries created
  // after the fact still use the rate THAT'S CURRENT NOW — we don't
  // know what their rate was at the actual shift time. That's
  // documented behavior: admins editing historical entries get the
  // current rate. If they want a different rate, they can update the
  // snapshot directly via the entry edit form (separate code path).
  // RLS lockdown (migration 20260601040000): pay_rate_cents is no
  // longer SELECT-able via end-user JWT. Use admin client scoped to
  // the target employee's row in THIS admin's org.
  const { createSupabaseAdminClient: createAdminForRate } = await import(
    "@/lib/supabase/admin"
  );
  const rateAdmin = createAdminForRate();
  const { data: manualRateRow } = (await rateAdmin
    .from("memberships")
    .select("pay_rate_cents, engagement")
    .eq("id", parsed.employee_id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: { pay_rate_cents: number | null; engagement: string | null } | null;
  };

  const { toEngagement } = await import("@/lib/engagement");

  // Backfilling hours into a period a pay run already covers would orphan
  // them: the run was generated before this entry existed and nothing ever
  // re-reads the period. The hours would look recorded while never being
  // paid. Refuse and point at the unlock instead.
  {
    const [{ runCoveringWindow }, { zonedYmd }] = await Promise.all([
      import("@/lib/pay-period-fence"),
      import("@/lib/wall-clock"),
    ]);
    const engagement = toEngagement(manualRateRow?.engagement);
    const startYmd = zonedYmd(new Date(parsed.start_at), orgTz);
    const endYmd = zonedYmd(new Date(parsed.end_at ?? parsed.start_at), orgTz);
    const covering = await runCoveringWindow(
      rateAdmin,
      membership.organization_id,
      startYmd,
      endYmd,
      engagement === "subcontractor"
        ? "subcontractor_pay_runs"
        : "payroll_runs",
    );
    if (covering) {
      return {
        ok: false,
        error:
          engagement === "subcontractor"
            ? `A contractor statement already covers ${covering.period_start} – ${covering.period_end}. Delete that statement first, add the entry, then generate it again.`
            : `A payroll run already covers ${covering.period_start} – ${covering.period_end}. Delete that pay period first, add the entry, then create it again.`,
      };
    }
  }

  const { data: inserted, error } = await supabase
    .from("time_entries")
    .insert({
      organization_id: membership.organization_id,
      employee_id: parsed.employee_id,
      booking_id: parsed.booking_id,
      clock_in_at: parsed.start_at,
      clock_out_at: parsed.end_at,
      // Encrypt before write. Read sites use maybeDecryptField; legacy
      // plaintext rows still display correctly until they're next saved.
      notes: encryptField(parsed.notes),
      pay_rate_cents_snapshot: manualRateRow?.pay_rate_cents ?? null,
      // Same current-state rule as the rate, same reason: which pay system
      // the hours belong to is fixed when the entry is recorded.
      engagement_snapshot: toEngagement(manualRateRow?.engagement),
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

  const { data: before } = (await supabase
    .from("time_entries")
    .select(
      "clock_in_at, clock_out_at, employee_id, booking_id, payroll_run_id, subcontractor_run_id, engagement_snapshot",
    )
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      clock_in_at: string;
      clock_out_at: string | null;
      employee_id: string;
      booking_id: string | null;
      payroll_run_id: string | null;
      subcontractor_run_id: string | null;
      engagement_snapshot: string | null;
    } | null;
  };

  // Hours a pay run has swallowed are frozen. Editing an entry AFTER a
  // payroll run or subcontractor statement snapshotted it changes the hours
  // without changing the money — the run says one number, the timesheet
  // another, and whichever a person checks second looks wrong. The unlock is
  // deliberate and loud: delete the run or statement (which releases its
  // entries), fix the hours, regenerate.
  if (before?.payroll_run_id || before?.subcontractor_run_id) {
    return {
      ok: false,
      error: before.payroll_run_id
        ? "This entry is part of a payroll run. Delete that pay period to unlock it, fix the hours, then create the period again."
        : "This entry is on a subcontractor statement. Delete that statement to unlock it, fix the hours, then generate again.",
    };
  }

  // The edit form round-trips seconds; the stored punch has milliseconds. A
  // field that comes back as the stored instant truncated to the second was
  // not edited, so keep the original and leave the row untouched. Without
  // this, opening an entry and saving it moved the start earlier — far enough
  // to land inside the previous back-to-back punch, which the overlap check
  // below then refused, with no way past it from the UI.
  const start_at =
    preserveWithinMinute(parsed.start_at, before?.clock_in_at) ?? parsed.start_at;
  const end_at = preserveWithinMinute(parsed.end_at, before?.clock_out_at);

  // The create fence's sibling: this entry isn't stamped (the freeze above
  // already returned if it were), so if its times land inside a period a
  // pay run covers, no run will ever gather it — moved there or already
  // sitting there, the hours would look recorded and never be paid.
  {
    const [{ runCoveringWindow }, { zonedYmd }, { createSupabaseAdminClient }] =
      await Promise.all([
        import("@/lib/pay-period-fence"),
        import("@/lib/wall-clock"),
        import("@/lib/supabase/admin"),
      ]);
    const isSubEntry = before?.engagement_snapshot === "subcontractor";
    const covering = await runCoveringWindow(
      createSupabaseAdminClient(),
      membership.organization_id,
      zonedYmd(new Date(start_at), orgTz),
      zonedYmd(new Date(end_at ?? start_at), orgTz),
      isSubEntry ? "subcontractor_pay_runs" : "payroll_runs",
    );
    if (covering) {
      return {
        ok: false,
        error: isSubEntry
          ? `A contractor statement already covers ${covering.period_start} – ${covering.period_end}. Delete that statement first, fix the entry, then generate it again.`
          : `A payroll run already covers ${covering.period_start} – ${covering.period_end}. Delete that pay period first, fix the entry, then create it again.`,
      };
    }
  }

  // Overlap check — excludes the entry being edited so the entry doesn't
  // flag against itself.
  const overlap = await findOverlap(
    supabase,
    membership.organization_id,
    parsed.employee_id,
    start_at,
    end_at,
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
      clock_in_at: start_at,
      clock_out_at: end_at,
      // A human just set these hours deliberately — that IS the review, so
      // clear the flag. Without this needs_review is a write-once latch that
      // blocks payroll forever even after the entry has been corrected.
      needs_review: false,
      // Encrypt before write. Read sites use maybeDecryptField; legacy
      // plaintext rows still display correctly until they're next saved.
      notes: encryptField(parsed.notes),
    } as never)
    .eq("id", id)
    .eq("organization_id", membership.organization_id);

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
      clock_in_at: start_at,
      clock_out_at: end_at,
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
    .from("pto_requests")
    .select("id, employee_id, start_date, hours, status, payroll_run_id")
    .eq("id", id)
    .eq(
      "organization_id",
      membership.organization_id,
    )
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      employee_id: string;
      start_date: string;
      hours: number;
      status: string;
      payroll_run_id: string | null;
    } | null;
  };

  if (!before) return { ok: false, error: "Request not found." };

  // Deleting is the harsher version of editing — same freeze as hours and
  // bonuses. The run paid these hours; erase the request and the run total
  // stops adding up to anything on record.
  if (before.payroll_run_id) {
    return {
      ok: false,
      error:
        "This time off is inside a payroll run. Delete that pay period first to unlock it.",
    };
  }

  const { error } = (await admin
    .from("pto_requests")
    .delete()
    .eq("id", id)
    .eq(
      "organization_id",
      membership.organization_id,
    )) as unknown as { error: { message: string } | null };
  if (error) return { ok: false, error: error.message };

  // Reverse the PTO balance if the deleted request was approved — the row
  // is gone either way.
  if (before.status === "approved") {
    await adjustPtoBalance(
      supabase,
      before.employee_id,
      before.start_date,
      -Number(before.hours),
    );
  }

  revalidatePath("/app/timesheets", "page");
  return { ok: true };
}

/**
 * Check for an OVERLAP with another time entry for the same employee.
 *
 * Two entries overlap when they share any instant on the clock — A.start <
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
  const nowMs = Date.now();
  const effectiveEnd = endIso ?? new Date(nowMs).toISOString();

  // Pull every entry for this employee whose start is before our end, then
  // keep the ones whose stop is after our start. An open shift is treated as
  // running until now, which is what the docstring above has always claimed.
  let query = supabase
    .from("time_entries")
    .select("id, clock_in_at, clock_out_at")
    .eq("organization_id", organizationId)
    .eq("employee_id", employeeId)
    .lt("clock_in_at", effectiveEnd);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { data } = (await query) as unknown as {
    data: Array<{
      id: string;
      clock_in_at: string;
      clock_out_at: string | null;
    }> | null;
  };

  for (const row of data ?? []) {
    if (endsAfterStart(row.clock_out_at, startIso, nowMs)) {
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

  // Refuse the whole batch if any selected entry is frozen inside a pay run
  // or statement — a partial "deleted 7 of 9" leaves the owner guessing which
  // two survived and why. All-or-nothing keeps the refusal explainable.
  {
    const { data: frozen } = (await supabase
      .from("time_entries")
      .select("id, payroll_run_id, subcontractor_run_id")
      .in("id", rawIds)
      .eq("organization_id", membership.organization_id)
      .or("payroll_run_id.not.is.null,subcontractor_run_id.not.is.null")) as unknown as {
      data: Array<{ id: string }> | null;
    };
    if (frozen && frozen.length > 0) {
      return {
        ok: false,
        error: `${frozen.length} of the selected entries are locked inside a pay run or statement. Delete that run/statement first, or deselect them.`,
      };
    }
  }

  // Pull the rows we're about to remove so we can stamp full snapshots
  // into the audit log.
  const { data: before } = (await supabase
    .from("time_entries")
    .select("id, employee_id, booking_id, clock_in_at, clock_out_at")
    .in("id", rawIds)
    .eq("organization_id", membership.organization_id)) as unknown as {
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
    .in("id", rawIds)
    .eq("organization_id", membership.organization_id);
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

  const { data: before } = (await supabase
    .from("time_entries")
    .select("clock_in_at, clock_out_at, employee_id, engagement_snapshot")
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      clock_in_at: string;
      clock_out_at: string | null;
      employee_id: string;
      engagement_snapshot: string | null;
    } | null;
  };
  if (!before) return { ok: false, error: "Entry not found." };
  if (before.clock_out_at) {
    return { ok: false, error: "This shift was already closed." };
  }
  if (new Date(endUtc).getTime() <= new Date(before.clock_in_at).getTime()) {
    return { ok: false, error: "End time must be after the clock-in time." };
  }
  // Cap end time to now + 24h. Without this, an admin typo (year 2126
  // instead of 2026) would silently land a permanent open-looking
  // shift years in the future. Generous bound (24h) handles legitimate
  // late-night closures that cross into the next day.
  if (new Date(endUtc).getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    return {
      ok: false,
      error: "End time can't be more than 24 hours from now.",
    };
  }

  // Run gathering skips open shifts (no clock-out, no hours to count). So a
  // shift that stayed open across a run's generation is not in that run —
  // and closing it now would strand it: recorded, unstamped, in a period no
  // future run re-reads. Refuse and put the close INSIDE the unlock, so the
  // hours actually get paid.
  {
    const [{ runCoveringWindow }, { zonedYmd }, { createSupabaseAdminClient }] =
      await Promise.all([
        import("@/lib/pay-period-fence"),
        import("@/lib/wall-clock"),
        import("@/lib/supabase/admin"),
      ]);
    const isSubEntry = before.engagement_snapshot === "subcontractor";
    const covering = await runCoveringWindow(
      createSupabaseAdminClient(),
      membership.organization_id,
      zonedYmd(new Date(before.clock_in_at), orgTz),
      zonedYmd(new Date(endUtc), orgTz),
      isSubEntry ? "subcontractor_pay_runs" : "payroll_runs",
    );
    if (covering) {
      return {
        ok: false,
        error: isSubEntry
          ? `This shift was open when the ${covering.period_start} – ${covering.period_end} contractor statement was generated, so it isn't in it. Delete that statement, close the shift, then generate it again — otherwise these hours would never be paid.`
          : `This shift was open when the ${covering.period_start} – ${covering.period_end} payroll run was generated, so it isn't in it. Delete that pay period, close the shift, then create it again — otherwise these hours would never be paid.`,
      };
    }
  }

  const { error } = await supabase
    .from("time_entries")
    .update({ clock_out_at: endUtc, needs_review: false } as never)
    .eq("id", id)
    .eq("organization_id", membership.organization_id);
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

  const { data: before } = (await supabase
    .from("time_entries")
    .select(
      "employee_id, booking_id, clock_in_at, clock_out_at, payroll_run_id, subcontractor_run_id",
    )
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      employee_id: string;
      booking_id: string | null;
      clock_in_at: string;
      clock_out_at: string | null;
      payroll_run_id: string | null;
      subcontractor_run_id: string | null;
    } | null;
  };

  // Same freeze as updateTimeEntryAction — deleting a paid entry is the
  // harsher version of editing one.
  if (before?.payroll_run_id || before?.subcontractor_run_id) {
    return {
      ok: false,
      error: before.payroll_run_id
        ? "This entry is part of a payroll run. Delete that pay period first to unlock it."
        : "This entry is on a subcontractor statement. Delete that statement first to unlock it.",
    };
  }

  const { error } = await supabase
    .from("time_entries")
    .delete()
    .eq("id", id)
    .eq("organization_id", membership.organization_id);
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

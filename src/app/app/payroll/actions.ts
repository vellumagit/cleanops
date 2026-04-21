"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { notifyPayrollPaid } from "@/lib/automations";

type Result = { ok: true; id: string } | { ok: false; error: string };

/**
 * Compute + create a payroll run for a date range. Snapshots every
 * employee's hours, regular pay, bonuses, and PTO into payroll_items.
 */
export async function createPayrollRunAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();

  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Only owners and admins can create payroll runs." };
  }

  const period_start = String(formData.get("period_start") ?? "");
  const period_end = String(formData.get("period_end") ?? "");

  if (!period_start || !period_end) {
    return { ok: false, error: "Period start and end are required." };
  }
  if (new Date(period_end) < new Date(period_start)) {
    return { ok: false, error: "Period end must be on or after start." };
  }

  const fromIso = `${period_start}T00:00:00Z`;
  const toIso = `${period_end}T23:59:59Z`;

  // Fetch data to compute
  const [{ data: entries }, { data: employees }, { data: bonuses }, { data: ptoRequests }] =
    await Promise.all([
      supabase
        .from("time_entries")
        .select(
          "employee_id, clock_in_at, clock_out_at, booking:bookings ( hourly_rate_cents, total_cents )",
        )
        .gte("clock_in_at", fromIso)
        .lte("clock_in_at", toIso)
        .not("clock_out_at", "is", null),
      supabase
        .from("memberships")
        .select("id, pay_rate_cents, profile:profiles ( full_name )")
        .in("role", ["employee", "manager"])
        .eq("status", "active")
        .eq("organization_id", membership.organization_id),
      supabase
        .from("bonuses")
        .select("employee_id, amount_cents, status, period_end")
        .eq("organization_id", membership.organization_id)
        .gte("period_end", period_start)
        .lte("period_end", period_end)
        .in("status", ["pending"] as never),
      supabase
        .from("pto_requests" as never)
        .select("employee_id, hours, status")
        .eq("organization_id" as never, membership.organization_id as never)
        .eq("status" as never, "approved" as never)
        .gte("start_date" as never, period_start as never)
        .lte("end_date" as never, period_end as never),
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

  // Seed with every active employee (so zero-hour rows still show up)
  for (const emp of employees ?? []) {
    buckets.set(emp.id, {
      employeeName: emp.profile?.full_name ?? "Unknown",
      minutes: 0,
      regularCents: 0,
      bonusCents: 0,
      ptoHours: 0,
      ptoCents: 0,
      payRateCents: emp.pay_rate_cents ?? 0,
    });
  }

  // Sum hours worked
  for (const e of entries ?? []) {
    if (!e.employee_id || !e.clock_in_at || !e.clock_out_at) continue;
    const bucket = buckets.get(e.employee_id);
    if (!bucket) continue;
    const mins = Math.max(
      0,
      Math.round(
        (new Date(e.clock_out_at).getTime() -
          new Date(e.clock_in_at).getTime()) /
          60_000,
      ),
    );
    bucket.minutes += mins;
    const rate = e.booking?.hourly_rate_cents ?? bucket.payRateCents;
    bucket.regularCents += Math.round((mins * rate) / 60);
  }

  // Sum bonuses
  for (const b of bonuses ?? []) {
    if (!b.employee_id) continue;
    const bucket = buckets.get(b.employee_id);
    if (!bucket) continue;
    bucket.bonusCents += b.amount_cents ?? 0;
  }

  // Sum PTO
  for (const p of (ptoRequests ?? []) as Array<{
    employee_id: string;
    hours: number;
  }>) {
    const bucket = buckets.get(p.employee_id);
    if (!bucket) continue;
    const h = Number(p.hours) || 0;
    bucket.ptoHours += h;
    bucket.ptoCents += Math.round(h * bucket.payRateCents);
  }

  // Filter out employees with zero across the board
  const items = [...buckets.entries()]
    .map(([employeeId, b]) => ({
      employeeId,
      ...b,
      totalCents: b.regularCents + b.bonusCents + b.ptoCents,
    }))
    .filter(
      (i) => i.minutes > 0 || i.bonusCents > 0 || i.ptoCents > 0,
    );

  if (items.length === 0) {
    return { ok: false, error: "No hours, bonuses, or PTO found in this period." };
  }

  const runTotalCents = items.reduce((s, i) => s + i.totalCents, 0);

  // Create the run
  const { data: run, error: runErr } = await (supabase
    .from("payroll_runs" as never)
    .insert({
      organization_id: membership.organization_id,
      period_start,
      period_end,
      status: "draft",
      total_cents: runTotalCents,
      created_by: membership.id,
    } as never)
    .select("id")
    .single() as unknown as Promise<{
    data: { id: string } | null;
    error: { message: string } | null;
  }>);

  if (runErr || !run) {
    return { ok: false, error: runErr?.message ?? "Failed to create payroll run." };
  }

  // Insert items
  const itemsToInsert = items.map((i) => ({
    payroll_run_id: run.id,
    organization_id: membership.organization_id,
    employee_id: i.employeeId,
    employee_name: i.employeeName,
    hours_worked: Math.round((i.minutes / 60) * 100) / 100,
    regular_pay_cents: i.regularCents,
    bonus_cents: i.bonusCents,
    pto_hours: i.ptoHours,
    pto_pay_cents: i.ptoCents,
    total_cents: i.totalCents,
  }));

  const { error: itemsErr } = await (supabase
    .from("payroll_items" as never)
    .insert(itemsToInsert as never) as unknown as Promise<{
    error: { message: string } | null;
  }>);

  if (itemsErr) {
    // Roll back the run
    await supabase.from("payroll_runs" as never).delete().eq("id" as never, run.id as never);
    return { ok: false, error: itemsErr.message };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "bonus",
    entity_id: run.id,
    after: {
      period_start,
      period_end,
      total_cents: runTotalCents,
      employee_count: items.length,
    },
  });

  revalidatePath("/app/payroll", "page");
  return { ok: true, id: run.id };
}

export async function finalizePayrollRunAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  await (supabase
    .from("payroll_runs" as never)
    .update({
      status: "finalized",
      finalized_at: new Date().toISOString(),
    } as never)
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never) as unknown as Promise<unknown>);

  await logAuditEvent({
    membership,
    action: "status_change",
    entity: "bonus",
    entity_id: id,
    after: { status: "finalized" },
  });

  // Revalidate at "page" scope to avoid re-running the app layout's
  // many parallel nav-badge queries on every server action.
  revalidatePath("/app/payroll", "page");
  revalidatePath(`/app/payroll/${id}`, "page");
}

export async function markPayrollPaidAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  await (supabase
    .from("payroll_runs" as never)
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
    } as never)
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never) as unknown as Promise<unknown>);

  await logAuditEvent({
    membership,
    action: "mark_paid",
    entity: "bonus",
    entity_id: id,
  });

  // Fire-and-forget per-employee "you were paid" receipt.
  notifyPayrollPaid(id);

  // Revalidate at "page" scope to avoid re-running the app layout's
  // many parallel nav-badge queries on every server action.
  revalidatePath("/app/payroll", "page");
  revalidatePath(`/app/payroll/${id}`, "page");
}

export async function deletePayrollRunAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const confirmPhrase = String(formData.get("confirm") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  const { data: run } = await (supabase
    .from("payroll_runs" as never)
    .select("status")
    .eq("id" as never, id as never)
    .maybeSingle() as unknown as Promise<{
    data: { status: string } | null;
  }>);

  if (!run) return;

  // Draft runs can be deleted freely.
  // Finalized/paid runs require the admin to type "DELETE" to confirm —
  // this is a sensitive financial record and we don't want accidents.
  if (run.status !== "draft" && confirmPhrase !== "DELETE") return;

  await (supabase
    .from("payroll_runs" as never)
    .delete()
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never) as unknown as Promise<unknown>);

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "bonus",
    entity_id: id,
    before: { status: run.status },
  });

  revalidatePath("/app/payroll", "page");
  redirect("/app/payroll");
}

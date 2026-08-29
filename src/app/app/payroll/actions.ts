"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import { notifyPayrollPaid } from "@/lib/automations";
import { preparePayPeriod } from "@/lib/pay-period";

type Result = { ok: true; id: string } | { ok: false; error: string };

/**
 * A custom pay-period range has to be a real, bounded window. The old
 * checks (regex + order) accepted 2026-02-31 (which Date.UTC silently
 * rolls to March 3, so the run's window and its stored dates disagree)
 * and a fat-fingered 2062 end date (a 36-year "period" that swallows —
 * then truncates — the org's entire unpaid history: the Olha bug with
 * extra steps).
 */
export async function validatePeriodRange(
  start: string,
  end: string,
): Promise<string | null> {
  const shape = /^\d{4}-\d{2}-\d{2}$/;
  if (!shape.test(start) || !shape.test(end)) {
    return "Dates must be valid calendar dates.";
  }
  // Round-trip: a date that normalizes to a different YMD never existed.
  for (const ymd of [start, end]) {
    if (new Date(`${ymd}T00:00:00Z`).toISOString().slice(0, 10) !== ymd) {
      return `${ymd} isn't a real calendar date.`;
    }
  }
  if (end < start) return "Period end must be on or after start.";
  const days =
    (new Date(`${end}T00:00:00Z`).getTime() -
      new Date(`${start}T00:00:00Z`).getTime()) /
      86_400_000 +
    1;
  if (days > 92) {
    return "A pay period can't be longer than 92 days — split it up.";
  }
  return null;
}

/**
 * Compute + create a payroll run for a date range. Snapshots every
 * employee's hours, regular pay, bonuses, and PTO into payroll_items.
 */
/**
 * Prepare one pay period across BOTH systems: the employee payroll run and
 * the contractor statement for the same window, stragglers swept in. The
 * heavy machinery lives in lib/payroll-run-create + lib/contractor-run-create
 * (moved there verbatim so the cron autodraft shares it); this action is the
 * gate + audit around it.
 */
export async function preparePeriodAction(
  formData: FormData,
): Promise<{ ok: true; href: string } | { ok: false; error: string }> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Only owners and admins can prepare pay periods." };
  }

  const period_start = String(formData.get("period_start") ?? "").trim();
  const period_end = String(formData.get("period_end") ?? "").trim();
  const rangeErr = await validatePeriodRange(period_start, period_end);
  if (rangeErr) return { ok: false, error: rangeErr };

  const result = await preparePayPeriod({
    organizationId: membership.organization_id,
    createdByMembershipId: membership.id,
    periodStart: period_start,
    periodEnd: period_end,
  });
  if (!result.ok) return { ok: false, error: result.error };

  await logAuditEvent({
    membership,
    action: "create",
    entity: "bonus",
    entity_id: result.payroll?.id ?? result.contractor?.id ?? period_start,
    after: {
      entity_name: "pay_period_prepared",
      period_start,
      period_end,
      payroll_total_cents: result.payroll?.totalCents ?? 0,
      contractor_total_cents: result.contractor?.totalCents ?? 0,
    },
  });

  revalidatePath("/app/payroll", "page");
  revalidatePath("/app/payroll/contractors", "page");
  return { ok: true, href: result.href };
}

export async function finalizePayrollRunAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  // Only a draft can be finalized — and the claim is CHECKED, so a
  // replayed/forged POST that matches nothing doesn't write a phantom
  // "finalized" transition into the audit trail of a financial record.
  const { data: claimed } = (await supabase
    .from("payroll_runs")
    .update({
      status: "finalized",
      finalized_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .eq("status", "draft")
    .select("id")) as unknown as { data: Array<{ id: string }> | null };
  if (!claimed || claimed.length === 0) return;

  await logAuditEvent({
    membership,
    action: "status_change",
    entity: "payroll_run",
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

  // Only a finalized run can be marked paid (atomic state-machine guard) —
  // and the claim has to be CHECKED, not just attempted. A second click used
  // to no-op this update but still run everything below it: bonuses
  // re-marked, a duplicate audit entry, and another "you were paid" text to
  // every employee on the run.
  const { data: claimed } = (await supabase
    .from("payroll_runs")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .eq("status", "finalized")
    .select("id")) as unknown as { data: Array<{ id: string }> | null };
  if (!claimed || claimed.length === 0) return;

  // Mark the bonuses consumed by this run as paid, so they reflect as paid
  // in the bonuses list and can't be separately marked paid again.
  await (supabase
    .from("bonuses")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .eq("payroll_run_id", id)
    .eq("organization_id", membership.organization_id) as unknown as Promise<unknown>);

  await logAuditEvent({
    membership,
    action: "mark_paid",
    entity: "payroll_run",
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
    .from("payroll_runs")
    .select("status")
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle() as unknown as Promise<{
    data: { status: string } | null;
  }>);

  if (!run) return;

  // A PAID run is a record of money that left the business. Deleting it
  // releases every stamped hour and PTO row (FKs are SET NULL) back into
  // "unpaid", and the next prepare would pay them all a second time. The
  // contractor twin refuses this; so do we. Un-pay isn't offered — if a
  // run was marked paid by mistake, that's a support conversation, not a
  // delete button.
  if (run.status === "paid") return;

  // Draft runs can be deleted freely.
  // Finalized runs require the admin to type "DELETE" to confirm —
  // this is a sensitive financial record and we don't want accidents.
  if (run.status !== "draft" && confirmPhrase !== "DELETE") return;

  await (supabase
    .from("payroll_runs")
    .delete()
    .eq("id", id)
    .eq("organization_id", membership.organization_id) as unknown as Promise<unknown>);

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "payroll_run",
    entity_id: id,
    before: { status: run.status },
  });

  revalidatePath("/app/payroll", "page");
  redirect("/app/payroll");
}

/**
 * Settle a cleaner's outstanding tips.
 *
 * Records that the money has left the business and reached the person — it
 * does NOT move any money itself. The tip was collected on a card into the
 * org's own Stripe balance, so the actual handover happens however this
 * business already pays people: in the next payroll run, in cash, on the spot.
 * This is the acknowledgement of that, so the same $20 isn't paid twice or,
 * worse, forgotten.
 *
 * Claim-then-act on paid_out_at: the update only matches rows still NULL, so
 * two owners clicking at once settle the same tips exactly once between them.
 */
export async function markTipsPaidAction(formData: FormData): Promise<void> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  const raw = String(formData.get("membership_id") ?? "").trim();
  const admin = createSupabaseAdminClient();

  let q = admin
    .from("invoice_tips" as never)
    .update({ paid_out_at: new Date().toISOString() } as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .is("paid_out_at" as never, null as never);

  // Empty means the unattributed bucket — those rows have a NULL membership,
  // and `.eq(col, "")` would match nothing at all rather than matching them.
  q = raw
    ? q.eq("membership_id" as never, raw as never)
    : q.is("membership_id" as never, null as never);

  const { data: settled, error: settleErr } = (await q.select(
    "id, amount_cents",
  )) as unknown as {
    data: Array<{ id: string; amount_cents: number }> | null;
    error: { message: string } | null;
  };
  // A failed update and "a concurrent click already settled these" used to
  // look identical (both fell out as zero rows) — a persistent failure to
  // record the handover read as a UI glitch. Surface the failure.
  if (settleErr) {
    console.error("[payroll] markTipsPaid failed:", settleErr.message);
    return;
  }

  const rows = settled ?? [];
  if (rows.length === 0) return;

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: raw || membership.organization_id,
    after: {
      tips_marked_paid: rows.length,
      total_cents: rows.reduce((s, r) => s + r.amount_cents, 0),
      membership_id: raw || null,
    },
  });

  revalidatePath("/app/payroll", "page");
}

/**
 * Set the org's pay period calendar. Meeting deliverable #3, defined by
 * Brian as "1st to the 15th and 16th to end of month" — the Up next card
 * computes its suggested period from this instead of guessing from the
 * last run. Clearing back to manual is always allowed.
 */
export async function updatePayScheduleAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Only owners and admins can set the pay schedule." };
  }

  const raw = String(formData.get("pay_schedule") ?? "").trim();
  const anchorRaw = String(formData.get("pay_anchor") ?? "").trim();

  const schedule =
    raw === "" ? null : (raw as "semimonthly" | "biweekly" | "weekly" | "monthly");
  if (
    schedule !== null &&
    !["semimonthly", "biweekly", "weekly", "monthly"].includes(schedule)
  ) {
    return { ok: false, error: "Pick a schedule from the list." };
  }

  // Weekly/biweekly count exact cycles from a real period start.
  let anchor: string | null = null;
  if (schedule === "weekly" || schedule === "biweekly") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorRaw)) {
      return {
        ok: false,
        error: "Pick the date a pay period started — cycles are counted from it.",
      };
    }
    anchor = anchorRaw;
  }

  const { error } = await createSupabaseAdminClient()
    .from("organizations")
    .update({ pay_schedule: schedule, pay_anchor: anchor } as never)
    .eq("id", membership.organization_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app/payroll");
  return { ok: true };
}

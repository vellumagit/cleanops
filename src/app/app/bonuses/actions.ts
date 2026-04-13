"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";

type ComputeResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; error: string };

/**
 * Phase 7 — Bonus compute job.
 *
 * Reads the org's `bonus_rules` row, walks every active employee, and
 * calculates their average rating across the configured period. Any employee
 * who clears BOTH `min_avg_rating` AND `min_reviews_count` earns a pending
 * bonus row covering that period.
 *
 * The action is idempotent for a given period: if a pending bonus already
 * exists for the employee + period_start + period_end, it is skipped.
 *
 * In Phase 10 this is what cron will invoke. For now an admin runs it from
 * the bonuses page button.
 */
export async function computeBonusesAction(): Promise<ComputeResult> {
  const { membership, supabase } = await getActionContext();
  if (membership.role !== "owner" && membership.role !== "admin") {
    return { ok: false, error: "Only owners and admins can compute bonuses." };
  }

  const { data: rule, error: ruleErr } = await supabase
    .from("bonus_rules")
    .select("*")
    .eq("organization_id", membership.organization_id)
    .maybeSingle();

  if (ruleErr) return { ok: false, error: ruleErr.message };
  if (!rule) {
    return {
      ok: false,
      error: "No bonus rule configured. Set one in Settings → Bonus rules.",
    };
  }
  if (!rule.enabled) {
    return { ok: false, error: "The bonus engine is currently disabled." };
  }

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd);
  periodStart.setUTCDate(periodStart.getUTCDate() - rule.period_days);
  const periodStartIso = periodStart.toISOString();
  const periodStartDate = periodStartIso.slice(0, 10);
  const periodEndDate = periodEnd.toISOString().slice(0, 10);

  // Pull every review for this org in the window.
  // Explicit org filter as defense-in-depth — this computes financial data.
  const { data: reviews, error: reviewsErr } = await supabase
    .from("reviews")
    .select("employee_id, rating, submitted_at")
    .eq("organization_id", membership.organization_id)
    .gte("submitted_at", periodStartIso)
    .not("employee_id", "is", null);

  if (reviewsErr) return { ok: false, error: reviewsErr.message };

  type Bucket = { sum: number; count: number };
  const byEmployee = new Map<string, Bucket>();
  for (const r of reviews ?? []) {
    if (!r.employee_id) continue;
    const b = byEmployee.get(r.employee_id) ?? { sum: 0, count: 0 };
    b.sum += r.rating;
    b.count += 1;
    byEmployee.set(r.employee_id, b);
  }

  // Pre-fetch existing pending bonuses for this exact period to keep
  // re-runs idempotent.
  const { data: existing, error: existingErr } = await supabase
    .from("bonuses")
    .select("employee_id")
    .eq("organization_id", membership.organization_id)
    .eq("period_start", periodStartDate)
    .eq("period_end", periodEndDate);

  if (existingErr) return { ok: false, error: existingErr.message };
  const alreadyAwarded = new Set(
    (existing ?? []).map((b) => b.employee_id),
  );

  const toCreate: {
    organization_id: string;
    employee_id: string;
    period_start: string;
    period_end: string;
    amount_cents: number;
    reason: string;
  }[] = [];

  let skipped = 0;

  for (const [employeeId, bucket] of byEmployee.entries()) {
    if (bucket.count < rule.min_reviews_count) {
      skipped += 1;
      continue;
    }
    const avg = bucket.sum / bucket.count;
    if (avg < rule.min_avg_rating) {
      skipped += 1;
      continue;
    }
    if (alreadyAwarded.has(employeeId)) {
      skipped += 1;
      continue;
    }
    toCreate.push({
      organization_id: membership.organization_id,
      employee_id: employeeId,
      period_start: periodStartDate,
      period_end: periodEndDate,
      amount_cents: rule.amount_cents,
      reason: `Avg ${avg.toFixed(2)} across ${bucket.count} reviews (last ${rule.period_days}d)`,
    });
  }

  if (toCreate.length > 0) {
    const { error: insertErr } = await supabase
      .from("bonuses")
      .insert(toCreate);
    if (insertErr) return { ok: false, error: insertErr.message };
  }

  revalidatePath("/app/bonuses");
  revalidatePath("/app");
  return { ok: true, created: toCreate.length, skipped };
}

export async function markBonusPaidAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { membership, supabase } = await getActionContext();
  if (membership.role !== "owner" && membership.role !== "admin") {
    return { ok: false, error: "Only owners and admins can mark bonuses paid." };
  }

  const { error } = await supabase
    .from("bonuses")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", membership.organization_id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/app/bonuses");
  return { ok: true };
}

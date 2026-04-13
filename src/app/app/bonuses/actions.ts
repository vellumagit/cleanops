"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";

type ComputeResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// Review-based bonuses
// ─────────────────────────────────────────────────────────────────────────────

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
    return { ok: false, error: "The review bonus engine is currently disabled." };
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
    .not("employee_id", "is", null)
    .limit(5000);

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
    bonus_type: string;
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
      bonus_type: "review",
    });
  }

  if (toCreate.length > 0) {
    const { error: insertErr } = await supabase
      .from("bonuses")
      .insert(toCreate as never);
    if (insertErr) return { ok: false, error: insertErr.message };
  }

  revalidatePath("/app/bonuses");
  revalidatePath("/app");
  return { ok: true, created: toCreate.length, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Efficiency bonuses
// ─────────────────────────────────────────────────────────────────────────────

export async function computeEfficiencyBonusesAction(): Promise<ComputeResult> {
  const { membership, supabase } = await getActionContext();
  if (membership.role !== "owner" && membership.role !== "admin") {
    return { ok: false, error: "Only owners and admins can compute bonuses." };
  }

  const { data: rule, error: ruleErr } = await supabase
    .from("bonus_rules")
    .select("*")
    .eq("organization_id", membership.organization_id)
    .maybeSingle() as unknown as {
    data: {
      period_days: number;
      efficiency_enabled: boolean;
      efficiency_min_hours_saved: number;
      efficiency_min_jobs: number;
      efficiency_amount_cents: number;
    } | null;
    error: { message: string } | null;
  };

  if (ruleErr) return { ok: false, error: ruleErr.message };
  if (!rule) {
    return {
      ok: false,
      error: "No bonus rule configured. Set one in Settings → Bonus rules.",
    };
  }
  if (!rule.efficiency_enabled) {
    return { ok: false, error: "The efficiency bonus engine is currently disabled." };
  }

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd);
  periodStart.setUTCDate(periodStart.getUTCDate() - rule.period_days);
  const periodStartIso = periodStart.toISOString();
  const periodStartDate = periodStartIso.slice(0, 10);
  const periodEndDate = periodEnd.toISOString().slice(0, 10);

  // Get all completed bookings in the period with their time entries
  const { data: bookings, error: bookingsErr } = await supabase
    .from("bookings")
    .select("id, assigned_to, duration_minutes, scheduled_at")
    .eq("organization_id" as never, membership.organization_id as never)
    .eq("status", "completed")
    .gte("scheduled_at", periodStartIso)
    .not("assigned_to", "is", null)
    .limit(5000);

  if (bookingsErr) return { ok: false, error: bookingsErr.message };
  if (!bookings || bookings.length === 0) {
    return { ok: true, created: 0, skipped: 0 };
  }

  const bookingIds = bookings.map((b) => b.id);

  // Get all closed time entries for these bookings
  const { data: timeEntries, error: teErr } = await supabase
    .from("time_entries")
    .select("booking_id, employee_id, clock_in_at, clock_out_at")
    .eq("organization_id", membership.organization_id)
    .in("booking_id", bookingIds)
    .not("clock_out_at", "is", null)
    .limit(10000);

  if (teErr) return { ok: false, error: teErr.message };

  // Build a map: booking_id → { estimated_minutes, assigned_to }
  const bookingMap = new Map<
    string,
    { duration_minutes: number; assigned_to: string }
  >();
  for (const b of bookings) {
    if (b.assigned_to && b.duration_minutes) {
      bookingMap.set(b.id, {
        duration_minutes: b.duration_minutes,
        assigned_to: b.assigned_to,
      });
    }
  }

  // Calculate time saved per employee
  type EffBucket = { totalMinutesSaved: number; jobCount: number };
  const byEmployee = new Map<string, EffBucket>();

  for (const te of timeEntries ?? []) {
    if (!te.booking_id || !te.clock_in_at || !te.clock_out_at) continue;
    const booking = bookingMap.get(te.booking_id);
    if (!booking) continue;

    const actualMs =
      new Date(te.clock_out_at).getTime() -
      new Date(te.clock_in_at).getTime();
    const actualMinutes = actualMs / (1000 * 60);
    const estimatedMinutes = booking.duration_minutes;

    // Only count jobs where they finished faster (positive time saved)
    const minutesSaved = estimatedMinutes - actualMinutes;

    const bucket = byEmployee.get(te.employee_id) ?? {
      totalMinutesSaved: 0,
      jobCount: 0,
    };
    bucket.jobCount += 1;
    if (minutesSaved > 0) {
      bucket.totalMinutesSaved += minutesSaved;
    }
    byEmployee.set(te.employee_id, bucket);
  }

  // Check for existing efficiency bonuses in this period
  const { data: existing, error: existingErr } = await supabase
    .from("bonuses")
    .select("employee_id")
    .eq("organization_id", membership.organization_id)
    .eq("period_start", periodStartDate)
    .eq("period_end", periodEndDate)
    .eq("bonus_type" as never, "efficiency" as never);

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
    bonus_type: string;
  }[] = [];

  let skipped = 0;
  const minHoursSaved = Number(rule.efficiency_min_hours_saved);
  const minJobs = rule.efficiency_min_jobs;

  for (const [employeeId, bucket] of byEmployee.entries()) {
    const hoursSaved = bucket.totalMinutesSaved / 60;

    if (bucket.jobCount < minJobs) {
      skipped += 1;
      continue;
    }
    if (hoursSaved < minHoursSaved) {
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
      amount_cents: rule.efficiency_amount_cents,
      reason: `Saved ${hoursSaved.toFixed(1)}h across ${bucket.jobCount} jobs (last ${rule.period_days}d)`,
      bonus_type: "efficiency",
    });
  }

  if (toCreate.length > 0) {
    const { error: insertErr } = await supabase
      .from("bonuses")
      .insert(toCreate as never);
    if (insertErr) return { ok: false, error: insertErr.message };
  }

  revalidatePath("/app/bonuses");
  revalidatePath("/app");
  return { ok: true, created: toCreate.length, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mark paid
// ─────────────────────────────────────────────────────────────────────────────

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

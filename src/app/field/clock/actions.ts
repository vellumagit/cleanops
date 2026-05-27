"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";

export type ClockResult = { ok: true } | { ok: false; error: string };

function parseCoord(value: FormDataEntryValue | null): number | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (s.length === 0) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Generic clock-in (no booking attached). Use the Start Job button on a job
 * detail page when you want the entry tied to a specific booking.
 */
export async function clockInAction(
  formData: FormData,
): Promise<ClockResult> {
  const lat = parseCoord(formData.get("lat"));
  const lng = parseCoord(formData.get("lng"));

  const { membership, supabase } = await getActionContext();

  // Best-effort precheck — gives a clean error message in the common case
  // where the user is already clocked in. The DB unique index is the
  // authoritative guard against concurrent double-clock-in (see migration
  // 20260527010000_time_entries_one_open.sql).
  const { data: existing } = await supabase
    .from("time_entries")
    .select("id")
    .eq("employee_id", membership.id)
    .is("clock_out_at", null)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { ok: false, error: "You're already clocked in." };
  }

  const { error } = await supabase.from("time_entries").insert({
    organization_id: membership.organization_id,
    employee_id: membership.id,
    booking_id: null,
    clock_in_at: new Date().toISOString(),
    clock_in_lat: lat,
    clock_in_lng: lng,
  });
  if (error) {
    // Postgres unique_violation — partial index rejected a concurrent
    // double clock-in. Treat as "you're already clocked in" instead of
    // a raw error string.
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return { ok: false, error: "You're already clocked in." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/field/clock");
  return { ok: true };
}

export async function clockOutAction(
  formData: FormData,
): Promise<ClockResult> {
  const lat = parseCoord(formData.get("lat"));
  const lng = parseCoord(formData.get("lng"));

  const { membership, supabase } = await getActionContext();

  const { data: open, error: fetchError } = await supabase
    .from("time_entries")
    .select("id")
    .eq("employee_id", membership.id)
    .is("clock_out_at", null)
    .order("clock_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!open) return { ok: false, error: "You're not clocked in." };

  const { error: updateError } = await supabase
    .from("time_entries")
    .update({
      clock_out_at: new Date().toISOString(),
      clock_out_lat: lat,
      clock_out_lng: lng,
    })
    .eq("id", open.id);
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/field/clock");
  revalidatePath("/field/jobs");
  return { ok: true };
}

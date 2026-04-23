"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";

type Result = { ok: true } | { ok: false; error: string };

const TIME_PATTERN = /^[0-2]\d:[0-5]\d$/;

function validTime(s: string): boolean {
  if (!TIME_PATTERN.test(s)) return false;
  const [h, m] = s.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/**
 * Replace an employee's recurring weekly availability with the submitted
 * set. Sending the form always posts the full state, so we wipe + insert
 * for simplicity — availability rows per member are tiny.
 *
 * Form payload:
 *   membership_id (optional — owner/admin/manager setting someone else's)
 *   slots — repeated groups encoded as "{day}|{start}|{end}"
 */
export async function saveAvailabilitySlotsAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();

  // Who are we editing? Default to self; managers may target another
  // active member in the same org.
  const target = String(formData.get("membership_id") ?? "").trim();
  const membershipId =
    target && target !== membership.id
      ? target
      : membership.id;

  if (
    membershipId !== membership.id &&
    !["owner", "admin", "manager"].includes(membership.role)
  ) {
    return {
      ok: false,
      error: "Only managers can set someone else's availability.",
    };
  }

  const encoded = formData.getAll("slots").map((v) => String(v));
  const rows: Array<{
    organization_id: string;
    membership_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
  }> = [];
  for (const raw of encoded) {
    const [dayRaw, start, end] = raw.split("|");
    const day = Number(dayRaw);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    if (!validTime(start) || !validTime(end)) continue;
    if (start >= end) continue; // string-compare works for HH:MM
    rows.push({
      organization_id: membership.organization_id,
      membership_id: membershipId,
      day_of_week: day,
      start_time: start,
      end_time: end,
    });
  }

  const { error: delErr } = await (supabase
    .from("availability_slots" as never)
    .delete()
    .eq("membership_id" as never, membershipId as never) as unknown as Promise<{
    error: { message: string } | null;
  }>);
  if (delErr) return { ok: false, error: delErr.message };

  if (rows.length > 0) {
    const { error: insErr } = await (supabase
      .from("availability_slots" as never)
      .insert(rows as never) as unknown as Promise<{
      error: { message: string } | null;
    }>);
    if (insErr) return { ok: false, error: insErr.message };
  }

  revalidatePath("/field/availability", "page");
  revalidatePath("/app/scheduling", "page");
  return { ok: true };
}

/**
 * Add or update a one-off date override (a day off, or different hours
 * for a specific date). Upserts by (membership_id, date).
 */
export async function saveAvailabilityOverrideAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();

  const target = String(formData.get("membership_id") ?? "").trim();
  const membershipId =
    target && target !== membership.id ? target : membership.id;
  if (
    membershipId !== membership.id &&
    !["owner", "admin", "manager"].includes(membership.role)
  ) {
    return {
      ok: false,
      error: "Only managers can override someone else's availability.",
    };
  }

  const date = String(formData.get("date") ?? "").trim();
  const kind = String(formData.get("kind") ?? "off").trim();
  const start = String(formData.get("start_time") ?? "").trim();
  const end = String(formData.get("end_time") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Pick a valid date." };
  }
  if (kind !== "off" && kind !== "custom") {
    return { ok: false, error: "Invalid override kind." };
  }
  if (kind === "custom") {
    if (!validTime(start) || !validTime(end) || start >= end) {
      return {
        ok: false,
        error: "Enter valid start/end times for a custom override.",
      };
    }
  }

  // Upsert via delete-then-insert. UNIQUE(membership_id, date) keeps only
  // one row per date anyway.
  await (supabase
    .from("availability_overrides" as never)
    .delete()
    .eq("membership_id" as never, membershipId as never)
    .eq("date" as never, date as never) as unknown as Promise<unknown>);

  const { error } = await (supabase
    .from("availability_overrides" as never)
    .insert({
      organization_id: membership.organization_id,
      membership_id: membershipId,
      date,
      kind,
      start_time: kind === "custom" ? start : null,
      end_time: kind === "custom" ? end : null,
      reason: reason || null,
    } as never) as unknown as Promise<{
    error: { message: string } | null;
  }>);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/field/availability", "page");
  revalidatePath("/app/scheduling", "page");
  return { ok: true };
}

/**
 * Remove a one-off override (restoring the recurring weekly default for
 * that date).
 */
export async function deleteAvailabilityOverrideAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing override id." };

  // RLS gates the delete to the owner of the row (self) or a manager.
  const { error } = await (supabase
    .from("availability_overrides" as never)
    .delete()
    .eq("id" as never, id as never) as unknown as Promise<{
    error: { message: string } | null;
  }>);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/field/availability", "page");
  revalidatePath("/app/scheduling", "page");
  return { ok: true };
}

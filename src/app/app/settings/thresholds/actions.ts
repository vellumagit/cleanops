"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ThresholdsState = {
  ok?: boolean;
  error?: string;
};

/**
 * Parse a form field that represents "integer-or-blank-means-null".
 * Returns:
 *   - number when the input is a valid int >= min
 *   - null when the input is blank (field disabled for this org)
 *   - undefined when the input is present but invalid (caller should bail)
 */
function parseNullableInt(
  raw: FormDataEntryValue | null,
  min: number,
): number | null | undefined {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) return undefined;
  return n;
}

function parseRequiredInt(
  raw: FormDataEntryValue | null,
  min: number,
): number | undefined {
  const s = String(raw ?? "").trim();
  if (s === "") return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) return undefined;
  return n;
}

export async function updateThresholdsAction(
  _prev: ThresholdsState,
  formData: FormData,
): Promise<ThresholdsState> {
  const membership = await requireMembership(["owner", "admin"]);

  const staleDays = parseNullableInt(formData.get("stale_estimate_expire_days"), 1);
  const voidDays = parseNullableInt(formData.get("invoice_void_days"), 30);
  const completeHours = parseNullableInt(
    formData.get("booking_auto_complete_hours"),
    1,
  );
  const archiveDays = parseNullableInt(formData.get("archive_after_days"), 180);
  const overtimeHours = parseRequiredInt(
    formData.get("overtime_threshold_hours"),
    1,
  );

  if (
    staleDays === undefined ||
    voidDays === undefined ||
    completeHours === undefined ||
    archiveDays === undefined ||
    overtimeHours === undefined
  ) {
    return {
      error:
        "One of the thresholds is invalid. Each must be a positive whole number, or blank to disable (except Overtime which requires a value).",
    };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      stale_estimate_expire_days: staleDays,
      invoice_void_days: voidDays,
      booking_auto_complete_hours: completeHours,
      archive_after_days: archiveDays,
      overtime_threshold_hours: overtimeHours,
    } as never)
    .eq("id", membership.organization_id);

  if (error) return { error: error.message };

  revalidatePath("/app/settings/thresholds");
  return { ok: true };
}

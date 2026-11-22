"use server";

import { revalidatePath } from "next/cache";
import { requireActionMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { THRESHOLD_FIELDS, type ThresholdField } from "./threshold-fields";

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

/**
 * One timing setting at a time. The thresholds used to share a page of their
 * own, filed under Team, far from the switches they time — so they now sit
 * beside their automation (Brian, 2026-11-21: settings "scattered all over
 * seemingly randomly"), each with its own small save. Same rules as the old
 * all-in-one form: whole numbers, a floor per field, blank means "never" for
 * the four that allow it (the crons read null as off), overtime required.
 */
export async function updateThresholdAction(
  _prev: ThresholdsState,
  formData: FormData,
): Promise<ThresholdsState> {
  const membership = await requireActionMembership(["owner", "admin"]);
  const raw = String(formData.get("field") ?? "");
  // The column name arrives from the form, so it must be one of the table's
  // OWN keys — "toString" or "__proto__" resolve on any object.
  if (!Object.hasOwn(THRESHOLD_FIELDS, raw)) return { error: "Unknown setting." };
  const field = raw as ThresholdField;
  const rule = THRESHOLD_FIELDS[field];

  const value = rule.nullable
    ? parseNullableInt(formData.get("value"), rule.min)
    : parseRequiredInt(formData.get("value"), rule.min);
  if (value === undefined) {
    return {
      error: rule.nullable
        ? `Enter a whole number of at least ${rule.min}, or leave it blank for never.`
        : `Enter a whole number of at least ${rule.min}.`,
    };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ [field]: value } as never)
    .eq("id", membership.organization_id);
  if (error) return { error: error.message };

  revalidatePath("/app/settings", "layout");
  return { ok: true };
}

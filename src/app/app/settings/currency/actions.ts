"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type CurrencyFormState = {
  errors?: Partial<Record<"currency_code" | "_form", string>>;
  success?: boolean;
};

export type TaxDefaultsFormState = {
  errors?: Partial<Record<"tax_rate" | "tax_label" | "_form", string>>;
  success?: boolean;
};

export async function saveCurrencyAction(
  _prev: CurrencyFormState,
  formData: FormData,
): Promise<CurrencyFormState> {
  const { membership } = await getActionContext();

  if (!["owner", "admin"].includes(membership.role)) {
    return { errors: { _form: "You don't have permission to change the currency." } };
  }

  const code = String(formData.get("currency_code") ?? "").trim().toUpperCase();
  if (code !== "CAD" && code !== "USD") {
    return { errors: { currency_code: "Pick CAD or USD." } };
  }

  const admin = createSupabaseAdminClient();

  // Read the before value for the audit trail
  const { data: before } = await admin
    .from("organizations")
    .select("currency_code")
    .eq("id", membership.organization_id)
    .maybeSingle();
  const beforeCode =
    (before as { currency_code?: string } | null)?.currency_code ?? null;

  const { error } = await admin
    .from("organizations")
    .update({ currency_code: code } as never)
    .eq("id", membership.organization_id);

  if (error) {
    return { errors: { _form: error.message } };
  }

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: membership.organization_id,
    before: { currency_code: beforeCode },
    after: { currency_code: code },
  });

  revalidatePath("/app/settings/currency");
  revalidatePath("/app/settings");
  return { success: true };
}

/**
 * Save the org's default tax rate + label. Pre-fills new invoices so
 * the owner doesn't retype "GST 5%" on every invoice. An invoice that's
 * already been created uses whatever was saved on it — changing the
 * default here does NOT rewrite historical invoices.
 *
 * Accepts:
 *   - tax_rate   — percentage string ("", "0", "5", "12.5"). Empty or
 *                  "0" clears the default.
 *   - tax_label  — label string ("GST", "HST", etc.). Ignored when
 *                  rate is empty/0.
 */
export async function saveTaxDefaultsAction(
  _prev: TaxDefaultsFormState,
  formData: FormData,
): Promise<TaxDefaultsFormState> {
  const { membership } = await getActionContext();

  if (!["owner", "admin"].includes(membership.role)) {
    return { errors: { _form: "You don't have permission." } };
  }

  const rawRate = String(formData.get("tax_rate") ?? "").trim();
  const rawLabel = String(formData.get("tax_label") ?? "").trim();

  let rateBps: number | null = null;
  if (rawRate) {
    const n = Number(rawRate);
    if (!Number.isFinite(n) || n < 0) {
      return { errors: { tax_rate: "Enter a number 0–99.99." } };
    }
    const bps = Math.round(n * 100);
    if (bps > 9999) {
      return { errors: { tax_rate: "Rate can't exceed 99.99%." } };
    }
    rateBps = bps > 0 ? bps : null;
  }

  // When rate is unset/0, clear the label too — keeps the two in sync.
  const label = rateBps ? rawLabel || null : null;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      default_tax_rate_bps: rateBps,
      default_tax_label: label,
    } as never)
    .eq("id", membership.organization_id);

  if (error) return { errors: { _form: error.message } };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: membership.organization_id,
    after: { default_tax_rate_bps: rateBps, default_tax_label: label },
  });

  revalidatePath("/app/settings/currency");
  return { success: true };
}

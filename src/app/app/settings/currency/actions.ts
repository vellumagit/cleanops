"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type CurrencyFormState = {
  errors?: Partial<Record<"currency_code" | "_form", string>>;
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

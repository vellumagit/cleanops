"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type InvoicingFormState = {
  errors?: Partial<Record<"_form" | "delay", string>>;
  success?: boolean;
};

const ALLOWED_DELAYS = new Set([0, 12, 24, 48, 72]);

export async function saveInvoiceAutoSendAction(
  _prev: InvoicingFormState,
  formData: FormData,
): Promise<InvoicingFormState> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { errors: { _form: "You don't have permission." } };
  }

  const enabled = formData.get("enabled") === "on";
  const consolidated = formData.get("consolidated") === "on";
  const delayHours = Number(formData.get("delay_hours") ?? 24);

  if (!Number.isInteger(delayHours) || !ALLOWED_DELAYS.has(delayHours)) {
    return { errors: { delay: "Choose one of the listed delays." } };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      invoice_auto_send_enabled: enabled,
      invoice_auto_send_delay_hours: delayHours,
      invoice_auto_send_consolidated: consolidated,
    } as never)
    .eq("id", membership.organization_id);
  if (error) return { errors: { _form: error.message } };

  // Turning auto-send OFF must also stand down invoices already queued to send
  // — otherwise a draft scheduled before the change would still fire. Move them
  // to 'held' (the owner can still send manually).
  if (!enabled) {
    await (admin
      .from("invoices")
      .update({ auto_send_state: "held", auto_send_at: null } as never)
      .eq("organization_id", membership.organization_id)
      .eq("auto_send_state" as never, "scheduled" as never) as unknown as Promise<unknown>);
  }

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: membership.organization_id,
    after: {
      invoice_auto_send_enabled: enabled,
      invoice_auto_send_delay_hours: delayHours,
      invoice_auto_send_consolidated: consolidated,
    },
  });

  revalidatePath("/app/settings/invoicing");
  return { success: true };
}

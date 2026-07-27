"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type InvoicingFormState = {
  errors?: Partial<Record<"_form" | "hour", string>>;
  success?: boolean;
};

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
  const sendHour = Number(formData.get("send_hour") ?? 17);

  if (!Number.isInteger(sendHour) || sendHour < 0 || sendHour > 23) {
    return { errors: { hour: "Pick a time of day." } };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      invoice_auto_send_enabled: enabled,
      invoice_auto_send_hour: sendHour,
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
  } else {
    // Turning it back ON re-arms previously-held DRAFTS — they were only held
    // because the org disabled auto-send, and before this they stayed held
    // forever (audit P8). Rescheduled to the next send slot (tomorrow at the
    // configured hour) so the owner gets the same review window — and the
    // same morning digest heads-up — as any fresh draft.
    const { computeAutoSendAt } = await import("@/lib/invoice-send");
    const { data: orgRow } = (await admin
      .from("organizations")
      .select("timezone")
      .eq("id", membership.organization_id)
      .maybeSingle()) as unknown as { data: { timezone: string | null } | null };
    const sendAt = computeAutoSendAt(
      new Date(),
      orgRow?.timezone ?? null,
      sendHour,
    ).toISOString();
    await (admin
      .from("invoices")
      .update({ auto_send_state: "scheduled", auto_send_at: sendAt } as never)
      .eq("organization_id", membership.organization_id)
      .eq("auto_send_state" as never, "held" as never)
      .eq("status", "draft") as unknown as Promise<unknown>);
  }

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: membership.organization_id,
    after: {
      invoice_auto_send_enabled: enabled,
      invoice_auto_send_hour: sendHour,
      invoice_auto_send_consolidated: consolidated,
    },
  });

  revalidatePath("/app/settings/invoicing");
  return { success: true };
}

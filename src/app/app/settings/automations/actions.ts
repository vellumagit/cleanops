"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type AutomationKey =
  | "auto_invoice_on_job_complete"
  | "booking_confirmation_email"
  | "booking_rescheduled_email"
  | "invoice_paid_receipt"
  | "invoice_overdue_reminder"
  | "review_submitted_notify"
  | "booking_assignment_notify";

export async function toggleAutomationAction(formData: FormData) {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  const key = String(formData.get("key") ?? "") as AutomationKey;
  const enabled = formData.get("enabled") === "true";

  const admin = createSupabaseAdminClient();

  // Fetch current settings
  const { data: org } = (await admin
    .from("organizations")
    .select("automation_settings")
    .eq("id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: { automation_settings: Record<string, { enabled: boolean }> } | null;
  };

  const current = org?.automation_settings ?? {};
  const updated = { ...current, [key]: { enabled } };

  await admin
    .from("organizations")
    .update({ automation_settings: updated } as never)
    .eq("id", membership.organization_id);

  revalidatePath("/app/settings/automations", "page");
}

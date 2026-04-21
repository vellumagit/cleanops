"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type AutomationKey =
  | "auto_invoice_on_job_complete"
  | "booking_confirmation_email"
  | "booking_rescheduled_email"
  | "booking_reminder_client_email"
  | "estimate_sent_email"
  | "invoice_paid_receipt"
  | "invoice_overdue_reminder"
  | "review_submitted_notify"
  | "booking_assignment_notify"
  | "unassigned_booking_alert"
  | "low_review_alert"
  | "stripe_payout_alert"
  | "weekly_ops_digest"
  | "monthly_ops_digest"
  | "employee_daily_schedule"
  | "employee_weekly_schedule"
  | "overtime_warning"
  | "pto_status_notify"
  | "payroll_paid_receipt"
  | "training_assigned_notify"
  | "certification_expiry_reminder"
  | "auto_expire_stale_estimates"
  | "auto_void_overdue_invoices"
  | "auto_complete_past_bookings"
  | "auto_archive_old_records"
  | "auto_recurring_invoices";

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

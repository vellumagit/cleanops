"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
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
  | "auto_recurring_invoices"
  | "booking_cancelled_email"
  | "rebooking_prompt_email"
  | "estimate_followup_email"
  // Review requests — default ON (revenue-positive; owners opt out not in)
  | "review_request_after_completion"
  // Google review ask (separate track from internal review). Default ON.
  // Fires 24h after a client's FIRST completed booking, then monthly
  // reminders while the client's gbp_review_state is "pending", capped
  // by organizations.gbp_review_max_reminders.
  | "gbp_review_request"
  // SMS automations (Twilio) — all default OFF; requires TWILIO_ENABLED=true
  // and A2P 10DLC registration before messages actually send. When
  // TWILIO_ENABLED is false the code path is exercised but messages are
  // only logged (skipped_disabled), so enabling these toggles is safe to
  // do before Twilio is live.
  | "booking_confirmation_sms"
  | "booking_reminder_client_sms"
  | "booking_assignment_sms"
  | "booking_rescheduled_sms"
  | "booking_cancelled_sms"
  // Feed
  | "system_feed_events"
  // Feed FEATURE visibility — when off (default), the /app/feed and
  // /field/feed routes 404 and the sidebar links are hidden. system_
  // feed_events only matters when this is on.
  | "feed_visible"
  // Scheduling: when ON, every team job (2+ cleaners working together)
  // automatically shows each cleaner their share of the hours (duration ÷
  // crew) in the field app — no per-booking checkbox needed. Default OFF.
  | "divide_crew_hours"
  | "product_changelog_email";

/**
 * Runtime allowlist derived from the AutomationKey union. Keeps the type
 * and the validation in lockstep — add a key to the type above and it
 * automatically becomes valid here. A form submission with an unknown key
 * is silently dropped rather than writing an orphaned entry into the JSON
 * blob that would silently shadow any future key with the same name.
 */
const VALID_AUTOMATION_KEYS = new Set<AutomationKey>([
  "auto_invoice_on_job_complete",
  "booking_confirmation_email",
  "booking_rescheduled_email",
  "booking_reminder_client_email",
  "estimate_sent_email",
  "invoice_paid_receipt",
  "invoice_overdue_reminder",
  "review_submitted_notify",
  "booking_assignment_notify",
  "unassigned_booking_alert",
  "low_review_alert",
  "stripe_payout_alert",
  "weekly_ops_digest",
  "monthly_ops_digest",
  "employee_daily_schedule",
  "employee_weekly_schedule",
  "overtime_warning",
  "pto_status_notify",
  "payroll_paid_receipt",
  "training_assigned_notify",
  "certification_expiry_reminder",
  "auto_expire_stale_estimates",
  "auto_void_overdue_invoices",
  "auto_complete_past_bookings",
  "auto_archive_old_records",
  "auto_recurring_invoices",
  "booking_cancelled_email",
  "rebooking_prompt_email",
  "estimate_followup_email",
  "review_request_after_completion",
  "gbp_review_request",
  "booking_confirmation_sms",
  "booking_reminder_client_sms",
  "booking_assignment_sms",
  "booking_rescheduled_sms",
  "booking_cancelled_sms",
  "system_feed_events",
  "feed_visible",
  "divide_crew_hours",
  "product_changelog_email",
]);

/**
 * One-click starting bundles. Each preset writes `enabled: true` for its keys
 * (merging over whatever's already set — it never turns anything OFF) and
 * flips the master switch on. Opt-in is preserved: the owner clicked the
 * bundle, that's the opt-in.
 *
 * Key sets live SERVER-SIDE so a crafted POST can't enable arbitrary keys —
 * the form only submits a preset name.
 */
const PRESET_ESSENTIALS: AutomationKey[] = [
  "booking_confirmation_email",
  "booking_rescheduled_email",
  "booking_cancelled_email",
  "booking_reminder_client_email",
  "booking_assignment_notify",
  "auto_invoice_on_job_complete",
  "invoice_overdue_reminder",
  "invoice_paid_receipt",
];

const PRESET_FULL_SERVICE: AutomationKey[] = [
  ...PRESET_ESSENTIALS,
  "estimate_sent_email",
  "estimate_followup_email",
  "review_request_after_completion",
  "gbp_review_request",
  "rebooking_prompt_email",
  "weekly_ops_digest",
  "monthly_ops_digest",
  "employee_daily_schedule",
  "employee_weekly_schedule",
  "auto_complete_past_bookings",
  "unassigned_booking_alert",
];

/**
 * The "Team & back office" stage bundle. Deliberately EXCLUDES
 * auto_void_overdue_invoices (changes money state — deserves its own decision)
 * and the pure feature preferences (feed, crew-hours divide, product updates).
 */
const PRESET_TEAM_OFFICE: AutomationKey[] = [
  "booking_assignment_notify",
  "employee_daily_schedule",
  "employee_weekly_schedule",
  "overtime_warning",
  "pto_status_notify",
  "payroll_paid_receipt",
  "training_assigned_notify",
  "certification_expiry_reminder",
  "review_submitted_notify",
  "low_review_alert",
  "stripe_payout_alert",
  "weekly_ops_digest",
  "monthly_ops_digest",
  "auto_expire_stale_estimates",
  "auto_archive_old_records",
  "auto_recurring_invoices",
  "auto_complete_past_bookings",
];

const PRESETS: Record<string, AutomationKey[]> = {
  essentials: PRESET_ESSENTIALS,
  full_service: PRESET_FULL_SERVICE,
  team_office: PRESET_TEAM_OFFICE,
  // "custom" = enable the master switch only; the owner picks below.
  custom: [],
};

export async function applyAutomationPresetAction(formData: FormData) {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  const presetName = String(formData.get("preset") ?? "");
  const keys = PRESETS[presetName];
  if (!keys) {
    console.warn(`[automations] unknown preset rejected: "${presetName}"`);
    return;
  }

  const admin = createSupabaseAdminClient();
  const { data: org } = (await admin
    .from("organizations")
    .select("automation_settings")
    .eq("id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: { automation_settings: Record<string, { enabled: boolean }> } | null;
  };

  const merged = { ...(org?.automation_settings ?? {}) };
  for (const key of keys) merged[key] = { enabled: true };

  await admin
    .from("organizations")
    .update({
      automation_settings: merged,
      automations_enabled: true,
    } as never)
    .eq("id", membership.organization_id);

  revalidatePath("/app/settings/automations", "page");
  revalidatePath("/app", "layout");
}

/**
 * Master switch. When off, NO automation fires for the org regardless of the
 * per-key toggles — the single "stop everything" control. New orgs start off.
 */
export async function toggleAutomationsMasterAction(formData: FormData) {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  const enabled = formData.get("enabled") === "true";

  const admin = createSupabaseAdminClient();
  await admin
    .from("organizations")
    .update({ automations_enabled: enabled } as never)
    .eq("id", membership.organization_id);

  revalidatePath("/app/settings/automations", "page");
  revalidatePath("/app", "layout");
}

/**
 * Set the org's house default for automated client messages. Clients on
 * contact_preference='inherit' (the default) follow this; per-client settings
 * override it. Setting this to 'none' is the "silence everyone, then switch on
 * the few I want" flow.
 */
export async function setOrgContactDefaultAction(formData: FormData) {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  const value = String(formData.get("default_contact_preference") ?? "");
  if (!["email", "sms", "both", "none"].includes(value)) {
    console.warn(`[automations] invalid contact default rejected: "${value}"`);
    return;
  }

  const admin = createSupabaseAdminClient();
  await admin
    .from("organizations")
    .update({ default_contact_preference: value } as never)
    .eq("id", membership.organization_id);

  revalidatePath("/app/settings/automations", "page");
}

export async function toggleAutomationAction(formData: FormData) {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  const rawKey = String(formData.get("key") ?? "");
  if (!VALID_AUTOMATION_KEYS.has(rawKey as AutomationKey)) {
    console.warn(`[automations] unknown key rejected: "${rawKey}"`);
    return;
  }
  const key = rawKey as AutomationKey;
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

  // Flipping "divide crew hours" changes the length of every existing team
  // booking's calendar events — reshape them now (both directions) so existing
  // jobs aren't left stale. Background via after() so the toggle responds fast.
  if (key === "divide_crew_hours") {
    const orgId = membership.organization_id;
    after(async () => {
      try {
        const { resyncCrewDivisionForOrg } = await import(
          "@/lib/google-calendar"
        );
        await resyncCrewDivisionForOrg(orgId);
      } catch (err) {
        console.error("[automations] divide_crew_hours resync failed:", err);
      }
    });
  }

  revalidatePath("/app/settings/automations", "page");
}

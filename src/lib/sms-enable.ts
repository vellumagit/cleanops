import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ensureSmsOverageItem } from "@/lib/stripe";

/**
 * Switch an org's texting on once it has a number: attach the metered
 * overage item (best-effort; comped and Stripe-less orgs get none), turn on
 * the SMS automations, and flip the master switch.
 *
 * Shared by the Settings button (Canada: the number is bought on the spot)
 * and US registration approval (the number is bought when the carriers
 * approve, possibly days later, by the cron).
 *
 * The automations default OFF, so flipping only the master switch would
 * send nothing — the classic "I enabled SMS but no texts go out" trap.
 * Merged into the existing settings; the owner can still turn individual
 * ones back off.
 */
export async function turnOnOrgSms(orgId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureSmsOverageItem(orgId);
  } catch (err) {
    console.error("[sms-enable] ensureSmsOverageItem failed:", err);
  }

  const admin = createSupabaseAdminClient();
  const { data: settingsRow } = (await admin
    .from("organizations")
    .select("automation_settings")
    .eq("id", orgId)
    .maybeSingle()) as unknown as {
    data: { automation_settings: Record<string, unknown> | null } | null;
  };
  const automation_settings: Record<string, unknown> = {
    ...(settingsRow?.automation_settings ?? {}),
  };
  for (const key of [
    "booking_confirmation_sms",
    "booking_reminder_client_sms",
    "booking_assignment_sms",
  ]) {
    automation_settings[key] = {
      ...(automation_settings[key] as Record<string, unknown> | undefined),
      enabled: true,
    };
  }

  const { error } = await admin
    .from("organizations")
    .update({ sms_enabled: true, automation_settings } as never)
    .eq("id", orgId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

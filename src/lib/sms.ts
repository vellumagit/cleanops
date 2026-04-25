/**
 * Org-aware SMS layer — mirrors the structure of lib/email.ts.
 *
 * Sits on top of lib/twilio.ts (raw send + composers) and adds:
 *   - Platform-level kill switch (CLIENT_SMS_PAUSED)
 *   - Per-org automation-toggle gate (resolveAutomationEnabled)
 *   - Org context helper for body composition (org name + contact phone)
 *
 * The underlying lib/twilio.ts sendSms() itself handles the
 * TWILIO_ENABLED flag — when it's false, messages are logged and
 * returned as { ok: true, status: "skipped_disabled" } so the full
 * code path exercises in dev without spending money.
 *
 * Usage pattern:
 *   const ctx = await getOrgSmsContext(orgId);
 *   const body = composeBookingReminderSms({ orgName: ctx.orgName, ... });
 *   await sendOrgSms(orgId, { to: client.phone, body, automationKey: "booking_reminder_client_sms" });
 */

import "server-only";
import { sendSms, type SmsSendResult } from "@/lib/twilio";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAutomationEnabled } from "@/lib/automation-defaults";

// ---------------------------------------------------------------------------
// Platform kill switch
// ---------------------------------------------------------------------------

/**
 * Platform-wide pause for client-facing outbound SMS. Set
 * CLIENT_SMS_PAUSED=true in Vercel env to stop all org→client texts
 * across every org without touching per-org automation toggles.
 *
 * Employee-facing SMS (booking assignment, upcoming-jobs) is NOT
 * gated by this — operational messages to field crew bypass it. Use
 * TWILIO_ENABLED=false to kill ALL outbound SMS including employee
 * messages.
 *
 * Mirror of CLIENT_EMAILS_PAUSED in lib/email.ts.
 */
export function isClientSmsPaused(): boolean {
  return process.env.CLIENT_SMS_PAUSED === "true";
}

// ---------------------------------------------------------------------------
// Org context
// ---------------------------------------------------------------------------

export type OrgSmsContext = {
  /** Display name of the org — prepended to every SMS body. */
  orgName: string;
  /** Org's public contact phone shown to clients (e.g. "Questions? 555-1234"). */
  contactPhone: string | null;
};

/**
 * Fetch the minimal org info needed to compose an outbound SMS body.
 *
 * Callers that already have these values from a previous DB fetch (e.g.
 * a loop with a warmed org cache) can skip this and build OrgSmsContext
 * inline — this is just a convenience loader for single-booking paths.
 */
export async function getOrgSmsContext(
  orgId: string,
): Promise<OrgSmsContext> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("name, contact_phone")
    .eq("id", orgId)
    .maybeSingle();

  const org = data as {
    name: string;
    contact_phone: string | null;
  } | null;

  return {
    orgName: org?.name ?? "Sollos",
    contactPhone: org?.contact_phone ?? null,
  };
}

// ---------------------------------------------------------------------------
// Org-aware send
// ---------------------------------------------------------------------------

/**
 * Send an SMS on behalf of an org, passing through three gates:
 *
 *   1. CLIENT_SMS_PAUSED platform kill switch
 *   2. Per-org automation toggle for `automationKey`
 *      (via organizations.automation_settings + resolveAutomationEnabled)
 *   3. TWILIO_ENABLED feature flag (handled inside sendSms() in twilio.ts)
 *
 * Returns { ok: true, status: "skipped_disabled" } when any gate
 * blocks the send — never throws. The result mirrors SmsSendResult so
 * callers can log or surface the reason if needed.
 *
 * Fire-and-forget safe: wrap in `.catch()` or `void` at the call site.
 */
export async function sendOrgSms(
  orgId: string,
  args: {
    to: string;
    body: string;
    /**
     * Automation key that must be enabled for this org, e.g.
     * "booking_confirmation_sms" or "booking_reminder_client_sms".
     * Checked against organizations.automation_settings with
     * resolveAutomationEnabled (explicit setting wins, then default).
     */
    automationKey: string;
  },
): Promise<SmsSendResult> {
  // Gate 1: platform kill switch
  if (isClientSmsPaused()) {
    console.log(
      `[sms] platform paused (CLIENT_SMS_PAUSED) — skipping ${args.automationKey} for org ${orgId}`,
    );
    return { ok: true, sid: null, status: "skipped_disabled" };
  }

  // Gate 2: per-org automation toggle
  try {
    const admin = createSupabaseAdminClient();
    const { data: org } = (await admin
      .from("organizations")
      .select("automation_settings")
      .eq("id", orgId)
      .maybeSingle()) as unknown as {
      data: {
        automation_settings: Record<
          string,
          { enabled?: boolean } | undefined
        > | null;
      } | null;
    };

    const settings = org?.automation_settings ?? {};
    if (!resolveAutomationEnabled(settings, args.automationKey)) {
      // Automation is off — silent skip, not an error.
      return { ok: true, sid: null, status: "skipped_disabled" };
    }
  } catch (settingsErr) {
    // Transient DB error reading settings. Fail open: don't drop
    // messages because of a settings read hiccup. sendSms still
    // respects TWILIO_ENABLED.
    console.error("[sms] settings read failed, proceeding:", settingsErr);
  }

  // Gate 3: TWILIO_ENABLED is checked inside sendSms()
  return sendSms(args.to, args.body);
}

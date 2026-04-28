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

  if (!org) {
    console.warn(`[sms] getOrgSmsContext: org ${orgId} not found — SMS context unavailable`);
    // Return an empty orgName so callers don't accidentally prepend
    // the platform brand ("Sollos") to a client-facing message.
    return { orgName: "", contactPhone: null };
  }

  return {
    orgName: org.name,
    contactPhone: org.contact_phone ?? null,
  };
}

// ---------------------------------------------------------------------------
// Org-aware send
// ---------------------------------------------------------------------------

/**
 * Automation keys that send SMS to clients (not employees).
 *
 * These are gated by `clients.sms_opted_in` (TCPA/CASL compliance).
 * Employee-facing keys (booking_assignment_sms) skip the opt-in check
 * because the employee relationship is B2B, not B2C.
 */
const CLIENT_FACING_SMS_KEYS = new Set([
  "booking_confirmation_sms",
  "booking_reminder_client_sms",
]);

/**
 * Send an SMS on behalf of an org, passing through four gates:
 *
 *   1. CLIENT_SMS_PAUSED platform kill switch
 *   2. Per-org automation toggle for `automationKey`
 *      (via organizations.automation_settings + resolveAutomationEnabled)
 *   3. SMS opt-in check (client-facing automations only — TCPA/CASL).
 *      Looks up the recipient by phone number within the org's clients
 *      table. Skips the send if the client hasn't opted in OR if no
 *      matching client is found (fail-safe for compliance).
 *   4. TWILIO_ENABLED feature flag (handled inside sendSms() in twilio.ts)
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

  // Gate 3: SMS opt-in (TCPA/CASL) — client-facing automations only.
  // Employee-facing SMS (booking_assignment_sms) bypasses this gate.
  if (CLIENT_FACING_SMS_KEYS.has(args.automationKey)) {
    try {
      const admin = createSupabaseAdminClient();
      const { data: clientRow } = (await admin
        .from("clients")
        .select("sms_opted_in")
        .eq("organization_id", orgId)
        .eq("phone", args.to)
        .limit(1)
        .maybeSingle()) as unknown as {
        data: { sms_opted_in: boolean } | null;
      };

      // Fail-safe: if no matching client found OR opt-in is false, skip.
      // "Not found" is treated as "not opted in" so we never text
      // someone whose consent status we can't verify.
      if (!clientRow || !clientRow.sms_opted_in) {
        console.log(
          `[sms] ${args.automationKey}: recipient ${args.to} has not opted in to SMS for org ${orgId} — skipping`,
        );
        return { ok: true, sid: null, status: "skipped_disabled" };
      }
    } catch (optInErr) {
      // Transient DB error — fail CLOSED for compliance. Better to
      // drop a message than to send without verified consent.
      console.error("[sms] opt-in check failed, skipping send:", optInErr);
      return { ok: true, sid: null, status: "skipped_disabled" };
    }
  }

  // Gate 4: TWILIO_ENABLED is checked inside sendSms()
  return sendSms(args.to, args.body);
}

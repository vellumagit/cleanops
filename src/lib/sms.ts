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
import { sendSms, smsSegments, type SmsSendResult } from "@/lib/twilio";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAutomationEnabled } from "@/lib/automation-defaults";

// ---------------------------------------------------------------------------
// Model B packaging: SMS is included in the plan the org already pays for, up
// to a monthly segment allotment; only overage past it is metered to Stripe.
// (Segments, not messages, are the billable unit — a long text costs 2.)
// ---------------------------------------------------------------------------

/**
 * Included SMS **segments** per month by plan tier. Change these to re-tier the
 * offering (e.g. drop `starter` to 0 to make SMS a Growth+ upsell). Comped orgs
 * bypass this entirely (see COMP_SAFETY_CAP_SEGMENTS).
 */
export const SMS_INCLUDED_BY_PLAN: Record<string, number> = {
  starter: 500,
  growth: 1000,
  enterprise: 5000,
};

/** Fallback allotment for an accessible org with no known plan tier (legacy / trialing). */
export const SMS_INCLUDED_DEFAULT = 500;

/**
 * Safety ceiling for COMPED orgs (billing_override). They're never charged, so
 * this exists only to protect the platform owner's Twilio bill from a runaway.
 * Set high; raise toward Infinity for a truly unlimited gift.
 */
export const COMP_SAFETY_CAP_SEGMENTS = 5000;

/** What each overage segment costs the org (cents). Metered to Stripe. */
export const OVERAGE_CENTS_PER_SEGMENT = 3;

/** UTC first-of-month ISO — the window the monthly allotment counts against. */
function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** The org SMS config columns sendOrgSms reads (not yet in generated types). */
type OrgSmsConfig = {
  sms_enabled: boolean;
  sms_from_number: string | null;
  sms_overage_cap_cents: number;
  sms_overage_item_id: string | null;
  billing_override: string | null;
  automation_settings: Record<string, { enabled?: boolean } | undefined> | null;
};

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
  const skipped: SmsSendResult = {
    ok: true,
    sid: null,
    status: "skipped_disabled",
    segments: 0,
  };

  // Gate 1: platform kill switch
  if (isClientSmsPaused()) {
    console.log(
      `[sms] platform paused (CLIENT_SMS_PAUSED) — skipping ${args.automationKey} for org ${orgId}`,
    );
    return skipped;
  }

  const admin = createSupabaseAdminClient();

  // Gate 2: org SMS config — master switch, sender number, plan/comp, cap.
  // One read serves the master switch, automation toggle, allotment tier, and
  // overage cap.
  let org: OrgSmsConfig | null = null;
  try {
    const { data } = (await admin
      .from("organizations")
      .select(
        "sms_enabled, sms_from_number, sms_overage_cap_cents, sms_overage_item_id, billing_override, automation_settings",
      )
      .eq("id", orgId)
      .maybeSingle()) as unknown as { data: OrgSmsConfig | null };
    org = data;
  } catch (readErr) {
    // Can't verify the master switch / config → fail CLOSED. SMS spends money;
    // never send on an unverified config.
    console.error("[sms] org config read failed, skipping send:", readErr);
    return skipped;
  }

  // Master switch: org hasn't turned SMS on. Silent skip, no ledger.
  if (!org || !org.sms_enabled) return skipped;

  // Per-org automation toggle (explicit setting wins, then default).
  if (!resolveAutomationEnabled(org.automation_settings ?? {}, args.automationKey)) {
    return skipped;
  }

  // Gate 3: SMS opt-in (TCPA/CASL) — client-facing automations only. Also
  // resolves the client id for the ledger row.
  let clientId: string | null = null;
  if (CLIENT_FACING_SMS_KEYS.has(args.automationKey)) {
    try {
      const { data: clientRow } = (await admin
        .from("clients")
        .select("id, sms_opted_in")
        .eq("organization_id", orgId)
        .eq("phone", args.to)
        .limit(1)
        .maybeSingle()) as unknown as {
        data: { id: string; sms_opted_in: boolean } | null;
      };

      // Fail-safe: no match OR not opted in → skip. "Not found" is treated as
      // "not opted in" so we never text someone whose consent we can't verify.
      if (!clientRow || !clientRow.sms_opted_in) {
        console.log(
          `[sms] ${args.automationKey}: recipient ${args.to} has not opted in for org ${orgId} — skipping`,
        );
        return skipped;
      }
      clientId = clientRow.id;
    } catch (optInErr) {
      // Fail CLOSED for compliance.
      console.error("[sms] opt-in check failed, skipping send:", optInErr);
      return skipped;
    }
  }

  // Gate 4: allotment / overage / cap.
  const isComped = Boolean(org.billing_override);
  const included = await resolveIncludedSegments(admin, orgId, isComped);
  const thisSegments = smsSegments(args.body);
  const usedSegments = await usedSegmentsThisMonth(admin, orgId);

  const priorOverage = Math.max(0, usedSegments - included);
  const newTotalOverage = Math.max(0, usedSegments + thisSegments - included);
  const incrementalOverage = newTotalOverage - priorOverage;

  if (isComped) {
    // Never charged — only guard the platform owner's Twilio bill.
    if (usedSegments + thisSegments > COMP_SAFETY_CAP_SEGMENTS) {
      await logSms(admin, orgId, args, clientId, thisSegments, "skipped_cap", false);
      await maybeAlertCap(admin, orgId, "safety cap");
      return skipped;
    }
  } else if (incrementalOverage > 0) {
    // Paid overage — enforce the org's hard monthly cap.
    const projectedOverageCents = newTotalOverage * OVERAGE_CENTS_PER_SEGMENT;
    if (projectedOverageCents > org.sms_overage_cap_cents) {
      await logSms(admin, orgId, args, clientId, thisSegments, "skipped_cap", false);
      await maybeAlertCap(admin, orgId, "monthly cap");
      return skipped;
    }
  }

  // Gate 5: TWILIO_ENABLED is checked inside sendSms(). Send from the org's
  // OWN number so each business texts from its own line.
  const result = await sendSms(args.to, args.body, org.sms_from_number);

  // Ledger — record the outcome. Only status 'sent' counts toward the monthly
  // allotment/overage (see usedSegmentsThisMonth), so a disabled/failed attempt
  // never accrues billable usage.
  const status = result.ok ? result.status : "failed";
  const billable = result.ok && result.status === "sent";
  await logSms(
    admin,
    orgId,
    args,
    clientId,
    thisSegments,
    status,
    billable && incrementalOverage > 0,
  );

  // Meter overage to Stripe (paid orgs only; comped never billed). Lazily
  // create the subscription item if it's missing — an org that enabled SMS
  // before it had a Stripe subscription (e.g. during trial) wouldn't have one,
  // and we must not give away overage for free after they convert.
  if (billable && !isComped && incrementalOverage > 0) {
    try {
      const { reportSmsOverageUsage, ensureSmsOverageItem } = await import("@/lib/stripe");
      const itemId = org.sms_overage_item_id ?? (await ensureSmsOverageItem(orgId));
      if (itemId) await reportSmsOverageUsage(itemId, incrementalOverage);
    } catch (meterErr) {
      // Best-effort — never fail the send because usage reporting hiccuped.
      console.error("[sms] overage usage report failed:", meterErr);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Allotment helpers
// ---------------------------------------------------------------------------

/** Included monthly segments for an org: comp safety cap, else its plan tier. */
async function resolveIncludedSegments(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string,
  isComped: boolean,
): Promise<number> {
  if (isComped) return COMP_SAFETY_CAP_SEGMENTS;
  const { data } = (await admin
    .from("subscriptions")
    .select("plan_tier")
    .eq("organization_id", orgId)
    .maybeSingle()) as unknown as { data: { plan_tier: string | null } | null };
  const plan = data?.plan_tier ?? null;
  if (plan && SMS_INCLUDED_BY_PLAN[plan] !== undefined) {
    return SMS_INCLUDED_BY_PLAN[plan];
  }
  return SMS_INCLUDED_DEFAULT;
}

/** Sum of billable (status='sent') outbound segments this calendar month. */
async function usedSegmentsThisMonth(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string,
): Promise<number> {
  // Aggregated in Postgres (see migration 20260707030000) so the send hot path
  // reads one integer instead of every row.
  const { data } = (await admin.rpc("sms_month_segments" as never, {
    p_org: orgId,
    p_since: monthStartIso(),
  } as never)) as unknown as { data: number | null };
  return data ?? 0;
}

async function logSms(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string,
  args: { to: string; body: string; automationKey: string },
  clientId: string | null,
  segments: number,
  status: string,
  isOverage: boolean,
): Promise<void> {
  try {
    await (admin.from("sms_messages" as never).insert({
      organization_id: orgId,
      direction: "outbound",
      to_number: args.to,
      body: args.body,
      segments,
      status,
      client_id: clientId,
      automation_key: args.automationKey,
      is_overage: isOverage,
    } as never) as unknown as Promise<unknown>);
  } catch (logErr) {
    console.error("[sms] ledger insert failed:", logErr);
  }
}

/**
 * Alert org admins that SMS paused at the cap — but only once per month, to
 * avoid a notification storm on every subsequent blocked send.
 */
async function maybeAlertCap(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string,
  which: string,
): Promise<void> {
  try {
    const { count } = (await admin
      .from("sms_messages" as never)
      .select("id", { count: "exact", head: true })
      .eq("organization_id" as never, orgId as never)
      .eq("status" as never, "skipped_cap" as never)
      .gte("created_at" as never, monthStartIso() as never)) as unknown as { count: number | null };
    // This send's skipped_cap row is logged BEFORE this call, so the first
    // cap hit shows count === 1 → alert exactly once.
    if ((count ?? 0) > 1) return;

    const { notify } = await import("@/lib/notify");
    await notify({
      audience: "org-admins",
      organizationId: orgId,
      type: "sms_cap",
      title: "SMS paused — monthly limit reached",
      body: `Texting hit your ${which} for this month. Increase the cap in Settings → SMS to resume.`,
      href: "/app/settings/sms",
    });
  } catch (alertErr) {
    console.error("[sms] cap alert failed:", alertErr);
  }
}

// ---------------------------------------------------------------------------
// Usage summary (Settings → SMS meter)
// ---------------------------------------------------------------------------

export type SmsUsageSummary = {
  usedSegments: number;
  includedSegments: number;
  overageSegments: number;
  overageCents: number;
  isComped: boolean;
};

/** Current-month usage for display on the Settings SMS page. */
export async function getOrgSmsUsage(orgId: string): Promise<SmsUsageSummary> {
  const admin = createSupabaseAdminClient();
  const { data: orgRow } = (await admin
    .from("organizations")
    .select("billing_override")
    .eq("id", orgId)
    .maybeSingle()) as unknown as {
    data: { billing_override: string | null } | null;
  };
  const isComped = Boolean(orgRow?.billing_override);
  const includedSegments = await resolveIncludedSegments(admin, orgId, isComped);
  const usedSegments = await usedSegmentsThisMonth(admin, orgId);
  const overageSegments = Math.max(0, usedSegments - includedSegments);
  return {
    usedSegments,
    includedSegments,
    overageSegments,
    overageCents: isComped ? 0 : overageSegments * OVERAGE_CENTS_PER_SEGMENT,
    isComped,
  };
}

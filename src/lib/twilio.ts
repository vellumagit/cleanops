/**
 * Twilio SMS scaffolding (Phase 11).
 *
 * Sollos 3 uses Twilio for outbound-only SMS to freelance cleaners when an
 * admin broadcasts a shift to the bench. DISABLED by default — flip
 * `TWILIO_ENABLED=true` in the environment once A2P 10DLC registration is
 * approved and you're ready to spend money on messages.
 *
 * Behavior:
 *   - `isTwilioEnabled()` — feature flag; the offer flow branches on this
 *   - `sendSms(to, body)` — when disabled, logs the message and returns
 *     `{ ok: true, sid: null, status: 'skipped_disabled' }` so the caller
 *     can still create a dispatch row and exercise the full UI. When
 *     enabled, calls Twilio's Messages API via raw fetch (no SDK required).
 *
 * Cost profile (US, Twilio list prices as of 2026):
 *   - Outbound SMS: ~$0.0079 per segment
 *   - Phone number: ~$1.15 / month
 *   - A2P 10DLC campaign: ~$10 / month + ~$44 one-time brand + campaign
 *   - First-month baseline: ~$55. Per-offer cost at 15 recipients: ~$0.12.
 *
 * Enabling checklist:
 *   1. Sign up at https://www.twilio.com and buy a US long code.
 *   2. Register A2P 10DLC brand + campaign (Twilio walks you through it;
 *      allow 1-3 business days for approval).
 *   3. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER in
 *      your Vercel env vars (and .env.local for dev).
 *   4. Set TWILIO_ENABLED=true.
 *   5. Redeploy.
 */

import "server-only";

export type SmsSendResult =
  | { ok: true; sid: string | null; status: "sent" | "skipped_disabled" }
  | { ok: false; error: string };

export function isTwilioEnabled(): boolean {
  return process.env.TWILIO_ENABLED === "true";
}

/**
 * Send an outbound SMS.
 *
 * When `TWILIO_ENABLED !== "true"`, this function short-circuits: it logs
 * the rendered message to the server console and returns a success result
 * with `status: 'skipped_disabled'`. That lets the offer flow create real
 * `job_offer_dispatches` rows in dev without ever calling Twilio.
 */
export async function sendSms(
  to: string,
  body: string,
): Promise<SmsSendResult> {
  if (!isTwilioEnabled()) {
    console.log(
      `[twilio:disabled] would send to ${to}: ${body.slice(0, 200)}`,
    );
    return { ok: true, sid: null, status: "skipped_disabled" };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !from) {
    return {
      ok: false,
      error:
        "TWILIO_ENABLED=true but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER are not set",
    };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const form = new URLSearchParams();
  form.set("To", to);
  form.set("From", from);
  form.set("Body", body);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 300)}` };
    }

    const json = (await res.json()) as { sid?: string };
    return { ok: true, sid: json.sid ?? null, status: "sent" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown Twilio error",
    };
  }
}

/**
 * Compose the standard offer SMS body.
 *
 * Target < 160 chars so it stays in a single SMS segment (1x cost).
 * Example: "Sollos 3: Coverage needed. Deep clean Tue Apr 14 2:00 PM, 3 hrs,
 * $180. 1247 Maple St. First to claim gets it: https://sollos.app/claim/abc"
 */
export function composeOfferSms(args: {
  serviceType: string;
  scheduledAt: string; // ISO
  durationMinutes: number;
  payCents: number;
  addressShort: string;
  claimUrl: string;
  positionsNeeded?: number;
}): string {
  const when = new Date(args.scheduledAt).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const duration =
    args.durationMinutes >= 60
      ? `${Math.round((args.durationMinutes / 60) * 10) / 10} hrs`
      : `${args.durationMinutes} min`;
  const dollars = `$${(args.payCents / 100).toFixed(0)}`;
  const service = args.serviceType.replace(/_/g, " ");
  const positions = args.positionsNeeded ?? 1;
  const cta =
    positions > 1
      ? `${positions} spots available — claim yours`
      : "First to claim gets it";
  return `Sollos 3: Coverage needed. ${service} ${when}, ${duration}, ${dollars}. ${args.addressShort}. ${cta}: ${args.claimUrl}`;
}

/**
 * SMS to an employee when a booking is assigned to them. Target <160
 * chars (1 segment). The org name is prepended so the employee knows
 * which company the job is from when they work for multiple.
 *
 * "{Org}: New job. Deep clean for Smith Fri Apr 24 2:00 PM. 1247 Maple St."
 */
export function composeBookingAssignmentSms(args: {
  orgName: string;
  serviceType: string;
  clientName: string;
  scheduledAt: string;
  address: string | null;
}): string {
  const when = new Date(args.scheduledAt).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const service = args.serviceType.replace(/_/g, " ");
  const addressPart = args.address ? ` ${args.address}` : "";
  return `${args.orgName}: New job. ${service} for ${args.clientName} ${when}.${addressPart}`;
}

/**
 * 24-hour heads-up SMS to a client before their booking. Keep it
 * short + warm — unlike a job assignment, the client didn't opt into
 * noisy texting.
 *
 * "Velluma: Reminder — your Deep clean is Fri Apr 24 2:00 PM.
 * Questions? (555) 123-4567"
 */
export function composeBookingReminderSms(args: {
  orgName: string;
  serviceType: string;
  scheduledAt: string;
  contactPhone?: string | null;
}): string {
  const when = new Date(args.scheduledAt).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const service = args.serviceType.replace(/_/g, " ");
  const cta = args.contactPhone
    ? ` Questions? ${args.contactPhone}`
    : "";
  return `${args.orgName}: Reminder — your ${service} is ${when}.${cta}`;
}

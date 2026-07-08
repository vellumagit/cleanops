/**
 * Per-org Twilio number provisioning (SMS Phase 1).
 *
 * Each org texts from THEIR OWN number, not a shared platform sender — for
 * branding, deliverability (per-tenant reputation), and so Phase 2 can route
 * an inbound reply back to the right org by its `To` number. This module
 * searches for + buys a local number when an org enables SMS, and releases it
 * on disable.
 *
 * Stubbed until Twilio is configured: when `TWILIO_ENABLED !== "true"` (or the
 * credentials are missing) `provisionOrgNumber` returns a SIMULATED number
 * (sid = "SIMULATED") and stores it, so the whole enable → number → usage-meter
 * flow is exercisable in dev without spending a cent. Actual sends are also
 * no-op'd in that state (see sendSms in twilio.ts), so a simulated number never
 * leaves the building.
 *
 * Raw fetch against Twilio's REST API — no SDK dependency, mirroring twilio.ts.
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isTwilioEnabled } from "@/lib/twilio";

export type ProvisionResult =
  | { ok: true; number: string; sid: string; simulated: boolean }
  | { ok: false; error: string };

type TwilioCreds = { accountSid: string; authToken: string };

function twilioCreds(): TwilioCreds | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken };
}

/** True only when Twilio is live AND credentials are present — safe to spend. */
function canProvisionForReal(): boolean {
  return isTwilioEnabled() && twilioCreds() !== null;
}

function authHeader({ accountSid, authToken }: TwilioCreds): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

/** Public base URL for inbound webhooks (Phase 2). Falls back to prod. */
function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "https://sollos3.com"
  ).replace(/\/$/, "");
}

/**
 * Best-effort 3-digit NANP area code from an org's E.164 contact phone, so the
 * provisioned number is local to the business. Returns null (let Twilio pick
 * any CA local number) when we can't determine one.
 */
function areaCodeFromPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  // +1AAANNNNNNN → 11 digits leading 1; area code is digits[1..4]
  if (digits.length === 11 && digits[0] === "1") return digits.slice(1, 4);
  if (digits.length === 10) return digits.slice(0, 3);
  return null;
}

/**
 * Ensure the org has its own SMS number. Idempotent: if one is already stored,
 * returns it without buying another. Stores `sms_from_number` + `sms_number_sid`
 * on success.
 */
export async function provisionOrgNumber(orgId: string): Promise<ProvisionResult> {
  const admin = createSupabaseAdminClient();

  const { data: orgRow } = (await admin
    .from("organizations")
    .select("contact_phone, sms_from_number, sms_number_sid")
    .eq("id", orgId)
    .maybeSingle()) as unknown as {
    data: {
      contact_phone: string | null;
      sms_from_number: string | null;
      sms_number_sid: string | null;
    } | null;
  };

  if (!orgRow) return { ok: false, error: `Organization ${orgId} not found` };

  // Idempotent — already provisioned.
  if (orgRow.sms_from_number && orgRow.sms_number_sid) {
    return {
      ok: true,
      number: orgRow.sms_from_number,
      sid: orgRow.sms_number_sid,
      simulated: orgRow.sms_number_sid === "SIMULATED",
    };
  }

  const areaCode = areaCodeFromPhone(orgRow.contact_phone);

  // ── Stub path: Twilio not live → simulate so the UI flow works in dev. ──
  if (!canProvisionForReal()) {
    // Twilio's magic test number, tagged simulated. Sends are no-op'd anyway.
    const simulated = "+15005550006";
    await persistNumber(admin, orgId, simulated, "SIMULATED");
    return { ok: true, number: simulated, sid: "SIMULATED", simulated: true };
  }

  const creds = twilioCreds()!;

  // ── 1. Search for an available CA local, SMS-enabled number. ──
  const searchParams = new URLSearchParams({ SmsEnabled: "true", Limit: "1" });
  if (areaCode) searchParams.set("AreaCode", areaCode);
  const searchUrl =
    `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}` +
    `/AvailablePhoneNumbers/CA/Local.json?${searchParams.toString()}`;

  let candidate: string | null = null;
  try {
    const res = await fetch(searchUrl, {
      headers: { Authorization: authHeader(creds) },
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Twilio search ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as {
      available_phone_numbers?: Array<{ phone_number?: string }>;
    };
    candidate = json.available_phone_numbers?.[0]?.phone_number ?? null;

    // Retry without the area-code constraint if the local search came up empty.
    if (!candidate && areaCode) {
      const wideRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}` +
          `/AvailablePhoneNumbers/CA/Local.json?SmsEnabled=true&Limit=1`,
        { headers: { Authorization: authHeader(creds) } },
      );
      if (wideRes.ok) {
        const wideJson = (await wideRes.json()) as {
          available_phone_numbers?: Array<{ phone_number?: string }>;
        };
        candidate = wideJson.available_phone_numbers?.[0]?.phone_number ?? null;
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Twilio search failed",
    };
  }

  if (!candidate) {
    return { ok: false, error: "No available Canadian SMS numbers found" };
  }

  // ── 2. Purchase it, wiring the inbound webhook now for Phase 2. ──
  const buyForm = new URLSearchParams();
  buyForm.set("PhoneNumber", candidate);
  buyForm.set("SmsUrl", `${appBaseUrl()}/api/sms/inbound`);
  buyForm.set("SmsMethod", "POST");
  buyForm.set("FriendlyName", `Sollos org ${orgId}`);

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader(creds),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: buyForm.toString(),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Twilio buy ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as { sid?: string; phone_number?: string };
    const sid = json.sid;
    const number = json.phone_number ?? candidate;
    if (!sid) return { ok: false, error: "Twilio buy: no SID returned" };

    await persistNumber(admin, orgId, number, sid);
    return { ok: true, number, sid, simulated: false };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Twilio purchase failed",
    };
  }
}

/**
 * Release the org's number back to Twilio and clear the columns. Best-effort:
 * always clears local state even if the Twilio release fails (so a stuck number
 * can't wedge the disable flow); logs on failure for manual cleanup.
 */
export async function releaseOrgNumber(orgId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: orgRow } = (await admin
    .from("organizations")
    .select("sms_number_sid")
    .eq("id", orgId)
    .maybeSingle()) as unknown as {
    data: { sms_number_sid: string | null } | null;
  };

  const sid = orgRow?.sms_number_sid ?? null;

  if (sid && sid !== "SIMULATED" && canProvisionForReal()) {
    const creds = twilioCreds()!;
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers/${sid}.json`,
        { method: "DELETE", headers: { Authorization: authHeader(creds) } },
      );
      if (!res.ok && res.status !== 404) {
        console.error(
          `[twilio-provision] release ${sid} for org ${orgId} returned ${res.status}`,
        );
      }
    } catch (err) {
      console.error(`[twilio-provision] release failed for org ${orgId}:`, err);
    }
  }

  await (admin
    .from("organizations")
    .update({ sms_from_number: null, sms_number_sid: null } as never)
    .eq("id", orgId) as unknown as Promise<unknown>);
}

async function persistNumber(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string,
  number: string,
  sid: string,
): Promise<void> {
  await (admin
    .from("organizations")
    .update({ sms_from_number: number, sms_number_sid: sid } as never)
    .eq("id", orgId) as unknown as Promise<unknown>);
}

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isTwilioEnabled } from "@/lib/twilio";
import { encryptField, maybeDecryptField } from "@/lib/field-encryption";
import { logSystemAuditEvent } from "@/lib/audit";
import {
  businessInfoAttributes,
  campaignText,
  campaignTextProblems,
  messagingProfileAttributes,
  representativeAttributes,
  type RegistrationInput,
  type RegistrationStatus,
} from "@/lib/sms-registration-rules";

/**
 * Registering a US business with the carriers (A2P 10DLC), as an ISV,
 * through Twilio's REST API. Steps and names follow Twilio's guide
 * "Onboard customers to A2P 10DLC as an ISV" (read 2026-11-03):
 *
 *   submit   1. Secondary Customer Profile: business info, authorized
 *               representative, address, our Primary profile; evaluate;
 *               submit for review.
 *            2. A2P Messaging Profile (TrustProduct): company type, the
 *               profile above; evaluate; submit.
 *            3. Brand registration (charges a fee). Doesn't wait for 1–2
 *               to be approved — Twilio's guide says it needn't.
 *   advance  4. Brand APPROVED → a new Messaging Service and the campaign
 *               (charges a fee; reviewed by the carriers).
 *            5. Campaign VERIFIED → buy a US number in the business's area
 *               code, add it to the service, switch texting on.
 *
 * Every object id is saved to sms_registrations.twilio the moment it
 * exists, so a step that fails halfway resumes rather than repeats — a
 * repeated brand registration is charged again. The hourly cron calls
 * advance; the settings page can too ("Check now").
 *
 * Needs TWILIO_PRIMARY_CUSTOMER_PROFILE_SID: Sollos's own Primary Customer
 * Profile (ISV Reseller or Partner), which must be Twilio-approved first.
 * With Twilio not live (TWILIO_ENABLED unset), everything is simulated so
 * the screens can be exercised without spending anything.
 */

const SECONDARY_PROFILE_POLICY = "RNdfbf3fae0e1107f8aded0e7cead80bf5";
const A2P_PROFILE_POLICY = "RNb0d4771c2c98518d916a3d4cd70a8f8b";

type Creds = { accountSid: string; authToken: string };

function creds(): Creds | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  return accountSid && authToken ? { accountSid, authToken } : null;
}

function live(): boolean {
  return isTwilioEnabled() && creds() !== null;
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://sollos3.com").replace(/\/$/, "");
}

/** Sollos's address on Twilio's records; Twilio emails status changes here. */
function isvEmail(): string {
  return process.env.TWILIO_ISV_EMAIL ?? "support@sollos3.com";
}

export function hostedPolicyUrls(orgId: string) {
  const base = appBaseUrl();
  return {
    privacyUrl: `${base}/texting/${orgId}/privacy`,
    termsUrl: `${base}/texting/${orgId}/terms`,
    appUrl: base,
  };
}

class TwilioError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Form = Record<string, string | string[] | boolean | undefined>;

async function call<T = Record<string, unknown>>(
  method: "GET" | "POST" | "DELETE",
  url: string,
  form?: Form,
): Promise<T> {
  const c = creds();
  if (!c) throw new TwilioError("Twilio credentials are missing.", 0);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form ?? {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) body.append(k, item);
    else body.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64")}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? body.toString() : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const msg = (json.message as string) || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new TwilioError(msg, res.status);
  }
  return json as T;
}

const TH = "https://trusthub.twilio.com/v1";
const MSG = "https://messaging.twilio.com/v1";

type Row = {
  organization_id: string;
  status: RegistrationStatus;
  details: Record<string, string>;
  twilio: Record<string, string>;
};

type Db = ReturnType<typeof createSupabaseAdminClient>;

async function load(db: Db, orgId: string): Promise<Row | null> {
  const { data } = (await db
    .from("sms_registrations" as never)
    .select("organization_id, status, details, twilio")
    .eq("organization_id" as never, orgId as never)
    .maybeSingle()) as unknown as { data: Row | null };
  return data;
}

async function save(
  db: Db,
  orgId: string,
  patch: Partial<{
    status: RegistrationStatus;
    twilio: Record<string, string>;
    status_detail: string | null;
    submitted_at: string;
    approved_at: string;
    last_checked_at: string;
  }>,
): Promise<void> {
  await (db
    .from("sms_registrations" as never)
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq("organization_id" as never, orgId as never) as unknown as Promise<unknown>);
}

/** The stored answers with the EIN decrypted, for building Twilio payloads. */
export function inputFromDetails(details: Record<string, string>): RegistrationInput {
  const { ein_enc, ...rest } = details;
  return { ...(rest as unknown as RegistrationInput), ein: maybeDecryptField(ein_enc) ?? "" };
}

/** What gets stored: everything as entered, with the EIN encrypted. */
export function detailsFromInput(v: RegistrationInput): Record<string, string> {
  const { ein, ...rest } = v;
  return { ...(rest as unknown as Record<string, string>), ein_enc: encryptField(ein) ?? "", ein_last4: ein.slice(-4) };
}

/** Plain words from an Evaluation's failed checks. */
function evaluationProblems(ev: Record<string, unknown>): string[] {
  const out: string[] = [];
  const results = (ev.results as Array<Record<string, unknown>> | undefined) ?? [];
  for (const r of results) {
    if (r.passed === true) continue;
    const fields = (r.fields as Array<Record<string, unknown>> | undefined) ?? [];
    const bad = fields.filter((f) => f.passed === false);
    if (bad.length === 0 && r.failure_reason) out.push(String(r.failure_reason));
    for (const f of bad) {
      out.push(`${String(f.friendly_name ?? f.object_field ?? "A field")}: ${String(f.failure_reason ?? "not accepted")}`);
    }
    if (bad.length === 0 && !r.failure_reason && r.friendly_name) out.push(String(r.friendly_name));
  }
  return out;
}

/**
 * Steps 1–3. Safe to call again after a failure or after the owner fixed
 * their answers: existing objects are updated, missing ones created.
 */
export async function submitUsRegistration(orgId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = createSupabaseAdminClient();
  const row = await load(db, orgId);
  if (!row) return { ok: false, error: "Fill in the registration first." };
  const v = inputFromDetails(row.details);
  const tw: Record<string, string> = { ...row.twilio };
  const keep = async (patch: Record<string, string>) => {
    Object.assign(tw, patch);
    await save(db, orgId, { twilio: { ...tw } });
  };

  const text = campaignText(v, hostedPolicyUrls(orgId));
  const textProblems = campaignTextProblems(text);
  if (textProblems.length > 0) {
    await save(db, orgId, { status: "needs_changes", status_detail: textProblems.join(" ") });
    return { ok: false, error: textProblems.join(" ") };
  }

  if (!live()) {
    await save(db, orgId, {
      status: "brand_review",
      submitted_at: new Date().toISOString(),
      status_detail: "Simulated: Twilio isn't live here, so nothing was sent to the carriers.",
      twilio: { ...tw, simulated: "true" },
    });
    return { ok: true };
  }

  const primary = process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID;
  if (!primary) {
    return {
      ok: false,
      error: "Sollos's own carrier registration isn't set up yet (TWILIO_PRIMARY_CUSTOMER_PROFILE_SID). Tell Brian.",
    };
  }

  await save(db, orgId, { status: "submitted", status_detail: null, submitted_at: new Date().toISOString() });
  const c = creds()!;

  try {
    // ── 1. Secondary Customer Profile ──
    if (!tw.customer_profile) {
      const cp = await call<{ sid: string }>("POST", `${TH}/CustomerProfiles`, {
        FriendlyName: `${v.legal_name} (Sollos ${orgId})`,
        Email: isvEmail(),
        PolicySid: SECONDARY_PROFILE_POLICY,
      });
      await keep({ customer_profile: cp.sid });
    }
    const cpSid = tw.customer_profile;

    if (tw.business_info) {
      await call("POST", `${TH}/EndUsers/${tw.business_info}`, {
        Attributes: JSON.stringify(businessInfoAttributes(v)),
      });
    } else {
      const eu = await call<{ sid: string }>("POST", `${TH}/EndUsers`, {
        FriendlyName: `${v.legal_name} business info`,
        Type: "customer_profile_business_information",
        Attributes: JSON.stringify(businessInfoAttributes(v)),
      });
      await keep({ business_info: eu.sid });
    }
    if (!tw.business_info_assigned) {
      await call("POST", `${TH}/CustomerProfiles/${cpSid}/EntityAssignments`, { ObjectSid: tw.business_info });
      await keep({ business_info_assigned: "true" });
    }

    if (tw.representative) {
      await call("POST", `${TH}/EndUsers/${tw.representative}`, {
        Attributes: JSON.stringify(representativeAttributes(v)),
      });
    } else {
      const rep = await call<{ sid: string }>("POST", `${TH}/EndUsers`, {
        FriendlyName: `${v.rep_first_name} ${v.rep_last_name}`,
        Type: "authorized_representative_1",
        Attributes: JSON.stringify(representativeAttributes(v)),
      });
      await keep({ representative: rep.sid });
    }
    if (!tw.representative_assigned) {
      await call("POST", `${TH}/CustomerProfiles/${cpSid}/EntityAssignments`, { ObjectSid: tw.representative });
      await keep({ representative_assigned: "true" });
    }

    const address = {
      FriendlyName: `${v.legal_name} address`,
      CustomerName: v.legal_name,
      Street: v.street2 ? `${v.street}, ${v.street2}` : v.street,
      City: v.city,
      Region: v.state,
      PostalCode: v.postal_code,
      IsoCountry: "US",
    };
    if (tw.address) {
      // Country can't change on an existing address, and isn't an update field.
      const { IsoCountry: _country, ...update } = address;
      void _country;
      await call("POST", `https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Addresses/${tw.address}.json`, update);
    } else {
      const ad = await call<{ sid: string }>(
        "POST",
        `https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Addresses.json`,
        address,
      );
      await keep({ address: ad.sid });
    }
    if (!tw.address_document) {
      const doc = await call<{ sid: string }>("POST", `${TH}/SupportingDocuments`, {
        FriendlyName: `${v.legal_name} address`,
        Type: "customer_profile_address",
        Attributes: JSON.stringify({ address_sids: tw.address }),
      });
      await keep({ address_document: doc.sid });
    }
    if (!tw.address_assigned) {
      await call("POST", `${TH}/CustomerProfiles/${cpSid}/EntityAssignments`, { ObjectSid: tw.address_document });
      await keep({ address_assigned: "true" });
    }
    if (!tw.primary_assigned) {
      await call("POST", `${TH}/CustomerProfiles/${cpSid}/EntityAssignments`, { ObjectSid: primary });
      await keep({ primary_assigned: "true" });
    }

    const cpEval = await call<Record<string, unknown>>("POST", `${TH}/CustomerProfiles/${cpSid}/Evaluations`, {
      PolicySid: SECONDARY_PROFILE_POLICY,
    });
    if (cpEval.status !== "compliant") {
      const problems = evaluationProblems(cpEval);
      const detail = `Twilio found problems with the business details: ${problems.join("; ") || "no reason given"}.`;
      await save(db, orgId, { status: "needs_changes", status_detail: detail });
      return { ok: false, error: detail };
    }
    await submitBundle(`${TH}/CustomerProfiles/${cpSid}`);

    // ── 2. A2P Messaging Profile ──
    if (!tw.trust_product) {
      const tp = await call<{ sid: string }>("POST", `${TH}/TrustProducts`, {
        FriendlyName: `${v.legal_name} A2P profile`,
        Email: isvEmail(),
        PolicySid: A2P_PROFILE_POLICY,
      });
      await keep({ trust_product: tp.sid });
    }
    const tpSid = tw.trust_product;
    if (tw.messaging_profile) {
      await call("POST", `${TH}/EndUsers/${tw.messaging_profile}`, {
        Attributes: JSON.stringify(messagingProfileAttributes(v)),
      });
    } else {
      const mp = await call<{ sid: string }>("POST", `${TH}/EndUsers`, {
        FriendlyName: `${v.legal_name} messaging profile`,
        Type: "us_a2p_messaging_profile_information",
        Attributes: JSON.stringify(messagingProfileAttributes(v)),
      });
      await keep({ messaging_profile: mp.sid });
    }
    if (!tw.messaging_profile_assigned) {
      await call("POST", `${TH}/TrustProducts/${tpSid}/EntityAssignments`, { ObjectSid: tw.messaging_profile });
      await keep({ messaging_profile_assigned: "true" });
    }
    if (!tw.trust_product_profile_assigned) {
      await call("POST", `${TH}/TrustProducts/${tpSid}/EntityAssignments`, { ObjectSid: cpSid });
      await keep({ trust_product_profile_assigned: "true" });
    }
    const tpEval = await call<Record<string, unknown>>("POST", `${TH}/TrustProducts/${tpSid}/Evaluations`, {
      PolicySid: A2P_PROFILE_POLICY,
    });
    if (tpEval.status !== "compliant") {
      const problems = evaluationProblems(tpEval);
      const detail = `Twilio found problems with the company details: ${problems.join("; ") || "no reason given"}.`;
      await save(db, orgId, { status: "needs_changes", status_detail: detail });
      return { ok: false, error: detail };
    }
    await submitBundle(`${TH}/TrustProducts/${tpSid}`);

    // ── 3. Brand (charged) ──
    if (!tw.brand) {
      const brand = await call<{ sid: string }>("POST", `${MSG}/a2p/BrandRegistrations`, {
        CustomerProfileBundleSid: cpSid,
        A2PProfileBundleSid: tpSid,
      });
      await keep({ brand: brand.sid });
    } else {
      // A brand that failed is resubmitted in place after the fixes above,
      // not registered (and charged) again.
      const brand = await call<{ status?: string }>("GET", `${MSG}/a2p/BrandRegistrations/${tw.brand}`);
      if (brand.status === "FAILED") await call("POST", `${MSG}/a2p/BrandRegistrations/${tw.brand}`);
    }

    await save(db, orgId, { status: "brand_review", status_detail: null });
    await logSystemAuditEvent({
      organizationId: orgId,
      action: "update",
      entity: "settings",
      entity_id: orgId,
      after: { sms_registration: "submitted", brand: tw.brand },
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[twilio-a2p] submit failed:", orgId, msg);
    await save(db, orgId, {
      status: "needs_changes",
      status_detail: `Twilio refused a step: ${msg}`,
    });
    return { ok: false, error: msg };
  }
}

/** Put a Trust Hub bundle in for review; one already in review or approved is left alone. */
async function submitBundle(url: string): Promise<void> {
  const current = await call<{ status?: string }>("GET", url);
  const s = String(current.status ?? "").replace("_", "-");
  if (s === "draft" || s === "twilio-rejected") {
    await call("POST", url, { Status: "pending-review" });
  }
}

/**
 * Steps 4–5: move a submitted registration along as Twilio and the carriers
 * answer. Quiet when nothing has changed.
 */
export async function advanceUsRegistration(orgId: string): Promise<RegistrationStatus | null> {
  const db = createSupabaseAdminClient();
  const row = await load(db, orgId);
  if (!row) return null;
  if (!["brand_review", "campaign_review"].includes(row.status)) return row.status;
  const now = new Date().toISOString();
  const tw: Record<string, string> = { ...row.twilio };
  const keep = async (patch: Record<string, string>) => {
    Object.assign(tw, patch);
    await save(db, orgId, { twilio: { ...tw } });
  };

  // Simulated: brand → campaign → approved, one step per look.
  if (tw.simulated === "true") {
    if (row.status === "brand_review") {
      await save(db, orgId, { status: "campaign_review", last_checked_at: now });
      return "campaign_review";
    }
    return finishApproved(db, orgId, row, undefined);
  }

  try {
    if (row.status === "brand_review") {
      const brand = await call<Record<string, unknown>>("GET", `${MSG}/a2p/BrandRegistrations/${tw.brand}`);
      const status = String(brand.status ?? "");
      if (status === "FAILED" || status === "SUSPENDED") {
        const reason = brandFailure(brand);
        await save(db, orgId, {
          status: "needs_changes",
          status_detail: `The carriers didn't accept the business: ${reason}`,
          last_checked_at: now,
        });
        return "needs_changes";
      }
      if (status !== "APPROVED") {
        await save(db, orgId, { last_checked_at: now });
        return "brand_review";
      }

      // ── 4. Messaging Service + campaign (charged) ──
      if (!tw.messaging_service) {
        const v = inputFromDetails(row.details);
        const svc = await call<{ sid: string }>("POST", `${MSG}/Services`, {
          FriendlyName: `${v.brand_name || v.legal_name} (Sollos)`,
          InboundRequestUrl: `${appBaseUrl()}/api/sms/inbound`,
          // The number's own webhook (set when it's bought) decides where
          // replies go, so STOP/HELP keep reaching Sollos's handler.
          UseInboundWebhookOnNumber: true,
        });
        await keep({ messaging_service: svc.sid });
      }
      if (!tw.campaign) {
        const v = inputFromDetails(row.details);
        const t = campaignText(v, hostedPolicyUrls(orgId));
        const campaign = await call<{ sid: string }>(
          "POST",
          `${MSG}/Services/${tw.messaging_service}/Compliance/Usa2p`,
          {
            BrandRegistrationSid: tw.brand,
            Description: t.description,
            MessageFlow: t.messageFlow,
            MessageSamples: t.samples,
            UsAppToPersonUsecase: t.useCase,
            HasEmbeddedLinks: true,
            HasEmbeddedPhone: true,
            OptInMessage: t.optInMessage,
            OptOutMessage: t.optOutMessage,
            HelpMessage: t.helpMessage,
            OptInKeywords: t.optInKeywords,
            OptOutKeywords: t.optOutKeywords,
            HelpKeywords: t.helpKeywords,
            PrivacyPolicyUrl: t.privacyUrl,
            TermsAndConditionsUrl: t.termsUrl,
          },
        );
        await keep({ campaign: campaign.sid });
      }
      await save(db, orgId, { status: "campaign_review", status_detail: null, last_checked_at: now });
      return "campaign_review";
    }

    // campaign_review
    const campaign = await call<Record<string, unknown>>(
      "GET",
      `${MSG}/Services/${tw.messaging_service}/Compliance/Usa2p/${tw.campaign}`,
    );
    const cs = String(campaign.campaign_status ?? "");
    if (cs === "FAILED") {
      const errs = (campaign.errors as Array<Record<string, unknown>> | undefined) ?? [];
      const reason = errs.map((e) => String(e.description ?? e.message ?? "")).filter(Boolean).join("; ");
      // A failed campaign is replaced, not edited: drop it so the next
      // resubmission creates a fresh one.
      await call("DELETE", `${MSG}/Services/${tw.messaging_service}/Compliance/Usa2p/${tw.campaign}`).catch(() => {});
      delete tw.campaign;
      await save(db, orgId, {
        twilio: { ...tw },
        status: "needs_changes",
        status_detail: `The carriers didn't accept the texting plan: ${reason || "no reason given"}`,
        last_checked_at: now,
      });
      return "needs_changes";
    }
    if (cs !== "VERIFIED") {
      await save(db, orgId, { last_checked_at: now });
      return "campaign_review";
    }
    return finishApproved(db, orgId, row, tw.messaging_service);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[twilio-a2p] advance failed:", orgId, msg);
    await save(db, orgId, { status_detail: `Last check failed: ${msg}`, last_checked_at: now });
    return row.status;
  }
}

function brandFailure(brand: Record<string, unknown>): string {
  const errs = (brand.errors as Array<Record<string, unknown>> | undefined) ?? [];
  const fromErrors = errs.map((e) => String(e.description ?? e.message ?? "")).filter(Boolean);
  return fromErrors.join("; ") || String(brand.failure_reason ?? "no reason given");
}

/** Step 5: buy the number in the business's area code, add it, turn texting on. */
async function finishApproved(
  db: Db,
  orgId: string,
  row: Row,
  messagingServiceSid: string | undefined,
): Promise<RegistrationStatus> {
  const { provisionOrgNumber } = await import("@/lib/twilio-provision");
  // Area code from the business's support phone, via the org's contact
  // phone that provisionOrgNumber reads; set it if the org has none.
  const support = row.details.support_phone;
  if (support) {
    const { data: org } = (await db
      .from("organizations")
      .select("contact_phone")
      .eq("id", orgId)
      .maybeSingle()) as unknown as { data: { contact_phone: string | null } | null };
    if (!org?.contact_phone) {
      await (db
        .from("organizations")
        .update({ contact_phone: support } as never)
        .eq("id", orgId) as unknown as Promise<unknown>);
    }
  }
  // provisionOrgNumber returns a number the org already holds without
  // touching it, so one bought before registration would never join the
  // approved service. Attach it here instead; a failure says so.
  const { data: held } = (await db
    .from("organizations")
    .select("sms_from_number, sms_number_sid")
    .eq("id", orgId)
    .maybeSingle()) as unknown as {
    data: { sms_from_number: string | null; sms_number_sid: string | null } | null;
  };
  if (held?.sms_number_sid && held.sms_number_sid !== "SIMULATED" && messagingServiceSid) {
    try {
      await call("POST", `${MSG}/Services/${messagingServiceSid}/PhoneNumbers`, {
        PhoneNumberSid: held.sms_number_sid,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 21710-style "already in this service" is fine; anything else isn't.
      if (!/already/i.test(msg)) {
        await save(db, orgId, {
          status_detail: `Approved, but the existing number ${held.sms_from_number} couldn't join the texting service: ${msg}`,
          last_checked_at: new Date().toISOString(),
        });
        return row.status;
      }
    }
  }
  const number = await provisionOrgNumber(orgId, { country: "US", messagingServiceSid });
  if (!number.ok) {
    await save(db, orgId, { status_detail: `Approved, but buying the number failed: ${number.error}`, last_checked_at: new Date().toISOString() });
    return row.status;
  }
  if (messagingServiceSid) {
    await (db
      .from("organizations")
      .update({ sms_messaging_service_sid: messagingServiceSid } as never)
      .eq("id", orgId) as unknown as Promise<unknown>);
  }
  const { turnOnOrgSms } = await import("@/lib/sms-enable");
  await turnOnOrgSms(orgId);
  await save(db, orgId, {
    status: "approved",
    approved_at: new Date().toISOString(),
    status_detail: `Your texting number is ${number.number}.`,
    last_checked_at: new Date().toISOString(),
  });
  await logSystemAuditEvent({
    organizationId: orgId,
    action: "update",
    entity: "settings",
    entity_id: orgId,
    after: { sms_registration: "approved", sms_from_number: number.number },
  });
  return "approved";
}

/** Every registration waiting on Twilio or the carriers. For the cron. */
export async function advanceAllUsRegistrations(): Promise<{ checked: number; changed: number }> {
  const db = createSupabaseAdminClient();
  const { data } = (await db
    .from("sms_registrations" as never)
    .select("organization_id, status, updated_at")
    .in("status" as never, ["submitted", "brand_review", "campaign_review"] as never)) as unknown as {
    data: Array<{ organization_id: string; status: string; updated_at: string }> | null;
  };
  let changed = 0;
  for (const r of data ?? []) {
    // "Submitting…" that hasn't moved for ten minutes was cut off midway
    // (the request timed out, the phone closed). Every step resumes from
    // the ids already saved, so finishing it here is safe; left alone it
    // would sit at "Submitting…" with the form locked.
    if (r.status === "submitted") {
      if (Date.now() - new Date(r.updated_at).getTime() < 10 * 60_000) continue;
      const res = await submitUsRegistration(r.organization_id);
      if (res.ok) changed++;
      await new Promise((ok) => setTimeout(ok, 1100));
      continue;
    }
    const next = await advanceUsRegistration(r.organization_id);
    if (next && next !== r.status) changed++;
    // Twilio asks for one brand/campaign request per second.
    await new Promise((res) => setTimeout(res, 1100));
  }
  return { checked: data?.length ?? 0, changed };
}

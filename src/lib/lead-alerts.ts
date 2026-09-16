import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";
import { sendOrgSms } from "@/lib/sms";

/**
 * Who hears about a new website lead, and how.
 *
 * Two automation keys, both "team alert" audience, both living on Settings →
 * Intake forms beside the webhook URLs they act on:
 *
 *   lead_alert_email — the "New estimate request" / "New website inquiry"
 *     email to every owner and admin plus the org's contact inbox. ON UNLESS
 *     TURNED OFF, and it ignores the automations master switch. That is a
 *     deliberate exception to the opt-in doctrine: this email fired
 *     unconditionally from the day the intake routes existed, and making it
 *     opt-in would have silently stopped lead mail for every org whose master
 *     switch is off and every org that signs up tomorrow. A missed lead costs
 *     more than a stray email.
 *
 *   lead_alert_sms — the same news as a text from the org's own number to the
 *     same people's phones. Opt-in like every other text (it spends the
 *     org's SMS allotment), and sendOrgSms enforces the master switch, the
 *     per-key toggle, SMS being enabled, and the cap.
 */
export const LEAD_ALERT_EMAIL_KEY = "lead_alert_email";
export const LEAD_ALERT_SMS_KEY = "lead_alert_sms";

type AutomationSettings = Record<string, { enabled?: boolean } | undefined> | null | undefined;

/** On unless explicitly off — see the note above. */
export function leadAlertEmailEnabled(settings: AutomationSettings): boolean {
  return settings?.[LEAD_ALERT_EMAIL_KEY]?.enabled !== false;
}

export type LeadAlertTargets = {
  /** Whether the email alert is on for this org. */
  emailOn: boolean;
  /** Deduped, lowercased: owner/admin emails + the org contact inbox. */
  emails: string[];
  /** Deduped, E.164: owner/admin profile phones + the org contact phone. */
  phones: string[];
  orgName: string;
};

/**
 * Owners and admins (their login or contact email, their profile phone) plus
 * the organization's own contact email and phone from Settings → Organization.
 * The org contact details are the ones a business actually watches; before
 * 2026-09-15 only the people's login emails were told.
 */
export async function getLeadAlertTargets(orgId: string): Promise<LeadAlertTargets> {
  const admin = createSupabaseAdminClient();
  const [{ data: org }, { data: people }] = await Promise.all([
    admin
      .from("organizations")
      .select("name, contact_email, contact_phone, automation_settings")
      .eq("id", orgId)
      .maybeSingle() as unknown as Promise<{
      data: {
        name: string | null;
        contact_email: string | null;
        contact_phone: string | null;
        automation_settings: AutomationSettings;
      } | null;
    }>,
    admin
      .from("memberships")
      .select("contact_email, contact_phone, profile:profiles ( email, phone )")
      .eq("organization_id", orgId)
      .in("role", ["owner", "admin"])
      .eq("status", "active") as unknown as Promise<{
      data: Array<{
        contact_email: string | null;
        contact_phone: string | null;
        profile: { email: string | null; phone: string | null } | null;
      }> | null;
    }>,
  ]);

  const emails = new Set<string>();
  const phones = new Set<string>();
  const addEmail = (v: string | null | undefined) => {
    const e = (v ?? "").trim().toLowerCase();
    if (e.includes("@")) emails.add(e);
  };
  const addPhone = (v: string | null | undefined) => {
    const p = normalizePhone(v ?? "");
    if (/^\+\d{7,15}$/.test(p)) phones.add(p);
  };
  for (const m of people ?? []) {
    addEmail(m.contact_email ?? m.profile?.email);
    addPhone(m.profile?.phone ?? m.contact_phone);
  }
  addEmail(org?.contact_email);
  addPhone(org?.contact_phone);

  return {
    emailOn: leadAlertEmailEnabled(org?.automation_settings),
    emails: [...emails],
    phones: [...phones],
    orgName: org?.name ?? "Sollos",
  };
}

/**
 * One segment in the common case:
 * "Svit Company Inc: New lead — Jane Doe, +1 780 555 1234, Edmonton.
 *  "Deep clean, 3 bed" sollos3.com/app/leads"
 *
 * Team SMS is operational (B2B) and exempt from the consumer opt-out line.
 */
export function composeLeadAlertSms(args: {
  orgName: string;
  kind: "estimate" | "inquiry";
  name: string;
  phone?: string | null;
  email?: string | null;
  place?: string | null;
  summary?: string | null;
  path: string;
}): string {
  const who = [args.name || "Someone", args.phone?.trim() || args.email?.trim() || null, args.place?.trim() || null]
    .filter(Boolean)
    .join(", ");
  const summary = (args.summary ?? "").replace(/\s+/g, " ").trim();
  const quote = summary ? ` "${summary.length > 70 ? `${summary.slice(0, 69)}…` : summary}"` : "";
  const what = args.kind === "estimate" ? "New estimate request" : "New lead";
  return `${args.orgName}: ${what} — ${who}.${quote} sollos3.com${args.path}`;
}

/**
 * Fire-and-forget: sends the text to every target phone. sendOrgSms decides
 * whether the org may text at all; a skipped send is not an error.
 */
export function sendLeadAlertTexts(orgId: string, phones: string[], body: string): void {
  for (const to of phones) {
    sendOrgSms(orgId, { to, body, automationKey: LEAD_ALERT_SMS_KEY }).catch((err) =>
      console.error("[lead-alert] sms failed:", err),
    );
  }
}

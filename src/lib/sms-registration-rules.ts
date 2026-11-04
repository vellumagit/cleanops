/**
 * US texting registration (A2P 10DLC): what the owner tells us, the checks
 * that catch the common carrier rejections BEFORE anything is submitted
 * (a rejected brand still costs its fee), and the exact text Sollos submits
 * about the business. Pure — the Twilio calls are in twilio-a2p.ts.
 *
 * Field names and allowed values follow Twilio's ISV onboarding guide
 * (twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api and
 * .../collect-business-info, read 2026-11-03).
 */
import { isFreemailAddress } from "./freemail-domains";

export const BUSINESS_TYPES = [
  "Limited Liability Corporation",
  "Corporation",
  "Partnership",
  "Co-operative",
  "Non-profit Corporation",
] as const;

export const COMPANY_TYPES = ["private", "public", "non-profit"] as const;

export const JOB_POSITIONS = ["CEO", "GM", "Director", "VP", "CFO", "General Counsel", "Other"] as const;

/** Twilio's list. Cleaning has no category of its own; Professional services is the usual fit. */
export const INDUSTRIES = [
  "PROFESSIONAL_SERVICES",
  "CONSUMER",
  "REAL_ESTATE",
  "HOSPITALITY",
  "CONSTRUCTION",
  "RETAIL",
  "HEALTHCARE",
] as const;

/** Full allowed list, for validation. */
const ALL_INDUSTRIES = new Set([
  "AGRICULTURE", "AUTOMOTIVE", "BANKING", "CONSTRUCTION", "CONSUMER", "EDUCATION",
  "ELECTRONICS", "ENGINEERING", "ENERGY", "FAST_MOVING_CONSUMER_GOODS", "FINANCIAL",
  "FINTECH", "FOOD_AND_BEVERAGE", "GOVERNMENT", "HEALTHCARE", "HOSPITALITY", "INSURANCE",
  "JEWELRY", "LEGAL", "MANUFACTURING", "MEDIA", "NOT_FOR_PROFIT", "OIL_AND_GAS", "ONLINE",
  "PROFESSIONAL_SERVICES", "RAW_MATERIALS", "REAL_ESTATE", "RELIGION", "RETAIL",
  "TECHNOLOGY", "TELECOMMUNICATIONS", "TRANSPORTATION", "TRAVEL",
]);

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY",
  "LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH",
  "OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
] as const;

/** What the owner enters. All strings, as a form posts them. */
export type RegistrationInput = {
  legal_name: string;
  brand_name: string;
  business_type: string;
  company_type: string;
  stock_exchange: string;
  stock_ticker: string;
  ein: string;
  industry: string;
  website_url: string;
  street: string;
  street2: string;
  city: string;
  state: string;
  postal_code: string;
  rep_first_name: string;
  rep_last_name: string;
  rep_title: string;
  rep_job_position: string;
  rep_email: string;
  rep_phone: string;
  support_phone: string;
  support_email: string;
  privacy_url: string;
  terms_url: string;
};

export const EMPTY_INPUT: RegistrationInput = {
  legal_name: "", brand_name: "", business_type: "Limited Liability Corporation",
  company_type: "private", stock_exchange: "", stock_ticker: "", ein: "",
  industry: "PROFESSIONAL_SERVICES", website_url: "", street: "", street2: "", city: "",
  state: "", postal_code: "", rep_first_name: "", rep_last_name: "", rep_title: "",
  rep_job_position: "CEO", rep_email: "", rep_phone: "", support_phone: "",
  support_email: "", privacy_url: "", terms_url: "",
};

export type RegistrationErrors = Partial<Record<keyof RegistrationInput | "_form", string>>;

const trim = (s: unknown) => String(s ?? "").trim();

/** "12-3456789" from anything with exactly nine digits. */
export function normalizeEin(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 9 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : null;
}

/** "+18135551234" from a US number in any common format. */
export function normalizeUsPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  return null;
}

function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Check and normalise the owner's answers. Returns the cleaned input or the
 * errors, worded for the owner. Each check is a known reason carriers
 * reject a brand or campaign.
 */
export function validateRegistration(
  raw: Partial<RegistrationInput>,
): { ok: true; input: RegistrationInput } | { ok: false; errors: RegistrationErrors } {
  const v: RegistrationInput = { ...EMPTY_INPUT };
  for (const k of Object.keys(EMPTY_INPUT) as (keyof RegistrationInput)[]) v[k] = trim(raw[k]);
  const e: RegistrationErrors = {};

  if (v.legal_name.length < 2) e.legal_name = "Enter the business's legal name exactly as it appears on its IRS EIN letter.";
  if (!v.brand_name) v.brand_name = v.legal_name;
  if (!BUSINESS_TYPES.includes(v.business_type as never)) e.business_type = "Pick the business type.";
  if (!COMPANY_TYPES.includes(v.company_type as never)) e.company_type = "Pick private, public, or non-profit.";
  if (v.company_type === "public") {
    if (!v.stock_exchange) e.stock_exchange = "A public company needs its stock exchange.";
    if (!v.stock_ticker) e.stock_ticker = "A public company needs its ticker symbol.";
  }
  const ein = normalizeEin(v.ein);
  if (!ein) e.ein = "Enter the 9-digit EIN, like 12-3456789. Sole proprietors without an EIN can't use this form yet.";
  else v.ein = ein;
  if (!ALL_INDUSTRIES.has(v.industry)) e.industry = "Pick an industry.";

  const site = normalizeUrl(v.website_url);
  if (!site) e.website_url = "Enter the business's website. Carriers check that it loads and belongs to the business.";
  else v.website_url = site;

  if (!v.street) e.street = "Enter the street address.";
  if (!v.city) e.city = "Enter the city.";
  v.state = v.state.toUpperCase();
  if (!US_STATES.includes(v.state as never)) e.state = "Pick the state.";
  if (!/^\d{5}(-\d{4})?$/.test(v.postal_code)) e.postal_code = "Enter a 5-digit ZIP code.";

  if (!v.rep_first_name) e.rep_first_name = "Enter a first name.";
  if (!v.rep_last_name) e.rep_last_name = "Enter a last name.";
  if (!v.rep_title) e.rep_title = "Enter their job title, like Owner.";
  if (!JOB_POSITIONS.includes(v.rep_job_position as never)) e.rep_job_position = "Pick a position.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.rep_email)) e.rep_email = "Enter an email address.";
  else if (isFreemailAddress(v.rep_email))
    e.rep_email = "Use an address on the business's own domain. Carriers reject Gmail, Yahoo, Outlook and similar for business registrations.";
  const repPhone = normalizeUsPhone(v.rep_phone);
  if (!repPhone) e.rep_phone = "Enter a US phone number.";
  else v.rep_phone = repPhone;

  const supportPhone = normalizeUsPhone(v.support_phone || v.rep_phone);
  if (!supportPhone) e.support_phone = "Enter the number customers call for help.";
  else v.support_phone = supportPhone;
  if (!v.support_email) v.support_email = v.rep_email;

  for (const k of ["privacy_url", "terms_url"] as const) {
    if (!v[k]) continue;
    const u = normalizeUrl(v[k]);
    if (!u) e[k] = "Enter a full web address, or leave it blank to use the page Sollos hosts for you.";
    else v[k] = u;
  }

  return Object.keys(e).length > 0 ? { ok: false, errors: e } : { ok: true, input: v };
}

/** The Trust Hub EndUser attributes (JSON-encoded into `Attributes`). */
export function businessInfoAttributes(v: RegistrationInput) {
  return {
    business_name: v.legal_name,
    business_type: v.business_type,
    business_registration_identifier: "EIN",
    business_registration_number: v.ein,
    business_identity: "direct_customer",
    business_industry: v.industry,
    business_regions_of_operation: "USA_AND_CANADA",
    website_url: v.website_url,
    social_media_profile_urls: "",
  };
}

export function representativeAttributes(v: RegistrationInput) {
  return {
    first_name: v.rep_first_name,
    last_name: v.rep_last_name,
    email: v.rep_email,
    phone_number: v.rep_phone,
    business_title: v.rep_title,
    job_position: v.rep_job_position,
  };
}

export function messagingProfileAttributes(v: RegistrationInput) {
  return v.company_type === "public"
    ? { company_type: "public", stock_exchange: v.stock_exchange, stock_ticker: v.stock_ticker }
    : { company_type: v.company_type };
}

function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export type CampaignText = {
  useCase: "ACCOUNT_NOTIFICATION";
  description: string;
  messageFlow: string;
  samples: string[];
  optInMessage: string;
  optOutMessage: string;
  helpMessage: string;
  optInKeywords: string[];
  optOutKeywords: string[];
  helpKeywords: string[];
  privacyUrl: string;
  termsUrl: string;
};

/**
 * What Sollos tells the carriers this business will text, and how its
 * customers agree to it. Written to match what Sollos actually does: the
 * samples are its real templates, and the opt-in is its real double opt-in
 * (a "Reply YES" request, with consent only on YES). Carriers reject a
 * campaign whose samples don't name the business, so every one does.
 */
export function campaignText(
  v: RegistrationInput,
  hostedPolicy: { privacyUrl: string; termsUrl: string; appUrl: string },
): CampaignText {
  const b = v.brand_name || v.legal_name;
  const phone = formatPhone(v.support_phone);
  const privacyUrl = v.privacy_url || hostedPolicy.privacyUrl;
  const termsUrl = v.terms_url || hostedPolicy.termsUrl;
  return {
    useCase: "ACCOUNT_NOTIFICATION",
    description:
      `${b} is a residential and commercial cleaning company. It texts its own customers about their cleaning ` +
      `appointments and their account: booking confirmations, a reminder the day before a visit, notices when a ` +
      `visit is rescheduled or cancelled, and invoices and payment receipts. No marketing. Messages are sent ` +
      `through Sollos, ${b}'s scheduling software.`,
    messageFlow:
      `Customers opt in by replying YES to a consent request. When a customer books a cleaning with ${b} (by phone, ` +
      `in person, or through ${b}'s online booking form), ${b} sends one text from its number: "${b}: Reply YES to ` +
      `get appointment reminders & updates by text. Msg freq varies. Msg & data rates may apply. Reply HELP for ` +
      `help, STOP to cancel." Only a YES reply turns texts on, and the customer gets a confirmation. A customer who ` +
      `agrees in person can instead be marked as opted in by ${b} staff, who record when and how consent was given. ` +
      `Every message says "Reply STOP to opt out"; STOP ends all texts at once and HELP returns ${b}'s contact ` +
      `details. Privacy policy: ${privacyUrl} Terms: ${termsUrl}`,
    samples: [
      `${b}: Your cleaning is confirmed for Tue, Nov 11, 9:00 AM. Questions? ${phone} Reply STOP to opt out.`,
      `${b}: Reminder, your cleaning is tomorrow, Wed, Nov 12, 9:00 AM. Questions? ${phone} Reply STOP to opt out.`,
      `${b}: Your cleaning has been moved to Fri, Nov 14, 1:00 PM. Questions? ${phone} Reply STOP to opt out.`,
      `${b}: Invoice INV-1042 for $180.00 — view & pay: ${hostedPolicy.appUrl.replace(/\/$/, "")}/i/7Hq2xL Reply STOP to opt out.`,
    ],
    optInMessage: `${b}: You're subscribed to appointment updates. Msg & data rates may apply. Reply HELP for help, STOP to cancel.`,
    optOutMessage: `${b}: You're unsubscribed and won't get more texts. Reply START to resubscribe.`,
    helpMessage: `${b}: Appointment texts. For help call ${phone} or email ${v.support_email}. Reply STOP to opt out.`,
    optInKeywords: ["YES", "START"],
    optOutKeywords: ["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"],
    helpKeywords: ["HELP", "INFO"],
    privacyUrl,
    termsUrl,
  };
}

/** Twilio's stated limits on campaign text, checked before submitting. */
export function campaignTextProblems(t: CampaignText): string[] {
  const out: string[] = [];
  const len = (s: string, min: number, max: number, what: string) => {
    if (s.length < min || s.length > max) out.push(`${what} is ${s.length} characters; it must be ${min}–${max}.`);
  };
  len(t.description, 40, 4096, "The description");
  len(t.messageFlow, 40, 2048, "The opt-in description");
  if (t.samples.length < 2 || t.samples.length > 5) out.push("There must be 2 to 5 sample messages.");
  t.samples.forEach((s, i) => len(s, 20, 1024, `Sample ${i + 1}`));
  len(t.optInMessage, 20, 320, "The opt-in reply");
  len(t.optOutMessage, 20, 320, "The opt-out reply");
  len(t.helpMessage, 20, 320, "The help reply");
  return out;
}

/**
 * Which country a business texts from, from what Sollos already knows: the
 * holiday region ("US-FL", "CA-AB") first, then the time zone. Null when
 * neither says.
 */
const CANADIAN_ZONES = new Set([
  "America/Edmonton", "America/Toronto", "America/Vancouver", "America/Winnipeg",
  "America/Halifax", "America/St_Johns", "America/Regina", "America/Moncton",
  "America/Whitehorse", "America/Yellowknife", "America/Iqaluit", "America/Glace_Bay",
  "America/Goose_Bay", "America/Swift_Current", "America/Dawson_Creek", "America/Fort_Nelson",
  "America/Creston", "America/Cambridge_Bay", "America/Rankin_Inlet", "America/Atikokan",
  "America/Blanc-Sablon", "America/Dawson", "America/Inuvik", "America/Resolute",
]);
const US_ZONES = new Set([
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "America/Adak", "Pacific/Honolulu",
  "America/Detroit", "America/Boise", "America/Indiana/Indianapolis", "America/Kentucky/Louisville",
  "America/Juneau", "America/Sitka", "America/Nome", "America/Menominee",
  "America/North_Dakota/Center", "America/Indiana/Knox", "America/Metlakatla", "America/Yakutat",
]);

export function smsCountryFor(org: {
  holiday_region: string | null;
  timezone: string | null;
}): "US" | "CA" | null {
  const region = (org.holiday_region ?? "").toUpperCase();
  if (region.startsWith("US")) return "US";
  if (region.startsWith("CA")) return "CA";
  const tz = org.timezone ?? "";
  if (CANADIAN_ZONES.has(tz)) return "CA";
  if (US_ZONES.has(tz) || tz.startsWith("America/Indiana/") || tz.startsWith("America/Kentucky/")) return "US";
  return null;
}

export type RegistrationStatus =
  | "draft"
  | "submitted"
  | "brand_review"
  | "campaign_review"
  | "approved"
  | "needs_changes";

/** The owner-facing line for each stage. */
export function statusLabel(s: RegistrationStatus): string {
  switch (s) {
    case "draft":
      return "Not submitted yet";
    case "submitted":
      return "Submitting to the carriers…";
    case "brand_review":
      return "Carriers are checking your business (usually 1–3 days)";
    case "campaign_review":
      return "Carriers are reviewing what you'll text (usually 1–2 weeks)";
    case "approved":
      return "Approved — texting is on";
    case "needs_changes":
      return "Needs changes before it can be approved";
  }
}

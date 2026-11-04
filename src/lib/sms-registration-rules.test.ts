import { describe, it, expect } from "vitest";
import {
  validateRegistration,
  normalizeEin,
  normalizeUsPhone,
  campaignText,
  campaignTextProblems,
  businessInfoAttributes,
  messagingProfileAttributes,
  smsCountryFor,
  type RegistrationInput,
} from "./sms-registration-rules";

const good: Partial<RegistrationInput> = {
  legal_name: "Keep'n It Kleen LLC",
  brand_name: "Keep'n It Kleen",
  business_type: "Limited Liability Corporation",
  company_type: "private",
  ein: "12 3456789",
  industry: "PROFESSIONAL_SERVICES",
  website_url: "keepnitkleen.com",
  street: "100 Main St",
  city: "Tampa",
  state: "fl",
  postal_code: "33602",
  rep_first_name: "Dana",
  rep_last_name: "Reyes",
  rep_title: "Owner",
  rep_job_position: "CEO",
  rep_email: "dana@keepnitkleen.com",
  rep_phone: "(813) 555-0142",
};

const hosted = {
  privacyUrl: "https://sollos3.com/texting/org1/privacy",
  termsUrl: "https://sollos3.com/texting/org1/terms",
  appUrl: "https://sollos3.com",
};

describe("validateRegistration catches what carriers reject, before any fee", () => {
  it("normalises a good registration", () => {
    const r = validateRegistration(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.ein).toBe("12-3456789");
    expect(r.input.rep_phone).toBe("+18135550142");
    expect(r.input.support_phone).toBe("+18135550142");
    expect(r.input.support_email).toBe("dana@keepnitkleen.com");
    expect(r.input.state).toBe("FL");
    expect(r.input.website_url).toBe("https://keepnitkleen.com/");
  });

  it("refuses a free email address for the representative", () => {
    const r = validateRegistration({ ...good, rep_email: "dana.reyes@gmail.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.rep_email).toMatch(/own domain/);
  });

  it("refuses an EIN that isn't nine digits, and a public company without its ticker", () => {
    const r = validateRegistration({ ...good, ein: "12-34567", company_type: "public" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.ein).toBeDefined();
      expect(r.errors.stock_exchange).toBeDefined();
      expect(r.errors.stock_ticker).toBeDefined();
    }
  });

  it("refuses a non-US state, a bad ZIP, and a website that isn't one", () => {
    const r = validateRegistration({ ...good, state: "AB", postal_code: "T5J", website_url: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.state).toBeDefined();
      expect(r.errors.postal_code).toBeDefined();
      expect(r.errors.website_url).toBeDefined();
    }
  });
});

describe("normalisers", () => {
  it("EIN and US phone", () => {
    expect(normalizeEin("123456789")).toBe("12-3456789");
    expect(normalizeEin("12-345")).toBeNull();
    expect(normalizeUsPhone("1 813 555 0142")).toBe("+18135550142");
    expect(normalizeUsPhone("555-0142")).toBeNull();
  });
});

describe("what Sollos submits", () => {
  const v = (validateRegistration(good) as { ok: true; input: RegistrationInput }).input;

  it("business info uses the legal name and EIN, as a direct customer", () => {
    expect(businessInfoAttributes(v)).toMatchObject({
      business_name: "Keep'n It Kleen LLC",
      business_registration_identifier: "EIN",
      business_registration_number: "12-3456789",
      business_identity: "direct_customer",
      business_regions_of_operation: "USA_AND_CANADA",
    });
  });

  it("only a public company sends stock fields", () => {
    expect(messagingProfileAttributes(v)).toEqual({ company_type: "private" });
    expect(
      messagingProfileAttributes({ ...v, company_type: "public", stock_exchange: "NASDAQ", stock_ticker: "KIK" }),
    ).toEqual({ company_type: "public", stock_exchange: "NASDAQ", stock_ticker: "KIK" });
  });

  it("campaign text fits Twilio's limits and names the business in every sample", () => {
    const t = campaignText(v, hosted);
    expect(campaignTextProblems(t)).toEqual([]);
    for (const s of t.samples) expect(s.startsWith("Keep'n It Kleen:")).toBe(true);
    expect(t.messageFlow).toContain("Reply YES");
    expect(t.privacyUrl).toBe(hosted.privacyUrl);
    expect(t.helpMessage).toContain("(813) 555-0142");
  });

  it("uses the business's own policy pages when given", () => {
    const t = campaignText({ ...v, privacy_url: "https://keepnitkleen.com/privacy" }, hosted);
    expect(t.privacyUrl).toBe("https://keepnitkleen.com/privacy");
    expect(t.termsUrl).toBe(hosted.termsUrl);
  });
});

describe("smsCountryFor", () => {
  it("holiday region first, then time zone", () => {
    expect(smsCountryFor({ holiday_region: "US-FL", timezone: "America/Toronto" })).toBe("US");
    expect(smsCountryFor({ holiday_region: "CA-AB", timezone: null })).toBe("CA");
    expect(smsCountryFor({ holiday_region: null, timezone: "America/Edmonton" })).toBe("CA");
    expect(smsCountryFor({ holiday_region: null, timezone: "America/New_York" })).toBe("US");
    expect(smsCountryFor({ holiday_region: null, timezone: "Europe/London" })).toBeNull();
  });
});

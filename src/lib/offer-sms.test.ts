import { describe, expect, it } from "vitest";
import { composeOfferSms } from "@/lib/twilio";

/**
 * Two audiences, two different truths:
 *
 *   oncall  — external cleaner. The flat pay IS the deal, and carrier rules
 *             require the STOP disclosure on initial-contact messages.
 *   roster  — the org's own subcontractor. Paid from clocked hours at their
 *             usual rate, so the text must NOT quote the flat amount; and as
 *             operational dispatch to your own crew it carries no STOP line.
 */

const base = {
  serviceType: "deep_clean",
  scheduledAt: "2026-08-12T18:00:00.000Z",
  durationMinutes: 120,
  addressShort: "Whyte Ave",
  claimUrl: "https://sollos3.com/claim/tok",
  tz: "America/Edmonton",
};

describe("composeOfferSms — on-call (default)", () => {
  it("quotes the flat pay and carries the STOP disclosure", () => {
    const body = composeOfferSms({ ...base, payCents: 18000 });
    expect(body).toContain("$180");
    expect(body).toContain("Reply STOP to opt out");
    expect(body).toContain("deep clean");
    expect(body).toContain("Whyte Ave");
    expect(body).toContain(base.claimUrl);
  });

  it("renders the shift time in the org timezone, not UTC", () => {
    const body = composeOfferSms({ ...base, payCents: 18000 });
    expect(body).toContain("12:00 PM"); // 18:00 UTC = noon in Edmonton (MDT)
  });

  it("advertises spots on multi-position offers", () => {
    const body = composeOfferSms({
      ...base,
      payCents: 18000,
      positionsNeeded: 3,
    });
    expect(body).toContain("3 spots available");
  });
});

describe("composeOfferSms — roster subcontractor", () => {
  it("never quotes the flat pay, even when one is set on the offer", () => {
    const body = composeOfferSms({
      ...base,
      payCents: 18000,
      audience: "roster",
    });
    expect(body).not.toContain("$180");
    expect(body).toContain("Paid at your usual rate");
  });

  it("carries no STOP disclosure — operational dispatch to your own crew", () => {
    const body = composeOfferSms({ ...base, audience: "roster" });
    expect(body).not.toContain("STOP");
  });

  it("still carries the claim mechanics: link and first-come CTA", () => {
    const body = composeOfferSms({ ...base, audience: "roster" });
    expect(body).toContain(base.claimUrl);
    expect(body).toContain("First to claim gets it");
  });
});

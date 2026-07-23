import { describe, it, expect } from "vitest";
import {
  resolveClientChannels,
  summarizeClientChannels,
  type ResolveInput,
} from "./notification-preferences";

const base: ResolveInput = {
  orgDefault: "email",
  clientPref: "inherit",
  overrides: {},
  category: "booking",
  hasEmail: true,
  smsOptedIn: false,
};

describe("resolveClientChannels — do not contact", () => {
  it("sends nothing regardless of everything else", () => {
    const r = resolveClientChannels({
      ...base,
      clientPref: "do_not_contact",
      orgDefault: "both",
      hasEmail: true,
      smsOptedIn: true,
    });
    expect(r).toEqual({ email: false, sms: false, reason: "do_not_contact" });
  });
});

describe("resolveClientChannels — inherit org default", () => {
  it("email default → email (client has email)", () => {
    expect(resolveClientChannels(base)).toMatchObject({ email: true, sms: false, reason: "ok" });
  });
  it("none default → nothing", () => {
    expect(resolveClientChannels({ ...base, orgDefault: "none" })).toMatchObject({
      email: false,
      sms: false,
      reason: "category_off",
    });
  });
  it("both default, opted in → email + sms", () => {
    expect(
      resolveClientChannels({ ...base, orgDefault: "both", smsOptedIn: true }),
    ).toMatchObject({ email: true, sms: true, reason: "ok" });
  });
});

describe("resolveClientChannels — consent gating (no fallback)", () => {
  it("sms preference but NOT opted in → nothing, reason sms_not_opted_in", () => {
    expect(
      resolveClientChannels({ ...base, orgDefault: "sms", smsOptedIn: false }),
    ).toEqual({ email: false, sms: false, reason: "sms_not_opted_in" });
  });
  it("sms preference AND opted in → sms only (no email even if present)", () => {
    expect(
      resolveClientChannels({ ...base, orgDefault: "sms", smsOptedIn: true, hasEmail: true }),
    ).toMatchObject({ email: false, sms: true, reason: "ok" });
  });
  it("both preference but no sms opt-in → email only, still reason ok", () => {
    expect(
      resolveClientChannels({ ...base, orgDefault: "both", smsOptedIn: false }),
    ).toMatchObject({ email: true, sms: false, reason: "ok" });
  });
  it("email preference but no email address → nothing, reason no_email_address", () => {
    expect(
      resolveClientChannels({ ...base, orgDefault: "email", hasEmail: false }),
    ).toEqual({ email: false, sms: false, reason: "no_email_address" });
  });
  it("both preference, no email AND no sms opt-in → nothing, no_reachable_channel", () => {
    expect(
      resolveClientChannels({ ...base, orgDefault: "both", hasEmail: false, smsOptedIn: false }),
    ).toEqual({ email: false, sms: false, reason: "no_reachable_channel" });
  });
});

describe("resolveClientChannels — custom per-category overrides", () => {
  const custom: ResolveInput = {
    ...base,
    clientPref: "custom",
    smsOptedIn: true,
    hasEmail: true,
    overrides: { booking: "sms", billing: "email", growth: "off" },
  };
  it("booking → sms", () => {
    expect(resolveClientChannels({ ...custom, category: "booking" })).toMatchObject({ email: false, sms: true });
  });
  it("billing → email", () => {
    expect(resolveClientChannels({ ...custom, category: "billing" })).toMatchObject({ email: true, sms: false });
  });
  it("growth → off (nothing)", () => {
    expect(resolveClientChannels({ ...custom, category: "growth" })).toMatchObject({
      email: false,
      sms: false,
      reason: "category_off",
    });
  });
  it("a category with no override falls back to org default", () => {
    expect(
      resolveClientChannels({
        ...custom,
        overrides: { booking: "sms" }, // billing/growth unset
        category: "billing",
        orgDefault: "email",
      }),
    ).toMatchObject({ email: true, sms: false });
  });
  it("explicit 'inherit' override resolves to org default", () => {
    expect(
      resolveClientChannels({
        ...custom,
        overrides: { booking: "inherit" },
        category: "booking",
        orgDefault: "both",
      }),
    ).toMatchObject({ email: true, sms: true });
  });
});

describe("summarizeClientChannels — the 'what sends' preview", () => {
  it("returns a resolution for all three categories", () => {
    const s = summarizeClientChannels({
      orgDefault: "email",
      clientPref: "custom",
      overrides: { booking: "sms", billing: "email", growth: "off" },
      hasEmail: true,
      smsOptedIn: true,
    });
    expect(s.booking).toMatchObject({ sms: true, email: false });
    expect(s.billing).toMatchObject({ email: true, sms: false });
    expect(s.growth.reason).toBe("category_off");
  });
});

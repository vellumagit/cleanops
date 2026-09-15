import { describe, expect, it } from "vitest";
import { isFreemailAddress } from "./freemail-domains";

describe("isFreemailAddress", () => {
  it("catches the providers a small business owner actually uses", () => {
    expect(isFreemailAddress("svitlana@gmail.com")).toBe(true);
    expect(isFreemailAddress("owner@hotmail.com")).toBe(true);
    expect(isFreemailAddress("owner@hotmail.ca")).toBe(true);
    expect(isFreemailAddress("owner@outlook.com")).toBe(true);
    expect(isFreemailAddress("owner@yahoo.ca")).toBe(true);
    expect(isFreemailAddress("owner@icloud.com")).toBe(true);
    expect(isFreemailAddress("owner@aol.com")).toBe(true);
    expect(isFreemailAddress("owner@proton.me")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isFreemailAddress("Owner@GMAIL.COM")).toBe(true);
    expect(isFreemailAddress("  owner@Gmail.Com  ")).toBe(true);
  });

  it("counts sub-domains of a listed provider", () => {
    expect(isFreemailAddress("a@mail.yandex.ru")).toBe(true);
  });

  it("leaves ISP mailboxes alone — they are not freemail", () => {
    // These must stay OUT of the list. Listing them would strip Reply-To
    // and cost the org its client replies for no deliverability gain,
    // because SpamAssassin does not treat them as freemail either.
    expect(isFreemailAddress("owner@shaw.ca")).toBe(false);
    expect(isFreemailAddress("owner@rogers.com")).toBe(false);
    expect(isFreemailAddress("owner@sympatico.ca")).toBe(false);
    expect(isFreemailAddress("owner@telus.net")).toBe(false);
    expect(isFreemailAddress("owner@videotron.ca")).toBe(false);
    expect(isFreemailAddress("owner@bell.net")).toBe(false);
    expect(isFreemailAddress("owner@cogeco.ca")).toBe(false);
  });

  it("leaves business domains alone", () => {
    expect(isFreemailAddress("svitlana@svitcompany.ca")).toBe(false);
    expect(isFreemailAddress("brian@sollos3.com")).toBe(false);
    expect(isFreemailAddress("hello@velluma.co")).toBe(false);
  });

  it("does not trip on a business domain that merely contains a provider name", () => {
    expect(isFreemailAddress("owner@gmail-cleaning.com")).toBe(false);
    expect(isFreemailAddress("owner@notgmail.com")).toBe(false);
  });

  it("handles missing and malformed input", () => {
    expect(isFreemailAddress("")).toBe(false);
    expect(isFreemailAddress(null)).toBe(false);
    expect(isFreemailAddress(undefined)).toBe(false);
    expect(isFreemailAddress("nope")).toBe(false);
  });
});

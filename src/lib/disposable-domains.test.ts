import { describe, expect, it } from "vitest";
import { isDisposableEmail, emailDomain } from "./disposable-domains";

describe("isDisposableEmail", () => {
  it("catches the Sep 11 spammer's domains", () => {
    expect(isDisposableEmail("nivefa4979@airhemp.com")).toBe(true);
    expect(isDisposableEmail("sweetac@yopmail.com")).toBe(true);
    expect(isDisposableEmail("xalor27849@94an.com")).toBe(true);
    expect(isDisposableEmail("x@Mailinator.COM")).toBe(true);
  });
  it("counts sub-domains of a listed domain", () => {
    expect(isDisposableEmail("a@mail.yopmail.com")).toBe(true);
  });
  it("leaves real mail alone", () => {
    expect(isDisposableEmail("svitlana@svitcompany.ca")).toBe(false);
    expect(isDisposableEmail("someone@gmail.com")).toBe(false);
    expect(isDisposableEmail("someone@hotmail.com")).toBe(false);
    expect(isDisposableEmail("")).toBe(false);
    expect(isDisposableEmail(null)).toBe(false);
  });
  it("emailDomain", () => {
    expect(emailDomain("A@B.CO")).toBe("b.co");
    expect(emailDomain("nope")).toBe(null);
  });
});

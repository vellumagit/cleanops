import { describe, expect, it, vi } from "vitest";
import { friendlyAuthError, isExistingAccountSignup } from "./auth-errors";

describe("friendlyAuthError", () => {
  it("answers the expected cases in plain words", () => {
    expect(friendlyAuthError({ code: "invalid_credentials", message: "Invalid login credentials" }, "sign-in")).toMatch(/don't match/);
    expect(friendlyAuthError({ message: "Invalid login credentials" }, "sign-in")).toMatch(/don't match/);
    expect(friendlyAuthError({ code: "email_not_confirmed" }, "sign-in")).toMatch(/Confirm your email/);
    expect(friendlyAuthError({ status: 429, message: "x" }, "sign-in")).toMatch(/Too many attempts/);
    expect(friendlyAuthError({ code: "weak_password", message: "Password should be at least 8 characters." }, "sign-up")).toBe(
      "Password should be at least 8 characters.",
    );
  });

  it("never repeats an unexpected server message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = friendlyAuthError({ code: "unexpected_failure", message: 'relation "auth.users" violates something' }, "sign-up");
    expect(out).not.toContain("auth.users");
    expect(out).toMatch(/Something went wrong/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not say whether an account exists", () => {
    // The signup path never shows this one (it redirects), but if it ever
    // reached here it must not confirm the account.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(friendlyAuthError({ code: "user_already_exists", message: "User already registered" }, "sign-up")).not.toMatch(
      /already|registered|exists/i,
    );
    spy.mockRestore();
  });
});

describe("isExistingAccountSignup", () => {
  it("recognises both ways Supabase reports an existing email", () => {
    expect(isExistingAccountSignup({ code: "user_already_exists", message: "User already registered" }, null)).toBe(true);
    expect(isExistingAccountSignup({ message: "User already registered" }, null)).toBe(true);
    // Confirmations on: a stand-in user with no identities, and no error.
    expect(isExistingAccountSignup(null, { identities: [] })).toBe(true);
  });

  it("is false for a real new account and for other errors", () => {
    expect(isExistingAccountSignup(null, { identities: [{ id: "x" }] })).toBe(false);
    expect(isExistingAccountSignup({ code: "weak_password", message: "too short" }, null)).toBe(false);
    expect(isExistingAccountSignup(null, null)).toBe(false);
  });
});

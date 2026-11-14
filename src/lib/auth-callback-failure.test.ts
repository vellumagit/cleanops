import { describe, expect, it } from "vitest";
import { authCallbackFailure, isAuthCallbackFailure } from "./auth-callback-failure";

describe("authCallbackFailure", () => {
  it("a confirm link opened in another browser: the email is confirmed, sign in", () => {
    expect(authCallbackFailure("pkce_code_verifier_not_found", "/app")).toBe("other_browser");
    expect(authCallbackFailure("pkce_code_verifier_not_found", "/field")).toBe("other_browser");
  });

  it("a reset link opened in another browser needs a new link", () => {
    expect(authCallbackFailure("pkce_code_verifier_not_found", "/reset-password")).toBe("reset_other_browser");
  });

  it("anything else is a used or expired link", () => {
    expect(authCallbackFailure("otp_expired", "/app")).toBe("confirmation_failed");
    expect(authCallbackFailure(undefined, "/app")).toBe("confirmation_failed");
  });

  it("only known reasons are read back from the URL", () => {
    expect(isAuthCallbackFailure("other_browser")).toBe(true);
    expect(isAuthCallbackFailure("confirmation_failed")).toBe(true);
    expect(isAuthCallbackFailure("<script>")).toBe(false);
    expect(isAuthCallbackFailure(undefined)).toBe(false);
  });
});

/**
 * Why an email link failed at /auth/callback, as the login page explains it.
 *
 * The common case is not an expired link. Supabase confirms the address
 * when its own /verify endpoint opens the link, then hands us a code that
 * only the browser that signed up can exchange for a session (it holds the
 * PKCE verifier cookie). Open the email on a phone after signing up on a
 * computer and the address IS confirmed, but the exchange fails. Until
 * 2026-11-14 that showed "the link may have expired", and promised a new
 * confirmation email that signing in never sends.
 */
export type AuthCallbackFailure = "other_browser" | "reset_other_browser" | "confirmation_failed";

export function authCallbackFailure(
  exchangeErrorCode: string | undefined,
  next: string,
): AuthCallbackFailure {
  if (exchangeErrorCode === "pkce_code_verifier_not_found") {
    // A reset link's token is spent by the time it gets here, so a new
    // one is the only way on; a signup or email-change link has already
    // done its job.
    return next === "/reset-password" ? "reset_other_browser" : "other_browser";
  }
  return "confirmation_failed";
}

export function isAuthCallbackFailure(v: string | undefined): v is AuthCallbackFailure {
  return v === "other_browser" || v === "reset_other_browser" || v === "confirmation_failed";
}

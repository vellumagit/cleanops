/**
 * What a person sees when Supabase Auth says no.
 *
 * Login and signup used to show the auth server's own message. Most of those
 * are harmless, but "User already registered" tells anyone typing an address
 * that it has an account, and unknown failures leaked whatever the server
 * said. Each code we expect gets a sentence written for a person; anything
 * else gets a generic line, and the real message goes to the server log.
 *
 * Pure (no server-only) so the client portal's browser-side sign-in uses it
 * too.
 */

export type AuthErrorLike = { code?: string | null; message?: string | null; status?: number | null };

const GENERIC = "Something went wrong on our side. Try again in a minute.";

export function friendlyAuthError(err: AuthErrorLike | null | undefined, where: "sign-in" | "sign-up" | "magic-link"): string {
  const code = err?.code ?? "";
  const message = err?.message ?? "";

  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    // Supabase gives the same answer for a wrong password and an unknown email.
    return "That email and password don't match. Check them, or reset your password.";
  }
  if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) {
    return "Confirm your email first: open the link we sent you, then sign in.";
  }
  if (
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    err?.status === 429 ||
    /rate limit/i.test(message)
  ) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (code === "weak_password") {
    // Describes the password rule; says nothing about any account.
    return message || "Choose a stronger password.";
  }
  if (code === "email_address_invalid" || code === "validation_failed") {
    return "That email address doesn't look right.";
  }
  if (code === "signup_disabled") {
    return "New accounts can't be created right now. Write to support@sollos3.com.";
  }
  if (code === "user_banned") {
    return "This account can't sign in. Write to support@sollos3.com.";
  }

  console.error(`[auth] ${where} failed:`, code || "(no code)", message);
  return GENERIC;
}

/**
 * Whether a sign-up attempt hit an email that already has an account. Supabase
 * reports it in one of two ways depending on the project's confirmation
 * settings: an error ("User already registered" / user_already_exists), or a
 * stand-in user with no identities and no error. Treat both the same, and
 * NEVER act on that stand-in user (create a company for it, delete it).
 */
export function isExistingAccountSignup(
  err: AuthErrorLike | null | undefined,
  user: { identities?: unknown[] | null } | null | undefined,
): boolean {
  if (err) {
    return (
      err.code === "user_already_exists" ||
      err.code === "email_exists" ||
      /already registered|already exists/i.test(err.message ?? "")
    );
  }
  return Boolean(user && Array.isArray(user.identities) && user.identities.length === 0);
}

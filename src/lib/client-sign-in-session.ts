import "server-only";

import { randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { authUserExistsForEmail } from "@/lib/portal-claim";

/**
 * The four things the client sign-in needs from the auth server, and nothing
 * else: make a login, mint a one-time sign-in token for it, turn that token
 * into a signed-in session, and scramble a password.
 *
 * Kept apart from the rules (lib/client-sign-in.ts) so the rules can be
 * tested on a real database with these four stood in for: the test stack has
 * no auth server.
 */
type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** A login for this email, made if there isn't one. No password is set. */
export async function ensureLogin(admin: Admin, email: string, name: string): Promise<{ ok: true } | { ok: false }> {
  if (await authUserExistsForEmail(admin, email)) return { ok: true };
  const { error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: name, is_client: true },
  });
  if (error) {
    // Two requests at once: the other one made it.
    if (/already (been )?registered|email_exists/i.test(`${error.message} ${error.code ?? ""}`)) return { ok: true };
    console.error("[client-sign-in] could not create a login:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

/** A one-time token that signs this email's login in. Good for an hour, once. */
export async function mintSignInToken(admin: Admin, email: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const token = data?.properties?.hashed_token;
  if (error || !token) {
    console.error("[client-sign-in] could not mint a sign-in token:", error?.message ?? "no token returned");
    return null;
  }
  return token;
}

/**
 * Spend the token: the browser making this request is now signed in as the
 * login the token was minted for. Returns who that is. Null when the token
 * is wrong, used or expired.
 */
export async function openSession(tokenHash: string): Promise<{ userId: string; email: string } | null> {
  const supabase = await createSupabaseServerClient();
  let { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error) {
    // Newer auth servers call the same token type "email".
    ({ data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" }));
  }
  const user = data?.user;
  if (error || !user?.id || !user.email) return null;
  return { userId: user.id, email: user.email.toLowerCase() };
}

/** Replace whatever password this login has with one nobody knows. */
export async function scramblePassword(admin: Admin, userId: string): Promise<void> {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: randomBytes(32).toString("base64url"),
  });
  if (error) console.error("[client-sign-in] could not scramble a password:", error.message);
}

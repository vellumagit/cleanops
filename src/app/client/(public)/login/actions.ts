"use server";

import { checkEmailRateLimit, checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { sendClientSignInLink } from "@/lib/client-sign-in";
import { enterFailClosed } from "@/lib/supabase/query-guard";

/**
 * "Email me a link": the client sign-in page's one button.
 *
 * Always answers the same way for an address that looks like one, whether or
 * not it is on anyone's books, so the page can't be used to find out who a
 * company's clients are. Limits per address and per connection keep it from
 * being used to flood someone's inbox.
 */
export type SignInLinkState = { sentTo?: string; error?: string };

export async function requestClientSignInAction(_prev: SignInLinkState, formData: FormData): Promise<SignInLinkState> {
  // A read that fails must stop here, not read as "nobody has that email".
  enterFailClosed();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { error: "That doesn't look like an email address. Check it and try again." };
  }

  const byIp = await checkIpRateLimit("client-sign-in", 12, 15 * 60_000);
  const byEmail = await checkEmailRateLimit("client-sign-in", email, 4, 15 * 60_000);
  if (!byIp.allowed || !byEmail.allowed) {
    return { error: "That's a lot of tries. Wait a few minutes, then ask for a link again. The last link we sent still works." };
  }

  try {
    await sendClientSignInLink(email);
  } catch (err) {
    // Said to the log, not the page: an error for one address and not
    // another would tell a stranger which one is a client.
    console.error("[client-sign-in] sending the link failed:", err);
  }
  return { sentTo: email };
}

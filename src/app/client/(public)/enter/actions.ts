"use server";

import { redirect } from "next/navigation";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { completeClientSignIn } from "@/lib/client-sign-in";
import { enterFailClosed } from "@/lib/supabase/query-guard";

/**
 * The button on /client/enter. The link in the email only OPENS that page;
 * this press is what spends the one-time token and signs the person in.
 *
 * Why a press and not the link itself: mail programs and security scanners
 * open every link in an email before the person does. A link that signed in
 * on being opened would be used up by the scanner, and the client would find
 * it already expired.
 */
export async function enterClientAreaAction(formData: FormData): Promise<void> {
  // A read that fails must stop here: connecting a login to a client record
  // on the back of a dropped error is the one thing this must never do.
  enterFailClosed();
  const token = String(formData.get("t") ?? "");
  const limit = await checkIpRateLimit("client-enter", 30, 15 * 60_000);
  if (!limit.allowed) redirect("/client/login?link=wait");

  let result: Awaited<ReturnType<typeof completeClientSignIn>>;
  try {
    result = await completeClientSignIn(token);
  } catch (err) {
    console.error("[client-sign-in] finishing sign-in failed:", err);
    redirect("/client/login?link=expired");
  }
  if (result.ok) redirect("/client");
  redirect(result.reason === "no-client" ? "/client/login?link=no-client" : "/client/login?link=expired");
}

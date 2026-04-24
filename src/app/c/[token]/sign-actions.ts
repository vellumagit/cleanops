"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { headers } from "next/headers";

export type SignContractState = {
  error?: string;
  ok?: boolean;
};

/**
 * Public server action: record the client's agreement to a contract
 * identified by its public token. Mirrors /i/[token] — no auth, token
 * gates access, IP rate limit stops enumeration.
 *
 * Records:
 *   - signer_name (typed full name — the intent-to-sign evidence)
 *   - signed_at (server-side timestamp)
 *   - signer_ip (from request headers)
 *   - signer_user_agent (from request headers)
 *
 * Legally sufficient under ESIGN Act + UETA when paired with the
 * "I agree" checkbox on the sign page. Adds a user_agent for
 * additional evidence.
 */
export async function signContractAction(
  _prev: SignContractState,
  formData: FormData,
): Promise<SignContractState> {
  const token = String(formData.get("token") ?? "").trim();
  const typedName = String(formData.get("signer_name") ?? "").trim();
  const agreed = String(formData.get("agree") ?? "") === "on";

  if (!token || token.length < 8) {
    return { error: "Invalid signing link." };
  }
  if (!typedName) {
    return { error: "Type your full name to sign." };
  }
  if (typedName.length > 200) {
    return { error: "Name is too long." };
  }
  if (!agreed) {
    return { error: "Check the agreement box to proceed." };
  }

  // Very aggressive rate limit — real signers click once, maybe twice.
  // A bot spraying the endpoint is never legit.
  const rl = await checkIpRateLimit("contract-sign", 5, 60_000);
  if (!rl.allowed) {
    return {
      error: "Too many attempts in a short time. Wait a minute and retry.",
    };
  }

  const admin = createSupabaseAdminClient();

  const { data: contract, error: fetchErr } = (await admin
    .from("contracts")
    .select("id, sign_status, signed_at")
    .eq("public_token" as never, token as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      sign_status: string;
      signed_at: string | null;
    } | null;
    error: { message: string } | null;
  };

  if (fetchErr) {
    console.error("[contract-sign] fetch failed:", fetchErr.message);
    return {
      error: "Couldn't load this contract. Try the link again in a moment.",
    };
  }
  if (!contract) return { error: "Contract not found." };
  if (contract.sign_status === "signed") {
    // Already signed — this is a re-submit of the form. Idempotent
    // success so a double-click doesn't confuse the client.
    return { ok: true };
  }
  if (contract.sign_status === "declined") {
    return {
      error: "This contract was previously declined. Contact the sender.",
    };
  }

  // Grab request signals for evidence (ESIGN / UETA).
  const h = await headers();
  // x-forwarded-for is a comma-separated list on Vercel; first IP is
  // the originating client.
  const forwardedFor = h.get("x-forwarded-for");
  const signerIp =
    forwardedFor?.split(",")[0].trim() ||
    h.get("x-real-ip") ||
    null;
  const userAgent = h.get("user-agent");

  const { error: updateErr } = await admin
    .from("contracts")
    .update({
      sign_status: "signed",
      signed_at: new Date().toISOString(),
      signer_name: typedName,
      signer_ip: signerIp,
      signer_user_agent: userAgent?.slice(0, 500) ?? null,
    } as never)
    .eq("id", contract.id);

  if (updateErr) {
    console.error("[contract-sign] update failed:", updateErr.message);
    return {
      error:
        "Couldn't record your signature. Try again — if it persists, contact the sender.",
    };
  }

  // Redirect to a success page so the Sign button doesn't stay live
  // if the user refreshes. The page re-fetches the now-signed state
  // and renders the thank-you view.
  redirect(`/c/${token}?signed=1`);
}

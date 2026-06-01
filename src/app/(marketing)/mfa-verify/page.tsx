import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MfaVerifyForm } from "./mfa-verify-form";

export const metadata = { title: "Verify your sign-in" };

/**
 * Post-password MFA challenge.
 *
 * When a user signs in with email + password and they have a verified
 * TOTP factor on their account, Supabase puts the session at `aal1` —
 * authenticated but not multi-factor. They need to clear an MFA
 * challenge to reach `aal2`, which is what every authed page implicitly
 * requires for MFA-enrolled users.
 *
 * Flow:
 *   1. User submits login form → password verified → session = aal1
 *   2. Server-side check in the login action redirects here when:
 *      a. They have at least one verified TOTP factor, AND
 *      b. Their current session is still aal1 (not yet promoted)
 *   3. This page asks for a 6-digit code, calls mfa.challenge +
 *      mfa.verify to promote the session to aal2
 *   4. On success, redirects to the original destination
 *
 * Users WITHOUT a verified TOTP factor never see this page — MFA is
 * opt-in.
 */
export default async function MfaVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const verifiedFactors = (factorsData?.totp ?? []).filter(
    (f) => f.status === "verified",
  );

  // No factors enrolled → MFA was disabled in another tab, just bounce
  // them to the app. Already-verified (aal2) → also bounce.
  if (verifiedFactors.length === 0 || aalData?.currentLevel === "aal2") {
    redirect("/app");
  }

  const { next } = await searchParams;
  const nextPath = isSafeNext(next) ? next! : "/app";

  // Pass ALL verified factors, not just the first. Users with a backup
  // device added (after losing access to the primary) need to pick
  // which one they have in hand right now. Sorted by created_at
  // ascending — primary first, backups after — so the default
  // selection matches the historical behavior.
  const factors = verifiedFactors
    .slice()
    .sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    })
    .map((f) => ({
      id: f.id,
      friendlyName: f.friendly_name ?? "Authenticator",
    }));

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <MfaVerifyForm factors={factors} nextPath={nextPath} />
    </div>
  );
}

function isSafeNext(p: string | undefined): boolean {
  if (!p) return false;
  // Same allowlist style as the login page — no open redirects.
  return (
    p === "/app" ||
    p.startsWith("/app/") ||
    p === "/field" ||
    p.startsWith("/field/")
  );
}

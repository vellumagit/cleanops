/**
 * Auth callback route handler.
 *
 * Supabase redirects here after the user clicks an email confirmation link
 * or completes an OAuth flow. We exchange the `code` query parameter for a
 * session and then bounce them into the app.
 *
 * Also handles the `token_hash` + `type` pattern used by Supabase for
 * email confirmation links (PKCE flow sends a code, but email OTP
 * confirmation sometimes uses token_hash instead).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as
    | "signup"
    | "email"
    | "recovery"
    | "invite"
    | "magiclink"
    | null;
  const next = url.searchParams.get("next") ?? "/app";

  const supabase = await createSupabaseServerClient();

  // ── Method 1: PKCE code exchange (OAuth, magic-link, etc.) ──
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const redirectUrl = url.clone();
      redirectUrl.pathname =
        next.startsWith("/") && !next.startsWith("//") ? next : "/app";
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
  }

  // ── Method 2: Token hash verification (email confirmation) ──
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      const redirectUrl = url.clone();
      redirectUrl.pathname =
        type === "recovery" ? "/reset-password" : next.startsWith("/") && !next.startsWith("//") ? next : "/app";
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }
    console.error("[auth/callback] verifyOtp failed:", error.message);
  }

  // ── Fallback — bounce to login with the actual error ──
  const loginUrl = url.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "?auth_error=confirmation_failed";
  return NextResponse.redirect(loginUrl);
}

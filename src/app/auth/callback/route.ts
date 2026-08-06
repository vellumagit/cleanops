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
    "signup" | "email" | "recovery" | "invite" | "magiclink" | null;
  const next = url.searchParams.get("next") ?? "/app";
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  // Clients and staff share this route but not their sign-in pages, so a
  // failure has to bounce to the right one. Without this a client whose
  // recovery link expired landed on the staff /login, which cannot help them.
  const isClientFlow = safeNext.startsWith("/client");

  const supabase = await createSupabaseServerClient();

  // ── Method 1: PKCE code exchange (OAuth, magic-link, etc.) ──
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const redirectUrl = url.clone();
      redirectUrl.pathname = safeNext;
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }
    console.error(
      "[auth/callback] exchangeCodeForSession failed:",
      error.message,
    );
  }

  // ── Method 2: Token hash verification (email confirmation) ──
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      const redirectUrl = url.clone();
      // An explicit `next` wins even for recovery. This used to hardcode the
      // staff /reset-password, so a CLIENT resetting their password was sent
      // to a page that resolves staff sessions and could never complete.
      redirectUrl.pathname =
        type === "recovery" && next === "/app" ? "/reset-password" : safeNext;
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }
    console.error("[auth/callback] verifyOtp failed:", error.message);
  }

  // ── Fallback — bounce to login with the actual error ──
  const loginUrl = url.clone();
  loginUrl.pathname = isClientFlow ? "/client/login" : "/login";
  loginUrl.search = "?auth_error=confirmation_failed";
  return NextResponse.redirect(loginUrl);
}

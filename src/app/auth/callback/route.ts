/**
 * Auth callback route handler.
 *
 * Supabase redirects here after the user clicks an email confirmation link
 * or completes an OAuth flow. We exchange the `code` query parameter for a
 * session and then bounce them into the app.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/app";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const redirectUrl = url.clone();
      redirectUrl.pathname = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Fallback — bounce to login with an error flag
  const loginUrl = url.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "?auth_error=1";
  return NextResponse.redirect(loginUrl);
}

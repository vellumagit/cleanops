/**
 * Logout route — POST only.
 *
 * IMPORTANT: This MUST NOT be reachable via GET. If it were, the Next.js
 * <Link> prefetcher would silently sign the user out the instant a logout
 * link mounted in the viewport (e.g. the sidebar user chip), because the
 * prefetch request executes the handler and the resulting Set-Cookie
 * headers are applied to the user's browser.
 *
 * All logout UI must be a <form method="POST" action="/auth/logout">.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url, { status: 303 });
}

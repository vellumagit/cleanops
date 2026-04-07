/**
 * Logout route. POST or GET both work; we accept both so a simple
 * <Link href="/auth/logout"> from the sidebar can sign the user out.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function handle(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const GET = handle;
export const POST = handle;

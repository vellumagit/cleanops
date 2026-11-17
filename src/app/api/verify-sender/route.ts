import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enterFailClosed } from "@/lib/supabase/query-guard";
import { rateLimitByIp } from "@/lib/rate-limit-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/verify-sender?token=xxx&org=yyy
 *
 * Called when a user clicks the verification link in their inbox.
 * Marks the org's sender_email as verified if the token matches.
 */
export async function GET(req: NextRequest) {
  enterFailClosed();
  // 10 requests/min/IP. Legit flow hits this once; anything more is brute force.
  const limited = await rateLimitByIp(req, "verify-sender", 10, 60_000);
  if (limited) return limited;

  const token = req.nextUrl.searchParams.get("token");
  const orgId = req.nextUrl.searchParams.get("org");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  if (!token || !orgId) {
    return NextResponse.redirect(
      `${siteUrl}/app/settings/email?verified=invalid`,
    );
  }

  const admin = createSupabaseAdminClient();

  // Look up the org with the matching token
  const { data: org } = await admin
    .from("organizations")
    .select("id, sender_email, sender_email_token")
    .eq("id", orgId)
    .maybeSingle();

  const orgRow = org as {
    id: string;
    sender_email: string | null;
    sender_email_token: string | null;
  } | null;

  // "Expires in 24 hours", the email says. The issue time is the part of
  // the token before the dot; a link without one predates expiry and is
  // refused the same way (the owner presses Save again for a fresh link).
  const issuedMs = token.includes(".") ? parseInt(token.split(".")[0], 36) : NaN;
  const expired = !Number.isFinite(issuedMs) || Date.now() - issuedMs > 24 * 60 * 60 * 1000;

  if (!orgRow || orgRow.sender_email_token !== token || expired) {
    return NextResponse.redirect(
      `${siteUrl}/app/settings/email?verified=invalid`,
    );
  }

  // Mark as verified, clear the token (single-use)
  await admin
    .from("organizations")
    .update({
      sender_email_verified_at: new Date().toISOString(),
      sender_email_token: null,
    } as never)
    .eq("id", orgId);

  return NextResponse.redirect(
    `${siteUrl}/app/settings/email?verified=success`,
  );
}

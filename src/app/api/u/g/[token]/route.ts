/**
 * One-click unsubscribe endpoint for the Google-review email track (RFC 8058).
 *
 *   POST /api/u/g/<token>  →  Mailbox providers (Gmail/Yahoo) call this when a
 *                             user clicks the native "Unsubscribe" affordance,
 *                             per the List-Unsubscribe-Post header we set on the
 *                             email. Performs the opt-out and returns 200.
 *   GET  /api/u/g/<token>   →  A human opening the header URL directly; opt out
 *                             and redirect to the friendly confirmation page.
 *
 * Shares the same opt-out logic as the /u/g/<token> page via
 * unsubscribeGbpByToken so the two never drift.
 */

import { NextResponse, type NextRequest } from "next/server";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { unsubscribeGbpByToken } from "@/lib/gbp-unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  // Same IP cap as the page — blocks token-guessing enumeration.
  const rl = await checkIpRateLimit("gbp-unsubscribe", 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const result = await unsubscribeGbpByToken(token);
  // Always 200 for one-click — providers treat non-2xx as a failed unsubscribe
  // and may downrank the sender; an invalid token is not the recipient's fault.
  return NextResponse.json({ ok: result.ok });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const rl = await checkIpRateLimit("gbp-unsubscribe", 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  await unsubscribeGbpByToken(token);
  // Send humans to the friendly confirmation page.
  return NextResponse.redirect(new URL(`/u/g/${token}`, req.url));
}

/**
 * One-click unsubscribe for the Sollos product-changelog email (RFC 8058).
 *
 *   POST /api/u/p/<token>  →  Gmail/Yahoo call this from the List-Unsubscribe
 *                             header. Must always 200 — providers treat a
 *                             non-2xx as a failed unsubscribe and may penalise
 *                             sender reputation.
 *   GET  /api/u/p/<token>  →  A human opening the link; opt out, then show a
 *                             short confirmation.
 *
 * Opting out here is per-PERSON: it never disables the org's automation for
 * anyone else on the team.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { unsubscribeProductUpdatesByToken } from "@/lib/product-changelog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  // Same cap as the other unsubscribe route — blocks token enumeration.
  const rl = await checkIpRateLimit("product-unsubscribe", 30, 60_000);
  if (rl) return NextResponse.json({ ok: true });

  await unsubscribeProductUpdatesByToken(token);
  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const rl = await checkIpRateLimit("product-unsubscribe", 30, 60_000);
  if (rl) {
    return new NextResponse("Too many requests. Try again shortly.", {
      status: 429,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const ok = await unsubscribeProductUpdatesByToken(token);
  const message = ok
    ? "You're unsubscribed from Sollos product updates. You'll still receive account and billing email."
    : "That unsubscribe link isn't valid. It may have already been used.";

  return new NextResponse(
    `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#111827;">
      <h1 style="font-size:18px;font-weight:600;">Product updates</h1>
      <p style="font-size:14px;line-height:1.6;color:#4b5563;">${message}</p>
    </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

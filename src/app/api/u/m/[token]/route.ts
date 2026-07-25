/**
 * One-click unsubscribe from an org's MARKETING emails (rebooking nudges and
 * other growth-category sends), RFC 8058.
 *
 *   POST /api/u/m/<token>  →  mailbox providers' one-click (must always 200)
 *   GET  /api/u/m/<token>  →  a human clicking the footer link
 *
 * Token: clients.gbp_unsubscribe_token (shared marketing token; minted lazily
 * by whichever growth email needs it first).
 *
 * Effect: sets the client's growth category to "off" via the per-client
 * notification preferences — booking and billing messages are untouched, so
 * confirmations, reminders, and invoices keep flowing. An `inherit` client
 * becomes `custom` with only growth overridden.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function unsubscribeMarketingByToken(token: string): Promise<boolean> {
  if (!token || token.length < 8) return false;
  const db = createSupabaseAdminClient();

  const { data: client } = (await db
    .from("clients")
    .select("id, contact_preference, contact_overrides")
    .eq("gbp_unsubscribe_token" as never, token as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      contact_preference: string | null;
      contact_overrides: Record<string, string> | null;
    } | null;
  };
  if (!client) return false;

  // do_not_contact already blocks everything — nothing to change.
  if (client.contact_preference === "do_not_contact") return true;

  const overrides = { ...(client.contact_overrides ?? {}), growth: "off" };
  const { error } = await db
    .from("clients")
    .update({
      contact_preference: "custom",
      contact_overrides: overrides,
    } as never)
    .eq("id", client.id);
  if (error) {
    console.error("[u/m] marketing unsubscribe failed:", error.message);
    return false;
  }
  return true;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const rl = await checkIpRateLimit("marketing-unsubscribe", 30, 60_000);
  if (rl) return NextResponse.json({ ok: true });
  await unsubscribeMarketingByToken(token);
  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const rl = await checkIpRateLimit("marketing-unsubscribe", 30, 60_000);
  if (rl) {
    return new NextResponse("Too many requests. Try again shortly.", {
      status: 429,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const ok = await unsubscribeMarketingByToken(token);
  const message = ok
    ? "You're unsubscribed from promotional reminders. You'll still receive booking confirmations, reminders, and invoices."
    : "That unsubscribe link isn't valid. It may have already been used.";

  return new NextResponse(
    `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#111827;">
      <h1 style="font-size:18px;font-weight:600;">Reminders</h1>
      <p style="font-size:14px;line-height:1.6;color:#4b5563;">${message}</p>
    </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

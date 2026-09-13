import { NextRequest, NextResponse } from "next/server";
import { suspendOrg, unsuspendOrg, verifySuspendSignature } from "@/lib/abuse-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click suspend from the abuse tripwire email — one click, not zero.
 *
 * The link carries an HMAC of the org id under CRON_SECRET, so only a link
 * Sollos minted works, and only for that workspace. GET shows a page with a
 * button; POST does the deed. Mail clients, link scanners and preview bots
 * follow GETs on their own; a GET that suspended a workspace would have let
 * Outlook's safe-links crawler suspend it before anyone read the email.
 */
function page(body: string): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Sollos</title><body style="font:16px system-ui;padding:32px;max-width:520px">${body}</body>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function resolve(request: NextRequest) {
  const url = new URL(request.url);
  const orgId = url.searchParams.get("org") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  const undo = url.searchParams.get("undo") === "1";
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !verifySuspendSignature(orgId, sig)) return null;
  const admin = createSupabaseAdminClient();
  const { data: org } = (await admin
    .from("organizations")
    .select("name, suspended_at" as never)
    .eq("id", orgId)
    .maybeSingle()) as unknown as { data: { name: string; suspended_at: string | null } | null };
  if (!org) return null;
  return { orgId, sig, undo, org };
}

export async function GET(request: NextRequest) {
  const r = await resolve(request);
  if (!r) return new NextResponse("Not found", { status: 404 });
  const { orgId, sig, undo, org } = r;
  const state = org.suspended_at ? "currently suspended" : "currently active";
  const action = undo ? "Lift the suspension" : "Suspend this workspace";
  return page(
    `<h1>${esc(org.name)}</h1><p>This workspace is ${state}.</p>` +
      `<form method="post" action="?org=${orgId}&sig=${esc(sig)}${undo ? "&undo=1" : ""}">` +
      `<button type="submit" style="font:inherit;padding:10px 18px;background:#111;color:#fff;border:0;border-radius:6px;cursor:pointer">${action}</button>` +
      `</form>` +
      `<p style="color:#666;font-size:14px;margin-top:16px">Nothing happens until you press the button.</p>`,
  );
}

export async function POST(request: NextRequest) {
  const r = await resolve(request);
  if (!r) return new NextResponse("Not found", { status: 404 });
  const { orgId, sig, undo, org } = r;
  if (undo) {
    await unsuspendOrg(orgId);
    return page(`<h1>Lifted</h1><p>"${esc(org.name)}" can sign in and send again.</p>`);
  }
  await suspendOrg(orgId, "Suspended by Sollos support via the abuse tripwire link.");
  return page(
    `<h1>Suspended</h1><p>"${esc(org.name)}" is closed: no sign-in, no sending, no API.</p>` +
      `<p><a href="?org=${orgId}&sig=${esc(sig)}&undo=1">Undo</a></p>`,
  );
}

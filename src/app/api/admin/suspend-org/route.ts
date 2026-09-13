import { NextRequest, NextResponse } from "next/server";
import {
  suspendOrg,
  unsuspendOrg,
  verifySuspendSignature,
  type SuspendAction,
} from "@/lib/abuse-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click suspend from the abuse tripwire email — one click, not zero.
 *
 * The link carries an HMAC under CRON_SECRET of the org id, the action
 * (suspend or undo) and an expiry, so only a link Sollos minted works, only
 * for that workspace, only for that action, and only for three days. GET
 * shows a page with a button; POST does the deed. Mail clients, link
 * scanners and preview bots follow GETs on their own; a GET that suspended
 * a workspace would have let Outlook's safe-links crawler suspend it before
 * anyone read the email.
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
  const exp = Number(url.searchParams.get("exp") ?? "0");
  const actionParam = url.searchParams.get("action");
  if (actionParam !== "suspend" && actionParam !== "undo") return null;
  const action: SuspendAction = actionParam;
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !verifySuspendSignature(orgId, action, exp, sig)) return null;
  const admin = createSupabaseAdminClient();
  const { data: org } = (await admin
    .from("organizations")
    .select("name, suspended_at" as never)
    .eq("id", orgId)
    .maybeSingle()) as unknown as { data: { name: string; suspended_at: string | null } | null };
  if (!org) return null;
  const query = `?org=${orgId}&action=${action}&exp=${exp}&sig=${esc(sig)}`;
  return { orgId, action, org, query };
}

export async function GET(request: NextRequest) {
  const r = await resolve(request);
  if (!r) return new NextResponse("Not found", { status: 404 });
  const { action, org, query } = r;
  const state = org.suspended_at ? "currently suspended" : "currently active";
  const label = action === "undo" ? "Lift the suspension" : "Suspend this workspace";
  return page(
    `<h1>${esc(org.name)}</h1><p>This workspace is ${state}.</p>` +
      `<form method="post" action="${query}">` +
      `<button type="submit" style="font:inherit;padding:10px 18px;background:#111;color:#fff;border:0;border-radius:6px;cursor:pointer">${label}</button>` +
      `</form>` +
      `<p style="color:#666;font-size:14px;margin-top:16px">Nothing happens until you press the button.</p>`,
  );
}

export async function POST(request: NextRequest) {
  const r = await resolve(request);
  if (!r) return new NextResponse("Not found", { status: 404 });
  const { orgId, action, org } = r;
  if (action === "undo") {
    await unsuspendOrg(orgId);
    return page(`<h1>Lifted</h1><p>"${esc(org.name)}" can sign in and send again.</p>`);
  }
  await suspendOrg(orgId, "Suspended by Sollos support via the abuse tripwire link.");
  return page(
    `<h1>Suspended</h1><p>"${esc(org.name)}" is closed: no sign-in, no sending, no API.</p>` +
      `<p style="color:#666;font-size:14px">To lift it, use the undo link from the same email.</p>`,
  );
}

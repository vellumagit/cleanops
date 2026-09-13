import { NextRequest, NextResponse } from "next/server";
import { suspendOrg, unsuspendOrg, verifySuspendSignature } from "@/lib/abuse-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click suspend from the abuse tripwire email. The link carries an HMAC
 * of the org id under CRON_SECRET, so only a link Sollos minted works, and
 * only for that one workspace. `&undo=1` lifts the suspension.
 *
 * GET on purpose: it has to work from a phone's mail app at midnight.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const orgId = url.searchParams.get("org") ?? "";
  const sig = url.searchParams.get("sig");
  const undo = url.searchParams.get("undo") === "1";
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !verifySuspendSignature(orgId, sig)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const admin = createSupabaseAdminClient();
  const { data: org } = (await admin
    .from("organizations")
    .select("name, suspended_at" as never)
    .eq("id", orgId)
    .maybeSingle()) as unknown as { data: { name: string; suspended_at: string | null } | null };
  if (!org) return new NextResponse("Not found", { status: 404 });

  if (undo) {
    await unsuspendOrg(orgId);
  } else {
    await suspendOrg(orgId, "Suspended by Sollos support via the abuse tripwire link.");
  }
  const body = undo
    ? `<h1>Lifted</h1><p>"${escape(org.name)}" can sign in and send again.</p>`
    : `<h1>Suspended</h1><p>"${escape(org.name)}" is closed: no sign-in, no sending, no API.</p><p><a href="${url.pathname}?org=${orgId}&sig=${sig}&undo=1">Undo</a></p>`;
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Sollos</title><body style="font:16px system-ui;padding:32px;max-width:520px">${body}</body>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

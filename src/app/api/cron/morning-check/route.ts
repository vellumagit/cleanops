/**
 * Daily: email the morning check to Brian at 8:00 AM Edmonton.
 *
 * One fixed UTC time works year-round: Alberta is on permanent UTC-6 from
 * 2026-11-01 (it was already UTC-6 under MDT), so 14:00 UTC is 8 AM every
 * day. This replaces the desktop scheduled task, which only ran while the
 * app was open.
 *
 * Every morning sends something: the report, or a "the check failed" email.
 * A silent morning would read as a clean one.
 *
 * Env: MORNING_CHECK_EMAIL (recipient), MORNING_CHECK_ORG_ID (optional,
 * defaults to Svit).
 *
 * Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.
 * Pass ?dry_run=1 to get the report as JSON without sending.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { sendEmailDetailed } from "@/lib/email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { escapeHtml } from "@/lib/support-mail";
import { runMorningCheck } from "@/lib/morning-check";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  const to = process.env.MORNING_CHECK_EMAIL;
  if (!to && !dryRun) {
    console.error("[cron/morning-check] MORNING_CHECK_EMAIL is not set; nothing sent");
    return NextResponse.json({ error: "MORNING_CHECK_EMAIL is not set" }, { status: 500 });
  }

  let subject: string;
  let text: string;
  let html: string;
  try {
    const report = await runMorningCheck(createSupabaseAdminClient(), {
      orgId: process.env.MORNING_CHECK_ORG_ID || undefined,
    });
    if (dryRun) return NextResponse.json({ ok: true, dry_run: true, ...report });

    const n = report.flags.length;
    subject = n ? `Morning check: ${n} to look at — ${report.orgName}` : `Morning check: clean — ${report.orgName}`;
    const head = n ? `LOOK AT:\n${report.flags.map((f) => `  - ${f}`).join("\n")}` : "CLEAN — nothing to look at.";
    text = `${head}\n\n${report.lines.join("\n")}\n`;
    html = `<pre style="font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/morning-check] check failed:", err);
    if (dryRun) return NextResponse.json({ error: msg }, { status: 500 });
    subject = "Morning check FAILED to run";
    text = `The morning check threw before it could report:\n\n${msg}\n\nRun it by hand: pnpm tsx --env-file=.env.local scripts/shadow-morning-check.ts`;
    html = `<pre style="font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`;
  }

  const sent = await sendEmailDetailed({ to: to!, subject, text, html });
  if (!sent.ok) {
    console.error("[cron/morning-check] send failed:", sent.reason);
    return NextResponse.json({ error: sent.reason }, { status: 500 });
  }
  return NextResponse.json({ ok: true, subject, id: sent.id });
}

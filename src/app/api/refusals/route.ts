/**
 * POST /api/refusals
 *
 * Keeps what the app just told a signed-in person when it said no: the
 * words of a red toast or an error box, and the screen they were on. See
 * migration 20261114010000_refusal_log.sql for why, and
 * src/components/refusal-recorder.tsx for what sends it.
 *
 * Nothing here is worth interrupting anyone for. Every failure answers 204
 * or a quiet 4xx and is logged; the recorder never shows a result.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentMembership } from "@/lib/auth";
import { enterFailClosed } from "@/lib/supabase/query-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { refusalMessage, refusalPath, type RefusalKind } from "@/lib/refusal-log";

/** One page can't post more than this in one request. */
const MAX_PER_REQUEST = 10;
/** Nor one person more than this in ten minutes. Someone fighting the app
 *  hard is a few dozen; past that it is a loop or a script, and the rows
 *  would push real refusals out of the morning report's read. */
const MAX_PER_PERSON_WINDOW = 60;
const WINDOW_MS = 10 * 60_000;

export async function POST(request: NextRequest) {
  enterFailClosed();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const items = Array.isArray((body as { items?: unknown })?.items)
    ? ((body as { items: unknown[] }).items as unknown[]).slice(0, MAX_PER_REQUEST)
    : [];
  if (items.length === 0) return new NextResponse(null, { status: 204 });

  // Whoever is signed in, in the company they are working in. Nobody
  // signed in means nothing to attribute it to: drop it. A read that fails
  // here throws (fail-closed); for this route that is also "drop it".
  let membership: Awaited<ReturnType<typeof getCurrentMembership>> = null;
  try {
    membership = await getCurrentMembership();
  } catch (err) {
    console.error("[refusals] could not tell who is signed in:", err);
  }
  if (!membership) return new NextResponse(null, { status: 204 });

  const rows: Array<{
    organization_id: string;
    membership_id: string;
    path: string;
    kind: RefusalKind;
    message: string;
  }> = [];
  for (const item of items) {
    const it = (item ?? {}) as { message?: unknown; path?: unknown; kind?: unknown };
    const message = refusalMessage(it.message);
    if (!message) continue;
    rows.push({
      organization_id: membership.organization_id,
      membership_id: membership.id,
      path: refusalPath(typeof it.path === "string" && it.path.startsWith("/") ? it.path : "/"),
      kind: it.kind === "alert" ? "alert" : "toast",
      message,
    });
  }
  if (rows.length === 0) return new NextResponse(null, { status: 204 });

  // The table missing (migration not run yet) lands in the catch: inside the
  // fail-closed scope a failed write throws. The person already saw their
  // message; losing the record of it must not add to it.
  try {
    const admin = createSupabaseAdminClient();
    const { count } = (await admin
      .from("refusal_log" as never)
      .select("id", { count: "exact", head: true })
      .eq("membership_id" as never, membership.id as never)
      .gte("created_at" as never, new Date(Date.now() - WINDOW_MS).toISOString() as never)) as unknown as {
      count: number | null;
    };
    const room = MAX_PER_PERSON_WINDOW - (count ?? 0);
    if (room <= 0) return new NextResponse(null, { status: 204 });
    const { error } = (await admin
      .from("refusal_log" as never)
      .insert(rows.slice(0, room) as never)) as unknown as { error: { message: string } | null };
    if (error) console.error("[refusals] could not record:", error.message);
  } catch (err) {
    console.error("[refusals] could not record:", err instanceof Error ? err.message : err);
  }
  return new NextResponse(null, { status: 204 });
}

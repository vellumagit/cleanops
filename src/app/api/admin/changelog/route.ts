/**
 * ADMIN TOOL — write / list Sollos changelog entries.
 *
 * Customer-facing release notes are written by hand (auto-generated commit
 * subjects make terrible, sometimes alarming, customer copy), so this is the
 * authoring endpoint until there's a UI for it.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` header.
 *
 *   GET  /api/admin/changelog            list recent entries + their state
 *   POST /api/admin/changelog            add an entry
 *        body: { title, body, publish?: boolean }
 *        publish defaults TRUE — an entry must be published to be mailed;
 *        pass publish:false to stage a draft.
 *
 * Nothing is emailed here. The weekly cron picks up published-but-unsent
 * entries, so you can add several during the week and they go out together.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const db = createSupabaseAdminClient();
  const { data } = (await db
    .from("changelog_entries" as never)
    .select("id, title, body, published_at, sent_at, created_at")
    .order("created_at", { ascending: false })
    .limit(50)) as unknown as { data: unknown[] | null };

  return NextResponse.json({ ok: true, entries: data ?? [] });
}

export async function POST(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  let payload: { title?: string; body?: string; publish?: boolean };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = String(payload.title ?? "").trim();
  const body = String(payload.body ?? "").trim();
  if (!title || !body) {
    return NextResponse.json(
      { error: "Both `title` and `body` are required." },
      { status: 400 },
    );
  }
  if (title.length > 200 || body.length > 2000) {
    return NextResponse.json(
      { error: "Title max 200 chars, body max 2000." },
      { status: 400 },
    );
  }

  const publish = payload.publish !== false;

  const db = createSupabaseAdminClient();
  const { data, error } = (await db
    .from("changelog_entries" as never)
    .insert({
      title,
      body,
      published_at: publish ? new Date().toISOString() : null,
    } as never)
    .select("id, title, published_at")
    .single()) as unknown as {
    data: { id: string; title: string; published_at: string | null } | null;
    error: { message: string } | null;
  };

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    entry: data,
    note: publish
      ? "Published — it will go out with the next weekly send."
      : "Saved as a draft. Publish it to include it in the weekly send.",
  });
}

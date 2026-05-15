/**
 * ONE-SHOT ADMIN TOOL — GCal force resync
 *
 * Wipes every Sollos-managed event from an org's Google Calendar (including
 * orphans that have no booking ID in the DB), clears all
 * google_calendar_event_id values, then re-pushes all upcoming bookings.
 *
 * Use when a customer has doubled/tripled events from a historic bug.
 *
 * Auth: pass CRON_SECRET as the `secret` query param or as
 *       `Authorization: Bearer <CRON_SECRET>` header.
 *
 * Usage:
 *   GET /api/admin/gcal-force-resync?org_id=<UUID>&secret=<CRON_SECRET>
 *
 * Response: { deleted_from_gcal, nulled_booking_ids, synced, errors }
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bulkSyncUpcomingBookings } from "@/lib/google-calendar";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export async function GET(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.length < 16) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }

  const url = new URL(request.url);
  const secretParam = url.searchParams.get("secret");
  const authHeader = request.headers.get("authorization");
  const authorized =
    secretParam === cronSecret || authHeader === `Bearer ${cronSecret}`;

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Org ID ────────────────────────────────────────────────────────────────
  const orgId = url.searchParams.get("org_id");
  if (!orgId) {
    return NextResponse.json({ error: "Missing org_id" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // ── Load connection ───────────────────────────────────────────────────────
  const { data: conn } = await admin
    .from("integration_connections" as never)
    .select(
      "id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, metadata",
    )
    .eq("organization_id" as never, orgId)
    .eq("provider" as never, "google_calendar")
    .eq("status" as never, "active")
    .maybeSingle() as unknown as {
    data: {
      id: string;
      access_token_ciphertext: string | null;
      refresh_token_ciphertext: string | null;
      token_expires_at: string | null;
      metadata: Record<string, unknown>;
    } | null;
  };

  if (!conn || !conn.access_token_ciphertext) {
    return NextResponse.json(
      { error: "No active Google Calendar connection for this org" },
      { status: 404 },
    );
  }

  // ── Resolve access token (refresh if expired) ─────────────────────────────
  let accessToken = decryptSecret(conn.access_token_ciphertext)!;
  const isExpired =
    conn.token_expires_at &&
    new Date(conn.token_expires_at).getTime() < Date.now() + 60_000;

  if (isExpired && conn.refresh_token_ciphertext) {
    const env = {
      clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
    };
    const refreshToken = decryptSecret(conn.refresh_token_ciphertext)!;
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.clientId,
        client_secret: env.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (tokenRes.ok) {
      const tokenData = await tokenRes.json();
      accessToken = tokenData.access_token;
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
      await admin
        .from("integration_connections" as never)
        .update({
          access_token_ciphertext: encryptSecret(accessToken),
          token_expires_at: expiresAt,
        } as never)
        .eq("id" as never, conn.id);
    }
  }

  const calendarId = (conn.metadata?.calendar_id as string) || "primary";

  // ── List all upcoming events from Google Calendar ─────────────────────────
  const timeMin = new Date().toISOString();
  const timeMax = new Date(
    Date.now() + 365 * 24 * 60 * 60 * 1000,
  ).toISOString(); // 1 year out

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    maxResults: "2500",
    orderBy: "startTime",
  });

  const listRes = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!listRes.ok) {
    const body = await listRes.text();
    return NextResponse.json(
      { error: `Failed to list GCal events: ${listRes.status} ${body}` },
      { status: 500 },
    );
  }

  const listData = await listRes.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allEvents: any[] = listData.items ?? [];

  // Find every event that was pushed by Sollos (contains our marker)
  const sollosEvents = allEvents.filter((e) =>
    (e.description ?? "").includes("Managed by Sollos"),
  );

  // ── Delete each Sollos event from GCal ────────────────────────────────────
  let deleted_from_gcal = 0;
  const errors: string[] = [];

  await Promise.allSettled(
    sollosEvents.map(async (e) => {
      const delRes = await fetch(
        `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(e.id)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (delRes.ok || delRes.status === 404 || delRes.status === 410) {
        deleted_from_gcal++;
      } else {
        errors.push(`Failed to delete GCal event ${e.id}: ${delRes.status}`);
      }
    }),
  );

  // ── Null all google_calendar_event_id on upcoming bookings ────────────────
  const now = new Date().toISOString();
  const { count: nulled_booking_ids } = await admin
    .from("bookings")
    .update({ google_calendar_event_id: null } as never)
    .eq("organization_id" as never, orgId)
    .gte("scheduled_at" as never, now)
    .not("google_calendar_event_id" as never, "is" as never, null as never);

  // ── Re-sync all upcoming bookings to the (now clean) calendar ────────────
  await bulkSyncUpcomingBookings(orgId).catch((err) => {
    errors.push(`bulkSync error: ${String(err)}`);
  });

  return NextResponse.json({
    ok: true,
    sollos_events_found: sollosEvents.length,
    deleted_from_gcal,
    nulled_booking_ids: nulled_booking_ids ?? 0,
    errors,
  });
}

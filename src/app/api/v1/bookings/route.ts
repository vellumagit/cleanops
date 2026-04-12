import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { findOrCreateClient } from "@/lib/find-or-create-client";

/**
 * GET /api/v1/bookings — List bookings for the authenticated org.
 *
 * Query params:
 *   ?limit=25          (default 25, max 100)
 *   ?offset=0
 *   ?status=pending     (filter by status)
 *   ?client_id=uuid     (filter by client)
 *   ?since=ISO          (updated_at >= value)
 *   ?scheduled_after=ISO
 *   ?scheduled_before=ISO
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;

  const url = request.nextUrl;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 25, 100);
  const offset = Number(url.searchParams.get("offset")) || 0;
  const status = url.searchParams.get("status") ?? "";
  const clientId = url.searchParams.get("client_id") ?? "";
  const since = url.searchParams.get("since") ?? "";
  const scheduledAfter = url.searchParams.get("scheduled_after") ?? "";
  const scheduledBefore = url.searchParams.get("scheduled_before") ?? "";

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("bookings")
    .select(
      `id, client_id, assigned_to, scheduled_at, duration_minutes,
       service_type, status, total_cents, hourly_rate_cents, address, notes,
       created_at, updated_at,
       client:clients ( name, email )`,
      { count: "exact" },
    )
    .eq("organization_id", auth.organizationId)
    .order("scheduled_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status as never);
  if (clientId) query = query.eq("client_id", clientId);
  if (since) query = query.gte("updated_at", since);
  if (scheduledAfter) query = query.gte("scheduled_at", scheduledAfter);
  if (scheduledBefore) query = query.lte("scheduled_at", scheduledBefore);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data,
    pagination: { total: count ?? 0, limit, offset },
  });
}

/**
 * POST /api/v1/bookings — Create a booking.
 *
 * Accepts EITHER:
 *   - `client_id` (UUID) — use an existing client directly
 *   - `client_name` + optional `client_email` / `client_phone` / `client_address`
 *     → looks up by email first, then name, creates if not found
 *
 * Body: { client_id?, client_name?, client_email?, client_phone?,
 *         client_address?, scheduled_at, duration_minutes, service_type?,
 *         status?, total_cents?, hourly_rate_cents?, address?, notes?,
 *         assigned_to?, package_id? }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // ── Resolve client_id ─────────────────────────────────────
  let clientId = body.client_id as string | undefined;
  const clientName = body.client_name as string | undefined;
  const clientEmail = body.client_email as string | undefined;

  if (!clientId) {
    if (!clientName || typeof clientName !== "string" || !clientName.trim()) {
      return NextResponse.json(
        { error: "Provide either client_id (UUID) or client_name" },
        { status: 400 },
      );
    }
    clientId = (await findOrCreateClient(admin, auth.organizationId, {
      name: clientName.trim(),
      email: clientEmail?.trim(),
      phone: (body.client_phone as string)?.trim(),
      address: (body.client_address as string)?.trim(),
    })) ?? undefined;
    if (!clientId) {
      return NextResponse.json({ error: "Failed to resolve client" }, { status: 500 });
    }
  }

  const scheduled_at = body.scheduled_at as string | undefined;
  const duration_minutes = body.duration_minutes as number | undefined;

  if (!scheduled_at) return NextResponse.json({ error: "scheduled_at is required" }, { status: 400 });
  if (!duration_minutes) return NextResponse.json({ error: "duration_minutes is required" }, { status: 400 });

  const { data, error } = await admin
    .from("bookings" as never)
    .insert({
      organization_id: auth.organizationId,
      client_id: clientId,
      scheduled_at,
      duration_minutes,
      service_type: (body.service_type as string) ?? "standard",
      status: (body.status as string) ?? "pending",
      total_cents: (body.total_cents as number) ?? 0,
      hourly_rate_cents: (body.hourly_rate_cents as number) ?? null,
      address: (body.address as string) ?? null,
      notes: (body.notes as string) ?? null,
      assigned_to: (body.assigned_to as string) ?? null,
      package_id: (body.package_id as string) ?? null,
    } as never)
    .select("id, client_id, scheduled_at, duration_minutes, service_type, status, total_cents, address, notes, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  dispatchWebhookEvent(auth.organizationId, "booking.created", data).catch(() => {});

  return NextResponse.json({ data }, { status: 201 });
}

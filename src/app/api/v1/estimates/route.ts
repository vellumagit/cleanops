import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchWebhookEvent } from "@/lib/webhooks";

/**
 * GET /api/v1/estimates
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

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("estimates")
    .select(
      `id, client_id, service_description, status, total_cents, notes,
       sent_at, decided_at, created_at, updated_at,
       client:clients ( name, email )`,
      { count: "exact" },
    )
    .eq("organization_id", auth.organizationId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status as never);
  if (clientId) query = query.eq("client_id", clientId);
  if (since) query = query.gte("updated_at", since);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data,
    pagination: { total: count ?? 0, limit, offset },
  });
}

/**
 * POST /api/v1/estimates — Create an estimate.
 *
 * Body: { client_id, total_cents, service_description?, notes?, status? }
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

  const { client_id, total_cents } = body as {
    client_id?: string;
    total_cents?: number;
  };

  if (!client_id) return NextResponse.json({ error: "client_id is required" }, { status: 400 });
  if (total_cents == null) return NextResponse.json({ error: "total_cents is required" }, { status: 400 });

  const status = (body.status as string) ?? "draft";
  const now = new Date().toISOString();

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("estimates" as never)
    .insert({
      organization_id: auth.organizationId,
      client_id,
      total_cents,
      service_description: (body.service_description as string) ?? null,
      notes: (body.notes as string) ?? null,
      status,
      sent_at: status !== "draft" ? now : null,
      decided_at: status === "approved" || status === "declined" ? now : null,
    } as never)
    .select("id, client_id, service_description, status, total_cents, notes, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  dispatchWebhookEvent(auth.organizationId, "estimate.created", data).catch(() => {});

  return NextResponse.json({ data }, { status: 201 });
}

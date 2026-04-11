import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchWebhookEvent } from "@/lib/webhooks";

/**
 * GET /api/v1/clients — List clients for the authenticated org.
 *
 * Query params:
 *   ?limit=25        (default 25, max 100)
 *   ?offset=0        (default 0)
 *   ?search=name     (partial match on name or email)
 *   ?since=ISO       (filter by updated_at >= value)
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;

  const url = request.nextUrl;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 25, 100);
  const offset = Number(url.searchParams.get("offset")) || 0;
  const search = url.searchParams.get("search") ?? "";
  const since = url.searchParams.get("since") ?? "";

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("clients")
    .select("id, name, email, phone, address, preferred_contact, notes, balance_cents, created_at, updated_at", { count: "exact" })
    .eq("organization_id", auth.organizationId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  }
  if (since) {
    query = query.gte("updated_at", since);
  }

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data,
    pagination: { total: count ?? 0, limit, offset },
  });
}

/**
 * POST /api/v1/clients — Create a new client.
 *
 * Body: { name, email?, phone?, address?, preferred_contact?, notes? }
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

  const { name, email, phone, address, preferred_contact, notes } = body as {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    preferred_contact?: string;
    notes?: string;
  };

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("clients" as never)
    .insert({
      organization_id: auth.organizationId,
      name: name.trim(),
      email: email ?? null,
      phone: phone ?? null,
      address: address ?? null,
      preferred_contact: preferred_contact ?? "email",
      notes: notes ?? null,
    } as never)
    .select("id, name, email, phone, address, preferred_contact, notes, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fire webhook
  dispatchWebhookEvent(auth.organizationId, "client.created", data).catch(() => {});

  return NextResponse.json({ data }, { status: 201 });
}

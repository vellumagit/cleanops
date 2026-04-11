import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchWebhookEvent } from "@/lib/webhooks";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/clients/:id — Fetch a single client.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("clients")
    .select("id, name, email, phone, address, preferred_contact, notes, balance_cents, created_at, updated_at")
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  return NextResponse.json({ data });
}

/**
 * PATCH /api/v1/clients/:id — Update a client.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Only allow updating known fields
  const allowed = ["name", "email", "phone", "address", "preferred_contact", "notes"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("clients")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .select("id, name, email, phone, address, preferred_contact, notes, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  dispatchWebhookEvent(auth.organizationId, "client.updated", data).catch(() => {});

  return NextResponse.json({ data });
}

/**
 * DELETE /api/v1/clients/:id — Delete a client.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("clients")
    .delete()
    .eq("id", id)
    .eq("organization_id", auth.organizationId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

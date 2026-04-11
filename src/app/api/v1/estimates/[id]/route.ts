import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchWebhookEvent } from "@/lib/webhooks";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/estimates/:id
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("estimates")
    .select(
      `id, client_id, service_description, status, total_cents, notes,
       sent_at, decided_at, created_at, updated_at,
       client:clients ( name, email )`,
    )
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });

  return NextResponse.json({ data });
}

/**
 * PATCH /api/v1/estimates/:id
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

  const allowed = ["client_id", "service_description", "status", "total_cents", "notes"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  // Handle timestamp logic for status changes
  if (updates.status) {
    const admin2 = createSupabaseAdminClient();
    const { data: prev } = await admin2
      .from("estimates")
      .select("sent_at, decided_at")
      .eq("id", id)
      .eq("organization_id", auth.organizationId)
      .maybeSingle();

    const now = new Date().toISOString();
    const st = updates.status as string;
    if (st === "sent" || st === "approved" || st === "declined") {
      updates.sent_at = prev?.sent_at ?? now;
    }
    if (st === "approved" || st === "declined") {
      updates.decided_at = prev?.decided_at ?? now;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("estimates")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .select("id, client_id, service_description, status, total_cents, notes, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  dispatchWebhookEvent(auth.organizationId, "estimate.updated", data).catch(() => {});

  return NextResponse.json({ data });
}

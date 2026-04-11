import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchWebhookEvent } from "@/lib/webhooks";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/invoices/:id
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("invoices")
    .select(
      `id, client_id, booking_id, status, amount_cents, due_date,
       sent_at, paid_at, number, public_token, voided_at,
       created_at, updated_at,
       client:clients ( name, email )`,
    )
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  return NextResponse.json({ data });
}

/**
 * PATCH /api/v1/invoices/:id
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

  const allowed = ["client_id", "booking_id", "status", "amount_cents", "due_date"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  // Handle timestamp logic for status changes
  if (updates.status) {
    const admin2 = createSupabaseAdminClient();
    const { data: prev } = await admin2
      .from("invoices")
      .select("sent_at, paid_at, status")
      .eq("id", id)
      .eq("organization_id", auth.organizationId)
      .maybeSingle();

    const now = new Date().toISOString();
    const st = updates.status as string;
    if (st === "sent" || st === "paid" || st === "overdue") {
      updates.sent_at = prev?.sent_at ?? now;
    }
    if (st === "paid") {
      updates.paid_at = prev?.paid_at ?? now;
    }

    // Fire specific webhook for paid transition
    if (st === "paid" && prev?.status !== "paid") {
      // Will fire after the update below
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("invoices")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .select("id, client_id, status, amount_cents, due_date, number, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Determine which webhook to fire
  if ((data.status as string) === "paid") {
    dispatchWebhookEvent(auth.organizationId, "invoice.paid", data).catch(() => {});
  } else {
    dispatchWebhookEvent(auth.organizationId, "invoice.updated", data).catch(() => {});
  }

  return NextResponse.json({ data });
}

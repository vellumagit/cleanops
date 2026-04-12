import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { findOrCreateClient } from "@/lib/find-or-create-client";

/**
 * GET /api/v1/invoices
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
    .from("invoices")
    .select(
      `id, client_id, booking_id, status, amount_cents, due_date,
       sent_at, paid_at, number, public_token, voided_at,
       created_at, updated_at,
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
 * POST /api/v1/invoices — Create an invoice.
 *
 * Body: { client_id, amount_cents, due_date, status?, booking_id? }
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
  if (!clientId) {
    const clientName = body.client_name as string | undefined;
    if (!clientName || typeof clientName !== "string" || !clientName.trim()) {
      return NextResponse.json(
        { error: "Provide either client_id (UUID) or client_name" },
        { status: 400 },
      );
    }
    clientId = (await findOrCreateClient(admin, auth.organizationId, {
      name: clientName.trim(),
      email: (body.client_email as string)?.trim(),
      phone: (body.client_phone as string)?.trim(),
      address: (body.client_address as string)?.trim(),
    })) ?? undefined;
    if (!clientId) {
      return NextResponse.json({ error: "Failed to resolve client" }, { status: 500 });
    }
  }

  const amount_cents = body.amount_cents as number | undefined;
  const due_date = body.due_date as string | undefined;

  if (amount_cents == null) return NextResponse.json({ error: "amount_cents is required" }, { status: 400 });
  if (!due_date) return NextResponse.json({ error: "due_date is required" }, { status: 400 });

  const status = (body.status as string) ?? "draft";
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("invoices" as never)
    .insert({
      organization_id: auth.organizationId,
      client_id: clientId,
      amount_cents,
      due_date,
      status,
      booking_id: (body.booking_id as string) ?? null,
      sent_at: status === "sent" || status === "paid" || status === "overdue" ? now : null,
      paid_at: status === "paid" ? now : null,
    } as never)
    .select("id, client_id, amount_cents, due_date, status, number, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  dispatchWebhookEvent(auth.organizationId, "invoice.created", data).catch(() => {});

  return NextResponse.json({ data }, { status: 201 });
}

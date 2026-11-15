import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { apiServerError } from "@/lib/api/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { moveUpcomingVisitsToAddress } from "@/lib/address-follow";

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

  if (error) return apiServerError("clients/:id", error);
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
  // The address before the change, for the visits that copied it.
  let addressBefore: string | null | undefined;
  if ("address" in updates) {
    const { data: before } = (await admin
      .from("clients")
      .select("address")
      .eq("id", id)
      .eq("organization_id", auth.organizationId)
      .maybeSingle()) as unknown as { data: { address: string | null } | null };
    addressBefore = before ? before.address : undefined;
  }
  const { data, error } = await admin
    .from("clients")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .select("id, name, email, phone, address, preferred_contact, notes, updated_at")
    .single();

  if (error) return apiServerError("clients/:id", error);

  // A new address reaches the visits already booked, as it does when the
  // office changes it on the client's page (src/lib/address-follow.ts).
  // Without this an integration that corrects an address left every
  // upcoming visit sending the crew to the old one.
  let visitsMoved: number | undefined;
  if (addressBefore !== undefined) {
    const next = typeof updates.address === "string" ? updates.address : null;
    try {
      const moved = await moveUpcomingVisitsToAddress(admin, {
        organizationId: auth.organizationId,
        clientId: id,
        propertyId: null,
        oldAddress: addressBefore,
        newAddress: next,
      });
      visitsMoved = moved.visitIds.length;
    } catch (err) {
      console.error("[api/v1/clients] address saved, upcoming visits not updated:", err);
      return NextResponse.json(
        {
          data,
          error:
            "The address is saved on the client, but their upcoming visits could not be updated and still show the old one. Send the same change again.",
        },
        { status: 500 },
      );
    }
  }

  dispatchWebhookEvent(auth.organizationId, "client.updated", data).catch(() => {});

  return NextResponse.json(visitsMoved === undefined ? { data } : { data, upcoming_visits_updated: visitsMoved });
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

  if (error) return apiServerError("clients/:id", error);

  return NextResponse.json({ success: true });
}

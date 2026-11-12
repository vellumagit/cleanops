import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { apiServerError } from "@/lib/api/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { findCrossOrgRef } from "@/lib/api/org-scope";
import {
  estimatePdfLink,
  fetchPdfFromUrl,
  removeStoredEstimatePdf,
  storeEstimatePdf,
} from "@/lib/estimate-pdf-storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
       pdf_url, sent_at, decided_at, created_at, updated_at,
       client:clients ( name, email )`,
    )
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();

  if (error) return apiServerError("estimates/:id", error);
  if (!data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });

  // pdf_url is a private reference; the caller gets a link that expires.
  const row = data as unknown as { pdf_url: string | null };
  return NextResponse.json({ data: { ...row, pdf_url: await estimatePdfLink(admin, row.pdf_url) } });
}

/**
 * PATCH /api/v1/estimates/:id
 *
 * Accepts JSON with any of:
 *   client_id, service_description, status, total_cents, notes, pdf_url
 *
 * pdf_url can be:
 *   - A public URL to a PDF → we download and store it
 *   - null → removes the existing PDF
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

  const admin = createSupabaseAdminClient();

  // client_id must belong to this org — the update uses the service-role
  // client (RLS bypassed) and read routes embed client:clients(name,email).
  const badRef = await findCrossOrgRef(admin, auth.organizationId, {
    client_id: updates.client_id,
  });
  if (badRef) {
    return NextResponse.json(
      { error: `Invalid ${badRef}: not found in your organization` },
      { status: 400 },
    );
  }

  // Handle PDF URL — download from external source and store privately.
  // Only for an estimate this company has: storage is written before the
  // row is, so check first.
  if ("pdf_url" in body) {
    const { data: own } = UUID.test(id)
      ? await admin
          .from("estimates")
          .select("id")
          .eq("id", id)
          .eq("organization_id", auth.organizationId)
          .maybeSingle()
      : { data: null };
    if (!own) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });

    if (body.pdf_url === null || body.pdf_url === "") {
      await removeStoredEstimatePdf(admin, auth.organizationId, id);
      updates.pdf_url = null;
    } else if (typeof body.pdf_url === "string") {
      const fetched = await fetchPdfFromUrl(body.pdf_url);
      if (fetched.error !== null) {
        return NextResponse.json({ error: fetched.error }, { status: 400 });
      }
      const stored = await storeEstimatePdf(admin, auth.organizationId, id, fetched.blob);
      if (stored.error !== null) {
        return NextResponse.json({ error: stored.error }, { status: 500 });
      }
      updates.pdf_url = stored.ref;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("estimates" as never)
    .update(updates as never)
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .select("id, client_id, service_description, status, total_cents, notes, pdf_url, updated_at")
    .single();

  if (error) return apiServerError("estimates/:id", error);

  // pdf_url is a private reference; callers and webhooks get a link that expires.
  const row = data as unknown as { pdf_url: string | null };
  const out = { ...row, pdf_url: await estimatePdfLink(admin, row.pdf_url) };
  dispatchWebhookEvent(auth.organizationId, "estimate.updated", out).catch(() => {});

  return NextResponse.json({ data: out });
}

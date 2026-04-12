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
       pdf_url, sent_at, decided_at, created_at, updated_at,
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

  // Handle PDF URL — download from external source and store
  const admin = createSupabaseAdminClient();
  if ("pdf_url" in body) {
    if (body.pdf_url === null || body.pdf_url === "") {
      // Remove existing PDF
      await admin.storage
        .from("org-assets")
        .remove([`${auth.organizationId}/estimates/${id}.pdf`]);
      updates.pdf_url = null;
    } else if (typeof body.pdf_url === "string") {
      const result = await downloadAndStorePdf(
        admin,
        auth.organizationId,
        id,
        body.pdf_url,
      );
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      updates.pdf_url = result.url;
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  dispatchWebhookEvent(auth.organizationId, "estimate.updated", data).catch(() => {});

  return NextResponse.json({ data });
}

// ── Helpers ─────────────────────────────────────────────────

const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10 MB

async function downloadAndStorePdf(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string,
  estimateId: string,
  sourceUrl: string,
): Promise<{ url: string | null; error: string | null }> {
  try {
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      return { url: null, error: `Failed to download PDF: HTTP ${res.status}` };
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("pdf")) {
      return { url: null, error: `URL does not point to a PDF (got ${contentType})` };
    }

    const blob = await res.blob();
    if (blob.size > MAX_PDF_SIZE) {
      return { url: null, error: "PDF must be under 10 MB" };
    }

    const path = `${orgId}/estimates/${estimateId}.pdf`;
    const { error } = await admin.storage
      .from("org-assets")
      .upload(path, blob, {
        upsert: true,
        contentType: "application/pdf",
        cacheControl: "3600",
      });

    if (error) return { url: null, error: error.message };

    const { data: urlData } = admin.storage
      .from("org-assets")
      .getPublicUrl(path);

    return { url: `${urlData.publicUrl}?v=${Date.now()}`, error: null };
  } catch (err) {
    return {
      url: null,
      error: err instanceof Error ? err.message : "Failed to download PDF",
    };
  }
}

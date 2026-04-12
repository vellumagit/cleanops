import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { findOrCreateClient } from "@/lib/find-or-create-client";

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
       pdf_url, sent_at, decided_at, created_at, updated_at,
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
 * Accepts EITHER:
 *   - `client_id` (UUID) — use an existing client directly
 *   - `client_name` + optional `client_email` / `client_phone` / `client_address`
 *     → looks up by email first, creates a new client if not found
 *
 * PDF attachment — two options:
 *   - `pdf_url` (string) — a publicly accessible URL; we'll download and store it
 *   - Multipart form data with a `pdf` file field
 *
 * Body (JSON): { client_id?, client_name?, client_email?, client_phone?,
 *                client_address?, total_cents, service_description?, notes?,
 *                status?, pdf_url? }
 *
 * Body (multipart): same fields as form fields + `pdf` file
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;

  const contentType = request.headers.get("content-type") ?? "";
  let body: Record<string, unknown>;
  let pdfFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    body = {};
    for (const [key, value] of formData.entries()) {
      if (key === "pdf" && value instanceof File) {
        pdfFile = value;
      } else {
        body[key] = value;
      }
    }
    // Parse total_cents as number if it came as string from form
    if (typeof body.total_cents === "string") {
      body.total_cents = Number(body.total_cents);
    }
  } else {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  const admin = createSupabaseAdminClient();

  // ── Resolve client_id ─────────────────────────────────────
  let clientId = body.client_id as string | undefined;

  if (!clientId) {
    const clientName = body.client_name as string | undefined;
    if (!clientName || typeof clientName !== "string" || !clientName.trim()) {
      return NextResponse.json(
        { error: "Provide either client_id (UUID) or client_name to identify the client" },
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

  // ── Create the estimate ───────────────────────────────────
  const totalCents = body.total_cents as number | undefined;
  if (totalCents == null) {
    return NextResponse.json({ error: "total_cents is required" }, { status: 400 });
  }

  const status = (body.status as string) ?? "draft";
  const now = new Date().toISOString();

  const { data: rawData, error } = await admin
    .from("estimates" as never)
    .insert({
      organization_id: auth.organizationId,
      client_id: clientId,
      total_cents: totalCents,
      service_description: (body.service_description as string) ?? null,
      notes: (body.notes as string) ?? null,
      status,
      sent_at: status !== "draft" ? now : null,
      decided_at: status === "approved" || status === "declined" ? now : null,
    } as never)
    .select("id, client_id, service_description, status, total_cents, notes, pdf_url, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const data = rawData as unknown as {
    id: string;
    client_id: string;
    service_description: string | null;
    status: string;
    total_cents: number;
    notes: string | null;
    pdf_url: string | null;
    created_at: string;
  };

  // ── Handle PDF attachment ─────────────────────────────────
  let pdfPublicUrl: string | null = null;

  // Option 1: PDF file uploaded via multipart
  if (pdfFile && pdfFile.size > 0) {
    const result = await uploadPdfToStorage(admin, auth.organizationId, data.id, pdfFile);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    pdfPublicUrl = result.url;
  }

  // Option 2: PDF URL provided — download and store
  if (!pdfPublicUrl && body.pdf_url && typeof body.pdf_url === "string") {
    const result = await downloadAndStorePdf(admin, auth.organizationId, data.id, body.pdf_url as string);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    pdfPublicUrl = result.url;
  }

  // Update the estimate with the PDF URL if we got one
  if (pdfPublicUrl) {
    await admin
      .from("estimates" as never)
      .update({ pdf_url: pdfPublicUrl } as never)
      .eq("id", data.id);
    data.pdf_url = pdfPublicUrl;
  }

  dispatchWebhookEvent(auth.organizationId, "estimate.created", data).catch(() => {});

  return NextResponse.json({ data }, { status: 201 });
}

// ── Helpers ─────────────────────────────────────────────────

const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10 MB

async function uploadPdfToStorage(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string,
  estimateId: string,
  file: File,
): Promise<{ url: string | null; error: string | null }> {
  if (file.type !== "application/pdf") {
    return { url: null, error: "Only PDF files are allowed" };
  }
  if (file.size > MAX_PDF_SIZE) {
    return { url: null, error: "PDF must be under 10 MB" };
  }

  const path = `${orgId}/estimates/${estimateId}.pdf`;
  const { error } = await admin.storage
    .from("org-assets")
    .upload(path, file, {
      upsert: true,
      contentType: "application/pdf",
      cacheControl: "3600",
    });

  if (error) return { url: null, error: error.message };

  const { data: urlData } = admin.storage
    .from("org-assets")
    .getPublicUrl(path);

  return { url: `${urlData.publicUrl}?v=${Date.now()}`, error: null };
}

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

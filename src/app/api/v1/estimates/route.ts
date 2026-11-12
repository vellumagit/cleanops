import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { apiServerError } from "@/lib/api/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { findOrCreateClient } from "@/lib/find-or-create-client";
import { findCrossOrgRef } from "@/lib/api/org-scope";
import {
  estimatePdfLink,
  fetchPdfFromUrl,
  storeEstimatePdf,
  uploadedPdfProblem,
} from "@/lib/estimate-pdf-storage";

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
  if (error) return apiServerError("estimates", error);

  // pdf_url is a private reference; the caller gets a link that expires.
  const rows = await withPdfLinks(admin, (data ?? []) as Array<{ pdf_url: string | null }>);

  return NextResponse.json({
    data: rows,
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
 * Stored privately. Responses carry `pdf_url` as a signed link that works
 * for an hour; fetch the estimate again for a fresh one.
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
    // A brand-new name arriving here is an INQUIRY, not a customer — this is
    // the endpoint Svitlana's website form posts to. Creating them as a lead is
    // what stops the client list filling up with people who only ever asked a
    // price. An existing client who requests another quote is untouched.
    clientId =
      (await findOrCreateClient(
        admin,
        auth.organizationId,
        {
          name: clientName.trim(),
          email: (body.client_email as string)?.trim(),
          phone: (body.client_phone as string)?.trim(),
          address: (body.client_address as string)?.trim(),
        },
        { createAs: "lead" },
      )) ?? undefined;
    if (!clientId) {
      return NextResponse.json({ error: "Failed to resolve client" }, { status: 500 });
    }
  }

  // A directly-supplied client_id must belong to this org — the insert uses
  // the service-role client (RLS bypassed) and read routes embed
  // client:clients(name,email). (A findOrCreateClient-resolved id is already
  // org-scoped; absent fields are skipped.)
  const badRef = await findCrossOrgRef(admin, auth.organizationId, {
    client_id: body.client_id,
  });
  if (badRef) {
    return NextResponse.json(
      { error: `Invalid ${badRef}: not found in your organization` },
      { status: 400 },
    );
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

  if (error) return apiServerError("estimates", error);

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

  // ── Handle PDF attachment (private bucket; lib/estimate-pdf-storage) ──
  let pdfBytes: Blob | null = null;

  // Option 1: PDF file uploaded via multipart
  if (pdfFile && pdfFile.size > 0) {
    const problem = await uploadedPdfProblem(pdfFile);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    pdfBytes = pdfFile;
  }

  // Option 2: PDF URL provided — download and store
  if (!pdfBytes && body.pdf_url && typeof body.pdf_url === "string") {
    const fetched = await fetchPdfFromUrl(body.pdf_url);
    if (fetched.error !== null) return NextResponse.json({ error: fetched.error }, { status: 400 });
    pdfBytes = fetched.blob;
  }

  if (pdfBytes) {
    const stored = await storeEstimatePdf(admin, auth.organizationId, data.id, pdfBytes);
    if (stored.error !== null) return NextResponse.json({ error: stored.error }, { status: 500 });
    await admin
      .from("estimates" as never)
      .update({ pdf_url: stored.ref } as never)
      .eq("id", data.id);
    data.pdf_url = stored.ref;
  }

  const [out] = await withPdfLinks(admin, [data]);
  dispatchWebhookEvent(auth.organizationId, "estimate.created", out).catch(() => {});

  return NextResponse.json({ data: out }, { status: 201 });
}

// ── Helpers ─────────────────────────────────────────────────

/** Swap each row's stored pdf_url reference for a link that expires. */
async function withPdfLinks<T extends { pdf_url: string | null }>(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  rows: T[],
): Promise<T[]> {
  return Promise.all(rows.map(async (r) => ({ ...r, pdf_url: await estimatePdfLink(admin, r.pdf_url) })));
}

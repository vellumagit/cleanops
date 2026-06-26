/**
 * Public PDF download for invoices. Token-gated — possession of the
 * unguessable public_token is the capability, identical to the /i/[token]
 * HTML page. Mirrors /api/e/[token]/pdf for estimates.
 *
 * Memory/time: PDF rendering (headless Chromium) needs ~1GB and 10–30s on a
 * cold start, so this route gets memory: 1024 + maxDuration: 60 in
 * vercel.json. `runtime: "nodejs"` is required (puppeteer can't run on Edge).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { renderInvoicePdf } from "@/lib/invoice-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  const rl = await checkIpRateLimit("invoice-pdf", 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: invoice } = (await admin
    .from("invoices")
    .select("id, number, public_token, client:clients ( name )")
    .eq("public_token" as never, token as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      number: string | null;
      public_token: string;
      client: { name: string | null } | null;
    } | null;
  };

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  let pdf: Buffer;
  try {
    pdf = await renderInvoicePdf({ publicToken: invoice.public_token });
  } catch (err) {
    console.error("[api/i/pdf] render failed:", err);
    return NextResponse.json(
      {
        error: "PDF generation failed. Try again in a moment.",
        // TEMP diagnostic — remove after debugging the prod render failure.
        detail: err instanceof Error ? err.stack ?? err.message : String(err),
      },
      { status: 500 },
    );
  }

  const slug = String(invoice.number ?? invoice.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const filename = `invoice-${slug || invoice.id}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

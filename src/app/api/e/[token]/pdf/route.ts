/**
 * Public PDF download for estimates. Token-gated — possession of the
 * 16-char unguessable public_token is the capability, identical to
 * the /e/[token] HTML page. Rate-limited at the same threshold as
 * the HTML page to defeat token enumeration.
 *
 * The PDF streams back with Content-Type: application/pdf and an
 * inline disposition so the browser opens it in a new tab. The user
 * can then download via the browser's PDF UI.
 *
 * Memory/time: PDF rendering needs ~1GB and 10–30s during cold starts.
 * `runtime: "nodejs"` is required (puppeteer can't run on Edge).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { renderEstimatePdf } from "@/lib/estimate-pdf";

// Puppeteer + Chromium need Node.js runtime; Edge can't host them.
export const runtime = "nodejs";
// PDF render can take 10–30s on a cold start (Chromium spin-up).
// 60s buys safety margin without changing the function plan.
export const maxDuration = 60;
// Disable static caching — every render is a live capture.
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  // Same rate-limit bucket as the HTML estimate page (30/min/IP).
  // An attacker hitting either path adds to the same counter.
  const rl = await checkIpRateLimit("estimate-pdf", 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      },
    );
  }

  // Verify the token resolves to a real estimate and grab the client
  // name so the downloaded filename is meaningful. Admin client because
  // this route serves unauthenticated customers — the token is the
  // capability and we filter strictly by it.
  const admin = createSupabaseAdminClient();
  const { data: estimate } = (await admin
    .from("estimates")
    .select("id, public_token, client:clients ( name )")
    .eq("public_token" as never, token as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      public_token: string;
      client: { name: string | null } | null;
    } | null;
  };

  if (!estimate) {
    return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  }

  let pdf: Buffer;
  try {
    pdf = await renderEstimatePdf({ publicToken: estimate.public_token });
  } catch (err) {
    console.error("[api/e/pdf] render failed:", err);
    return NextResponse.json(
      { error: "PDF generation failed. Try again in a moment." },
      { status: 500 },
    );
  }

  // Filename slug: take the client name, lowercase, replace non-alnum
  // with hyphens, collapse repeats. Falls back to the estimate id.
  const slug = (estimate.client?.name ?? estimate.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const filename = `estimate-${slug || estimate.id}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // inline so the browser opens the PDF in a tab; the customer
      // can then "save as" via the browser's UI.
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

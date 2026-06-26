/**
 * Public PDF download for invoices. Token-gated — possession of the
 * unguessable public_token is the capability, identical to the /i/[token]
 * HTML page.
 *
 * Pure-JS render (pdf-lib) — no browser, so no special runtime config needed.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { renderInvoicePdf, type InvoicePdfData } from "@/lib/invoice-pdf";
import { getOrgCurrency } from "@/lib/org-currency";
import { formatTaxRate } from "@/lib/invoice-tax";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatDueDate(d: string | null): string | null {
  if (!d) return null;
  // Anchor at noon so the YYYY-MM-DD never slips a day across timezones.
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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
    .select(
      "id, number, due_date, amount_cents, tax_rate_bps, tax_amount_cents, tax_label, organization_id, client:clients ( name, email )",
    )
    .eq("public_token" as never, token as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      number: string | null;
      due_date: string | null;
      amount_cents: number;
      tax_rate_bps: number | null;
      tax_amount_cents: number | null;
      tax_label: string | null;
      organization_id: string;
      client: { name: string | null; email: string | null } | null;
    } | null;
  };

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const [{ data: org }, { data: rawItems }, currency] = await Promise.all([
    admin
      .from("organizations")
      .select("name, brand_color")
      .eq("id", invoice.organization_id)
      .maybeSingle() as unknown as Promise<{
      data: { name: string | null; brand_color: string | null } | null;
    }>,
    admin
      .from("invoice_line_items")
      .select("label, quantity, unit_price_cents, sort_order")
      .eq("invoice_id" as never, invoice.id as never)
      .order("sort_order" as never, { ascending: true } as never) as unknown as Promise<{
      data: Array<{
        label: string;
        quantity: number;
        unit_price_cents: number;
      }> | null;
    }>,
    getOrgCurrency(invoice.organization_id),
  ]);

  const subtotalCents = invoice.amount_cents - (invoice.tax_amount_cents ?? 0);
  const lineItems = (rawItems ?? []).map((r) => ({
    label: r.label,
    quantity: Number(r.quantity) || 0,
    unitPriceCents: r.unit_price_cents,
  }));
  // If the invoice has no line items (subtotal-only invoice), show one line
  // for the whole amount so the PDF isn't an empty table.
  if (lineItems.length === 0) {
    lineItems.push({ label: "Services", quantity: 1, unitPriceCents: subtotalCents });
  }

  const taxLineLabel =
    invoice.tax_amount_cents != null && invoice.tax_rate_bps
      ? `${invoice.tax_label?.trim() || "Tax"} (${formatTaxRate(invoice.tax_rate_bps)})`
      : null;

  const data: InvoicePdfData = {
    invoiceNumber: invoice.number ?? invoice.id.slice(0, 8),
    dueDate: formatDueDate(invoice.due_date),
    orgName: org?.name ?? "Invoice",
    brandColorHex: org?.brand_color ?? null,
    clientName: invoice.client?.name ?? "Customer",
    clientEmail: invoice.client?.email ?? null,
    currency,
    lineItems,
    subtotalCents,
    taxLabel: taxLineLabel,
    taxAmountCents: invoice.tax_amount_cents,
    totalCents: invoice.amount_cents,
  };

  let pdf: Buffer;
  try {
    pdf = await renderInvoicePdf(data);
  } catch (err) {
    console.error("[api/i/pdf] render failed:", err);
    return NextResponse.json(
      { error: "PDF generation failed. Try again in a moment." },
      { status: 500 },
    );
  }

  const slug = String(invoice.number ?? invoice.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${slug || invoice.id}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

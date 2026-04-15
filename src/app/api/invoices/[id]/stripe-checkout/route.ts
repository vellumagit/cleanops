/**
 * Create a Stripe Checkout Session for an invoice. Returns { url } that the
 * ops console can render as "Send payment link to client" or copy-to-clipboard.
 *
 * Access control: the current user must be an owner/admin of the invoice's
 * organization. We re-verify by fetching the invoice through the RLS-bound
 * server client (not the admin client), so only someone with visibility into
 * the row can trigger this.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createInvoiceCheckoutSession } from "@/lib/stripe-connect";
import { isStripeConnectEnabled } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isStripeConnectEnabled()) {
    return NextResponse.json(
      { error: "Stripe Connect is not configured" },
      { status: 503 },
    );
  }

  const { id } = await params;
  await requireMembership(["owner", "admin"]);

  // RLS check — the authenticated user must be able to see this invoice.
  const supabase = await createSupabaseServerClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  const result = await createInvoiceCheckoutSession({
    invoiceId: id,
    successUrl: `${siteUrl}/pay/${id}/success`,
    cancelUrl: `${siteUrl}/pay/${id}/cancelled`,
  });

  if (!result) {
    return NextResponse.json(
      {
        error:
          "Cannot create checkout — invoice may be paid, Stripe not connected, or charges not enabled.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json(result);
}

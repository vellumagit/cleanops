"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { createInvoiceCheckoutLink } from "@/lib/square";

/**
 * Public server action: mint a Square hosted-checkout URL for the invoice
 * identified by its public token, then redirect the caller (the end
 * client) straight to Square.
 *
 * No auth — this is invoked from /i/<token>. We validate:
 *   1. The token resolves to an unpaid, non-void invoice.
 *   2. The org has an active Square connection.
 *   3. The caller hasn't blown a rate limit (prevents someone hammering
 *      this endpoint to burn through Square's payment-link API quota).
 *
 * If anything fails we redirect back to the invoice page with an error
 * flag — never surface raw error strings to the public.
 */
export async function startSquareCheckoutAction(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token || token.length < 8) {
    redirect("/?pay_error=bad_token");
  }

  // 10 requests / minute / IP. Legitimate clients click Pay once, maybe
  // twice. A bot hammering the endpoint hits the limit fast.
  const rl = await checkIpRateLimit("pay-square", 10, 60_000);
  if (!rl.allowed) {
    redirect(`/i/${token}?pay_error=rate_limited`);
  }

  const admin = createSupabaseAdminClient();

  const { data: invoice } = (await admin
    .from("invoices")
    .select(
      "id, organization_id, number, amount_cents, status, voided_at, client:clients ( email ), organization:organizations ( name, default_payment_instructions )",
    )
    .eq("public_token", token)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      number: string | null;
      amount_cents: number;
      status: string;
      voided_at: string | null;
      client: { email: string | null } | null;
      organization: {
        name: string;
        default_payment_instructions: string | null;
      } | null;
    } | null;
  };

  if (!invoice) {
    redirect("/?pay_error=not_found");
  }
  if (invoice.voided_at || invoice.status === "paid") {
    redirect(`/i/${token}?pay_error=already_settled`);
  }
  if (!invoice.amount_cents || invoice.amount_cents <= 0) {
    redirect(`/i/${token}?pay_error=zero_amount`);
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  const successUrl = `${siteUrl}/pay/${invoice.id}/success?token=${token}&provider=square`;

  let link: { url: string; id: string } | null;
  try {
    link = await createInvoiceCheckoutLink({
      organizationId: invoice.organization_id,
      invoiceId: invoice.id,
      amountCents: invoice.amount_cents,
      orgName: invoice.organization?.name ?? "Invoice",
      invoiceNumber:
        invoice.number ?? invoice.id.slice(0, 8).toUpperCase(),
      buyerEmail: invoice.client?.email ?? null,
      successUrl,
    });
  } catch (err) {
    console.error("[square] checkout creation failed:", err);
    redirect(`/i/${token}?pay_error=checkout_failed`);
  }

  if (!link) {
    redirect(`/i/${token}?pay_error=not_connected`);
  }

  // Redirect straight to Square's hosted page.
  redirect(link.url);
}

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordInvoiceTip } from "@/lib/stripe-invoice-payment";

/**
 * Record a completed Square payment against its Sollos invoice.
 *
 * Mirror of recordStripeInvoicePayment, carrying every lesson the Stripe
 * hardening taught, so Square starts life with the scars instead of
 * re-earning them:
 *
 *   - TIP BEFORE DEDUPE. Square's total_money INCLUDES the tip when the
 *     hosted checkout collects one (payment.tip_money). Booking the gross
 *     total as invoice payment would overpay the invoice on paper and owe
 *     the cleaner nothing. The tip is split and recorded first, then the
 *     invoice portion (total minus tip) goes to the ledger.
 *
 *   - A VOIDED INVOICE CAN STILL GET PAID. The payment link outlives a
 *     void. Dropping the event makes the money invisible — charged in
 *     Square, nothing in Sollos, nobody told. Record it truthfully (the
 *     status trigger keeps the invoice void regardless of what the payment
 *     rows sum to) and tell the owners once, with the refund one click
 *     away.
 *
 *   - THE INSERT'S VERDICT DECIDES THE WEBHOOK'S ANSWER. A failed ledger
 *     write THROWS so the webhook can roll back its event claim and 500 —
 *     Square retries with backoff. The old handler discarded the error
 *     after the event was already claimed: one network blip and the
 *     payment was lost forever, retries deduped into silence.
 */
export async function recordSquareInvoicePayment(args: {
  orderId: string;
  squarePaymentId: string;
  /** Square's total_money.amount — GROSS, tip included. */
  totalCents: number;
  /** Square's tip_money.amount, if the checkout collected one. */
  tipCents: number;
  last4: string | null;
  receivedAt: string;
  /** Org resolved from the webhook's merchant_id — must match the invoice. */
  expectedOrgId: string;
}): Promise<void> {
  const admin = createSupabaseAdminClient();

  const tipCents = Math.max(0, Math.round(args.tipCents ?? 0));
  const invoiceAmountCents = Math.max(0, args.totalCents - tipCents);

  const { data: invoice } = (await admin
    .from("invoices" as never)
    .select("id, organization_id, number, voided_at")
    .eq("square_order_id" as never, args.orderId as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      number: string | null;
      voided_at: string | null;
    } | null;
  };

  if (!invoice) {
    // Money moved in Square with no invoice behind it — this is the one
    // shape we can't book. Loud, because someone has to reconcile it.
    console.error(
      `[square] COMPLETED payment ${args.squarePaymentId} has no matching invoice (order ${args.orderId}) — money in Square, nothing in Sollos`,
    );
    return;
  }
  if (invoice.organization_id !== args.expectedOrgId) {
    console.warn(
      `[square] invoice ${invoice.id} is not in org ${args.expectedOrgId}, skipping`,
    );
    return;
  }

  // Tip BEFORE the payment dedupe — same reasoning as Stripe: retried
  // events race, and a tip written only inside the fresh-insert branch is
  // lost whenever the other delivery wins. recordInvoiceTip dedupes on
  // (provider, provider_payment_id) itself.
  if (tipCents > 0) {
    await recordInvoiceTip(admin, {
      invoiceId: invoice.id,
      organizationId: invoice.organization_id,
      tipCents,
      piId: args.squarePaymentId,
      provider: "square",
    });
  }

  const { data: dup } = (await admin
    .from("invoice_payments" as never)
    .select("id")
    .eq("provider" as never, "square" as never)
    .eq("provider_payment_id" as never, args.squarePaymentId as never)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  if (dup) return;

  if (invoiceAmountCents <= 0) return; // charge was entirely tip

  const { error: insertErr } = (await admin
    .from("invoice_payments" as never)
    .insert({
      organization_id: invoice.organization_id,
      invoice_id: invoice.id,
      amount_cents: invoiceAmountCents,
      method: "card",
      reference: args.last4 ? `card ending ${args.last4}` : "Square",
      notes: null,
      received_at: args.receivedAt,
      provider: "square",
      provider_payment_id: args.squarePaymentId,
    } as never)) as unknown as { error: { message: string; code?: string } | null };

  // 23505 = the unique index resolving a concurrent double-delivery — the
  // other writer won, nothing is lost. Anything else must THROW so the
  // webhook rolls back its event claim and Square retries.
  if (insertErr && insertErr.code !== "23505") {
    throw new Error(`square payment ledger insert failed: ${insertErr.message}`);
  }
  if (insertErr) return; // duplicate: the winner handles everything below

  console.log(
    `[square] recorded ${invoiceAmountCents}c payment${
      tipCents ? ` + ${tipCents}c tip` : ""
    } on invoice ${invoice.id}`,
  );

  if (invoice.voided_at) {
    try {
      const { notify } = await import("@/lib/notify");
      await notify({
        organizationId: invoice.organization_id,
        audience: "org-admins",
        type: "billing",
        title: "Payment on a voided invoice",
        body: `A client just paid $${(args.totalCents / 100).toFixed(2)} on ${
          invoice.number ?? "an invoice"
        } — which is void. Their payment link was created before the void. The money is in your Square account with no open invoice behind it; refund the payment from the invoice page.`,
        href: `/app/invoices/${invoice.id}`,
      });
    } catch (err) {
      console.error("[square] void-payment notification failed:", err);
    }
  }

  // Receipt + review request when this payment completed the invoice.
  // Idempotent: autoOnInvoicePaid CAS-claims invoices.receipt_sent_at.
  try {
    const { data: after } = (await admin
      .from("invoices")
      .select("paid_at")
      .eq("id", invoice.id)
      .maybeSingle()) as unknown as {
      data: { paid_at: string | null } | null;
    };
    if (after?.paid_at) {
      const { autoOnInvoicePaid } = await import("@/lib/automations");
      await autoOnInvoicePaid(invoice.id);
    }
  } catch (err) {
    console.error("[square] post-payment automation failed:", err);
  }
}

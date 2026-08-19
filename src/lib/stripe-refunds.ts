import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeEnabled } from "@/lib/stripe";

/**
 * Refunding a client's card payment, from inside Sollos.
 *
 * This has to live in the app because it can't live anywhere else: a
 * destination charge belongs to the PLATFORM's Stripe account, so Svitlana —
 * or any Sollos owner — has no way to refund their own client from their own
 * Stripe dashboard. The charge isn't there. Without this, every refund is a
 * support request to the platform operator, which is fine at one org and
 * absurd at fifty.
 *
 * REVERSE_TRANSFER IS THE LOAD-BEARING PARAMETER. By default, refunding a
 * destination charge leaves the connected account keeping the money and the
 * PLATFORM covering the refund out of its own balance — the merchant gets
 * paid, the software company pays the client back. reverse_transfer: true
 * pulls the funds back from the connected account, so the business that
 * received the money is the business that returns it.
 *
 * THE LEDGER RECONCILES TWICE, AND THAT IS DELIBERATE. The webhook
 * (charge.refunded) is the writer of record — it also covers refunds issued
 * straight from the Stripe dashboard. But whether the dashboard-created
 * endpoint is even subscribed to that event can't be read from the API, and a
 * refund that empties the client's card while the books stay "paid" is not a
 * risk worth taking on faith — so this function also reconciles synchronously
 * after issuing. Both writers call the same recordStripeRefund with the same
 * cumulative number; for the refund shapes this UI can issue, that function
 * is idempotent, so whoever runs second changes nothing.
 *
 * PARTIAL REFUNDS ARE CAPPED AT THE INVOICE PORTION. A charge can be invoice
 * + tip, and successive partial refunds that land INSIDE the tip territory
 * would make the webhook's cumulative clawback arithmetic overshoot. Rather
 * than build refund-tracking machinery onto tip rows for an edge of an edge,
 * the UI makes the ambiguous case impossible: partials stay within the
 * invoice, and the tip only moves on a FULL refund — where clawback deletes
 * every unpaid row and re-running is harmless.
 */

export type RefundResult =
  | { ok: true; refundedCents: number; full: boolean }
  | { ok: false; error: string };

export async function issueStripeRefund(args: {
  organizationId: string;
  paymentId: string;
  /** Cents to refund of the INVOICE portion, or null for a full refund of
   *  everything left on the charge — tip included. */
  amountCents: number | null;
  /** Membership id of the person doing this, for Stripe-side traceability. */
  requestedBy: string;
}): Promise<RefundResult> {
  if (!isStripeEnabled()) {
    return { ok: false, error: "Card payments aren't enabled." };
  }

  const admin = createSupabaseAdminClient();
  const { data: payment } = (await admin
    .from("invoice_payments" as never)
    .select(
      "id, organization_id, invoice_id, amount_cents, refunded_cents, provider, provider_payment_id, provider_fee_cents",
    )
    .eq("id" as never, args.paymentId as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      invoice_id: string;
      amount_cents: number;
      refunded_cents: number | null;
      provider: string | null;
      provider_payment_id: string | null;
      provider_fee_cents: number | null;
    } | null;
  };

  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.organization_id !== args.organizationId) {
    return { ok: false, error: "Payment not found." };
  }
  if (payment.provider !== "stripe" || !payment.provider_payment_id) {
    return {
      ok: false,
      error:
        "Only card payments can be refunded here. For a manual payment, edit or delete the payment row instead.",
    };
  }

  const alreadyRefunded = payment.refunded_cents ?? 0;
  const invoiceRemaining = payment.amount_cents - alreadyRefunded;

  const full = args.amountCents === null;
  if (!full) {
    const amount = Math.round(args.amountCents ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "Enter an amount to refund." };
    }
    if (amount > invoiceRemaining) {
      return {
        ok: false,
        error: `Only ${(invoiceRemaining / 100).toFixed(2)} of the invoice portion is left to refund. To also return a tip, use a full refund.`,
      };
    }
  } else if (invoiceRemaining <= 0) {
    // A prior full refund already emptied the charge; Stripe would error
    // with its own message, but this one says it in the app's voice.
    return { ok: false, error: "This payment has already been fully refunded." };
  }

  try {
    const stripe = getStripe();
    const refund = await stripe.refunds.create({
      payment_intent: payment.provider_payment_id,
      // Omitted on a full refund: Stripe computes the remainder itself,
      // which is the only number guaranteed to include the tip exactly.
      ...(full ? {} : { amount: Math.round(args.amountCents ?? 0) }),
      // The connected account received the money; the connected account
      // funds the refund. See the header comment — without this, the
      // PLATFORM pays the client back while the merchant keeps the money.
      reverse_transfer: true,
      // Only meaningful when a platform fee was actually taken; sending it
      // for a fee-less charge is at best a no-op, so it's conditional.
      ...((payment.provider_fee_cents ?? 0) > 0
        ? { refund_application_fee: true }
        : {}),
      metadata: {
        sollos_invoice_id: payment.invoice_id,
        sollos_requested_by: args.requestedBy,
      },
    });

    // Reconcile the books NOW rather than only trusting the webhook. The
    // charge.refunded subscription on the dashboard-created endpoint can't be
    // verified from the API, and a refund that empties the client's card but
    // never updates the ledger is this week's disease in a new coat. Safe to
    // double-write here because the shapes THIS function can issue — partial
    // capped inside the invoice portion, or full — are exactly the shapes
    // where recordStripeRefund is idempotent: the cumulative clamped write
    // lands on the same number, a zero tip-claw stays zero, and a full claw
    // finds nothing left on the second pass. The one non-idempotent shape
    // (successive partials landing inside tip territory) can only be issued
    // from the Stripe dashboard, where only the webhook writes.
    try {
      const chargeId =
        typeof refund.charge === "string" ? refund.charge : refund.charge?.id;
      if (chargeId) {
        const charge = await stripe.charges.retrieve(chargeId);
        const { recordStripeRefund } = await import(
          "@/lib/stripe-invoice-payment"
        );
        await recordStripeRefund({
          piId: payment.provider_payment_id,
          amountRefundedCents: charge.amount_refunded ?? 0,
          expectedOrgId: payment.organization_id,
        });
      }
    } catch (err) {
      // The refund itself succeeded; the webhook is the backstop for the
      // ledger. Say so rather than failing a refund that already happened.
      console.error("[stripe] refund issued but sync reconcile failed:", err);
    }

    return {
      ok: true,
      refundedCents: refund.amount ?? 0,
      full,
    };
  } catch (err) {
    // Stripe's messages are already human-shaped ("Charge ch_… has already
    // been refunded"); pass them through rather than translating badly.
    const message =
      err instanceof Error ? err.message : "Stripe refused the refund.";
    console.error("[stripe] refund failed:", message);
    return { ok: false, error: message };
  }
}

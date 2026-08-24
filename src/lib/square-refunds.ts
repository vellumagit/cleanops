import "server-only";
import { createHash } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  squareApiBase,
  getValidAccessToken,
  SQUARE_API_VERSION,
} from "@/lib/square";

/**
 * Refund a client's Square payment, from inside Sollos.
 *
 * Simpler than the Stripe version in one important way: Square is connected
 * by OAuth to the SELLER's own account, so the charge lives where the seller
 * can see it and the refund comes straight out of their Square balance — no
 * destination-charge indirection, no reverse_transfer. The reason this
 * exists anyway is the same reason the refund button exists at all: the
 * books. A refund issued from the Square dashboard only reaches Sollos if
 * the webhook happens to be configured and subscribed correctly; a refund
 * issued HERE reconciles synchronously and doesn't take that on faith.
 *
 * Same UI policy as Stripe (the split-arithmetic reason lives in
 * tip-split.ts): partial refunds stay within the invoice portion; the tip
 * only moves on a FULL refund. And because the UI only issues those two
 * shapes, the cumulative gross before any call is exactly the payment row's
 * refunded_cents — which makes the sync reconcile arithmetic honest.
 */

export type SquareRefundResult =
  | { ok: true; refundedCents: number; full: boolean }
  | { ok: false; error: string };

export async function issueSquareRefund(args: {
  organizationId: string;
  paymentId: string;
  /** Cents to refund of the INVOICE portion, or null for a full refund of
   *  everything left on the payment — tip included. */
  amountCents: number | null;
  requestedBy: string;
}): Promise<SquareRefundResult> {
  const admin = createSupabaseAdminClient();

  const { data: payment } = (await admin
    .from("invoice_payments" as never)
    .select(
      "id, organization_id, invoice_id, amount_cents, refunded_cents, provider, provider_payment_id",
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
    } | null;
  };

  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.organization_id !== args.organizationId) {
    return { ok: false, error: "Payment not found." };
  }
  if (payment.provider !== "square" || !payment.provider_payment_id) {
    return { ok: false, error: "This isn't a Square payment." };
  }

  const accessToken = await getValidAccessToken(args.organizationId);
  if (!accessToken) {
    return {
      ok: false,
      error: "Square isn't connected — reconnect it in Settings first.",
    };
  }

  const alreadyRefunded = payment.refunded_cents ?? 0;
  const remainingInvoiceCents = payment.amount_cents - alreadyRefunded;
  if (remainingInvoiceCents <= 0) {
    return { ok: false, error: "This payment is already fully refunded." };
  }

  const full = args.amountCents == null;
  let refundCents: number;
  if (full) {
    // Everything left on the Square payment: the invoice remainder plus
    // whatever tip is still on record. Clawed-back tip rows are deleted by
    // the reconciler, so summing what remains never double-refunds a tip.
    const { data: tipRows } = (await admin
      .from("invoice_tips" as never)
      .select("amount_cents")
      .eq("provider" as never, "square" as never)
      .eq(
        "provider_payment_id" as never,
        payment.provider_payment_id as never,
      )) as unknown as { data: Array<{ amount_cents: number }> | null };
    const tipRemaining = (tipRows ?? []).reduce(
      (s, r) => s + (r.amount_cents ?? 0),
      0,
    );
    refundCents = remainingInvoiceCents + tipRemaining;
  } else {
    refundCents = Math.round(args.amountCents ?? 0);
    if (refundCents <= 0) {
      return { ok: false, error: "Enter an amount above zero." };
    }
    if (refundCents > remainingInvoiceCents) {
      return {
        ok: false,
        error: `Only $${(remainingInvoiceCents / 100).toFixed(2)} of the invoice portion remains refundable. To also return the tip, use a full refund.`,
      };
    }
  }

  // Square requires an idempotency key (max 45 chars) — deterministic over
  // (payment, prior refunded state, amount), so retrying the same intent
  // reuses the same key while the next partial gets a fresh one.
  const idempotencyKey =
    "rf-" +
    createHash("sha256")
      .update(`${payment.id}:${alreadyRefunded}:${refundCents}`)
      .digest("hex")
      .slice(0, 40);

  const res = await fetch(`${squareApiBase()}/v2/refunds`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": SQUARE_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      payment_id: payment.provider_payment_id,
      amount_money: { amount: refundCents, currency: "CAD" },
      reason: `Sollos refund by ${args.requestedBy}`,
    }),
  });

  const json = (await res.json()) as {
    refund?: { id?: string; status?: string };
    errors?: Array<{ detail?: string; code?: string }>;
  };

  if (!res.ok || !json.refund) {
    const msg =
      json.errors?.map((e) => e.detail ?? e.code).join(", ") ??
      `Square refund failed (${res.status})`;
    return { ok: false, error: msg };
  }
  if (json.refund.status === "REJECTED" || json.refund.status === "FAILED") {
    return {
      ok: false,
      error: `Square ${json.refund.status === "REJECTED" ? "rejected" : "failed"} the refund — check the Square dashboard.`,
    };
  }

  // Sync reconcile — the webhook (payment.updated with refunded_money) is
  // the writer of record and also covers dashboard-issued refunds, but its
  // subscription can't be verified from here, and books that stay "paid"
  // after the client's card was emptied are not a risk worth taking on
  // faith. Both writers stamp the same clamped cumulative, so whoever runs
  // second changes nothing.
  try {
    const { recordProviderRefund } = await import(
      "@/lib/stripe-invoice-payment"
    );
    await recordProviderRefund({
      provider: "square",
      piId: payment.provider_payment_id,
      amountRefundedCents: alreadyRefunded + refundCents,
      expectedOrgId: payment.organization_id,
    });
  } catch (err) {
    console.error(
      "[square] sync refund reconcile failed (webhook should catch up):",
      err,
    );
  }

  return { ok: true, refundedCents: refundCents, full };
}

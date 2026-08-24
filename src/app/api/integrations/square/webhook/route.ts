import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookSignature } from "@/lib/square";

/**
 * Square webhook receiver.
 *
 * Square posts events (payment.created, payment.updated, refund.created,
 * etc.) to this URL. We:
 *
 *   1. Verify the HMAC signature against SQUARE_WEBHOOK_SIGNATURE_KEY —
 *      reject anything unsigned or with a wrong signature.
 *   2. Claim the event in `integration_events` (UNIQUE on provider +
 *      event_id), so retries and concurrent deliveries collapse to one
 *      handling.
 *   3. Hand payment.updated / payment.created to the shared recorder.
 *
 * Rebuilt to the standard the Stripe hardening set:
 *
 *   - THE CLAIM ROLLS BACK ON FAILURE. The old handler claimed the event,
 *     then discarded the ledger insert's error — one network blip and the
 *     payment was lost forever, because Square's retry deduped against the
 *     claim of the failed attempt. Now a handler failure deletes the claim
 *     and returns 500, so Square retries with backoff (it keeps trying for
 *     ~72 hours) and the retry actually runs.
 *
 *   - REFUNDS ARE HANDLED, NOT FILED. Square fires payment.updated again
 *     when a refund completes, carrying refunded_money — the CUMULATIVE
 *     total, which plugs straight into the same clamped reconciler Stripe
 *     uses (tip clawback and the one-notification rule included). Without
 *     this, a refund issued from the Square dashboard left the invoice
 *     "paid" forever. The refund.* events themselves stay recorded-but-
 *     ignored: the payment object is the cumulative source of truth.
 *
 *   - TIPS ARE SUBTRACTED. total_money is GROSS. Booking it whole would
 *     overpay the invoice on paper and owe the cleaner nothing.
 *
 * We return 200 for all "processed" outcomes (including "already seen")
 * so Square stops retrying; 4xx only on verification failure; 500 only
 * when handling failed and a retry is genuinely wanted.
 */
export async function POST(request: NextRequest) {
  // The raw body is required for HMAC verification — we read text()
  // before JSON.parse'ing anything.
  const rawBody = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature");

  // The URL Square posted to — must exactly match what's registered in
  // Square's webhook config. We reconstruct it from the request; setting
  // NEXT_PUBLIC_SITE_URL is a safer anchor in case of proxy rewrites.
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const notificationUrl = `${siteUrl}/api/integrations/square/webhook`;

  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }
  if (
    !verifyWebhookSignature({
      notificationUrl,
      rawBody,
      signature,
    })
  ) {
    return NextResponse.json(
      { error: "invalid_signature" },
      { status: 401 },
    );
  }

  let event: {
    event_id?: string;
    merchant_id?: string;
    type?: string;
    data?: {
      type?: string;
      id?: string;
      object?: {
        payment?: {
          id?: string;
          status?: string;
          order_id?: string;
          total_money?: { amount?: number; currency?: string };
          tip_money?: { amount?: number };
          refunded_money?: { amount?: number };
          receipt_url?: string;
          card_details?: { card?: { last_4?: string } };
          created_at?: string;
        };
      };
    };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const eventId = event.event_id;
  const eventType = event.type ?? "unknown";
  const merchantId = event.merchant_id ?? null;

  if (!eventId) {
    return NextResponse.json({ ok: true, ignored: "no_event_id" });
  }

  const admin = createSupabaseAdminClient();

  // Resolve org by merchant_id so we can scope writes correctly.
  const { data: conn } = (await admin
    .from("integration_connections" as never)
    .select("organization_id")
    .eq("provider" as never, "square" as never)
    .eq("external_account_id" as never, merchantId as never)
    .maybeSingle()) as unknown as {
    data: { organization_id: string } | null;
  };
  const orgId = conn?.organization_id ?? null;

  // Claim the event. The UNIQUE index on (provider, event_id) is
  // the real dedupe — a concurrent duplicate delivery hits 23505 here and
  // acks without double-handling.
  const { error: claimErr } = (await admin
    .from("integration_events" as never)
    .insert({
      organization_id: orgId,
      provider: "square",
      event_id: eventId,
      event_type: eventType,
      payload: event,
    } as never)) as unknown as {
    error: { message: string; code?: string } | null;
  };
  if (claimErr) {
    if (claimErr.code === "23505") {
      return NextResponse.json({ ok: true, deduped: true });
    }
    // Couldn't even record the event — let Square retry.
    console.error("[square/webhook] event claim failed:", claimErr.message);
    return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  }

  try {
    if (eventType === "payment.updated" || eventType === "payment.created") {
      const payment = event.data?.object?.payment;

      if (payment && !orgId) {
        // A payment event from a merchant we have no connection for —
        // misconfigured webhook or a foreign merchant. Money may be moving
        // with nowhere to book it; say so loudly.
        console.error(
          `[square/webhook] payment event from unknown merchant ${merchantId} — no org connection matches`,
        );
      }

      if (
        payment?.status === "COMPLETED" &&
        payment.order_id &&
        payment.total_money?.amount != null &&
        orgId
      ) {
        const { recordSquareInvoicePayment } = await import(
          "@/lib/square-invoice-payment"
        );
        await recordSquareInvoicePayment({
          orderId: payment.order_id,
          squarePaymentId: payment.id ?? eventId,
          totalCents: payment.total_money.amount,
          tipCents: payment.tip_money?.amount ?? 0,
          last4: payment.card_details?.card?.last_4 ?? null,
          receivedAt: payment.created_at ?? new Date().toISOString(),
          expectedOrgId: orgId,
        });
      }

      // Cumulative refund state rides on the payment object itself.
      if (
        payment?.id &&
        (payment.refunded_money?.amount ?? 0) > 0 &&
        orgId
      ) {
        const { recordProviderRefund } = await import(
          "@/lib/stripe-invoice-payment"
        );
        await recordProviderRefund({
          provider: "square",
          piId: payment.id,
          amountRefundedCents: payment.refunded_money?.amount ?? 0,
          expectedOrgId: orgId,
        });
      }
    }
  } catch (err) {
    // Roll the claim back so Square's retry isn't deduped into silence,
    // then 500 to ask for that retry.
    console.error(`[square/webhook] handling ${eventType} failed:`, err);
    await admin
      .from("integration_events" as never)
      .delete()
      .eq("provider" as never, "square" as never)
      .eq("event_id" as never, eventId as never);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

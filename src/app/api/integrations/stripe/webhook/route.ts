/**
 * Stripe Connect webhook — separate from the billing webhook. Stripe fires
 * these for events on connected accounts (`account.updated`,
 * `payment_intent.succeeded` on a destination charge, etc).
 *
 * Signed with STRIPE_CONNECT_WEBHOOK_SECRET (distinct from the platform's
 * own billing webhook secret).
 */

import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import {
  verifyWebhookSignature,
  isEventAlreadyProcessed,
  recordEvent,
  isStripeConnectEnabled,
} from "@/lib/stripe";
import { applyAccountUpdate } from "@/lib/stripe-connect";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isStripeConnectEnabled()) {
    return NextResponse.json(
      { error: "Stripe Connect is not configured" },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(
      rawBody,
      signature,
      "STRIPE_CONNECT_WEBHOOK_SECRET",
    );
  } catch (err) {
    console.error("[stripe connect webhook] signature failed", err);
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  if (await isEventAlreadyProcessed(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const admin = createSupabaseAdminClient();
  // Connect events carry the connected account id here.
  const accountId = (event as unknown as { account?: string }).account ?? null;

  try {
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        await applyAccountUpdate(account);
        break;
      }

      case "account.application.deauthorized": {
        // The merchant revoked access from their Stripe Dashboard.
        if (accountId) {
          await admin
            .from("organizations")
            .update({
              stripe_account_id: null,
              stripe_charges_enabled: false,
              stripe_payouts_enabled: false,
              stripe_details_submitted: false,
              stripe_disconnected_at: new Date().toISOString(),
            } as never)
            .eq("stripe_account_id" as never, accountId);
        }
        break;
      }

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const invoiceId =
          (session.metadata && session.metadata.invoice_id) || null;
        if (invoiceId && session.payment_status === "paid") {
          await admin
            .from("invoices")
            .update({
              status: "paid",
              stripe_paid_at: new Date().toISOString(),
              paid_at: new Date().toISOString(),
              stripe_payment_intent_id:
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : session.payment_intent?.id ?? null,
            } as never)
            .eq("id", invoiceId);
        }
        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const invoiceId = pi.metadata?.invoice_id ?? null;
        if (invoiceId) {
          await admin
            .from("invoices")
            .update({
              status: "paid",
              stripe_paid_at: new Date().toISOString(),
              paid_at: new Date().toISOString(),
              stripe_payment_intent_id: pi.id,
              stripe_fee_cents: pi.application_fee_amount ?? null,
            } as never)
            .eq("id", invoiceId);
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const piId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id ?? null;
        if (piId) {
          // Find the invoice by PI id and flip it back.
          await admin
            .from("invoices")
            .update({
              status: "draft",
              paid_at: null,
              stripe_paid_at: null,
            } as never)
            .eq("stripe_payment_intent_id" as never, piId);
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("[stripe connect webhook] handler error", event.type, err);
    return NextResponse.json(
      { error: "Handler failed" },
      { status: 500 },
    );
  }

  await recordEvent(event.id, event.type, accountId);
  return NextResponse.json({ received: true });
}

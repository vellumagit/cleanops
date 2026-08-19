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
  tryClaimEvent,
  markEventProcessed,
  releaseClaim,
  isStripeConnectEnabled,
} from "@/lib/stripe";
import { applyAccountUpdate } from "@/lib/stripe-connect";
import { sendPayoutNotification } from "@/lib/automations";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  recordStripeInvoicePayment,
  recordStripeRefund,
  tipFromMetadata,
} from "@/lib/stripe-invoice-payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 600/min/IP — DoS defense before signature verification.
  const { rateLimitByIp } = await import("@/lib/rate-limit-helpers");
  const limited = await rateLimitByIp(req, "stripe-connect-webhook", 600, 60_000);
  if (limited) return limited;

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

  // Connect events carry the connected account id here.
  const accountId = (event as unknown as { account?: string }).account ?? null;

  // Atomic claim — INSERT on a PK column. The previous SELECT-then-UPSERT
  // pattern had a race where two concurrent Stripe retries could both
  // pass the duplicate check and run the handler twice. With auto-refund
  // and Connect destination charges in the mix, that was a real money
  // bug (double-refund, double-stamp paid).
  const claimed = await tryClaimEvent(event.id, event.type, accountId);
  if (!claimed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const admin = createSupabaseAdminClient();

  /**
   * Resolve which org on our platform owns this Stripe account. Used below
   * to enforce that any invoice touched by this event actually belongs to
   * that org — otherwise a malicious Connect-enabled tenant could forge
   * metadata.invoice_id to flip another org's invoices.
   */
  async function ownerOrgForAccount(
    acct: string | null,
  ): Promise<string | null> {
    if (!acct) return null;
    const { data } = await admin
      .from("organizations")
      .select("id")
      .eq("stripe_account_id" as never, acct as never)
      .maybeSingle() as unknown as {
      data: { id: string } | null;
    };
    return data?.id ?? null;
  }

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
          // Cross-tenant guard: the invoice must belong to the org that
          // owns this connected account (metadata is attacker-controllable).
          const ownerOrgId = await ownerOrgForAccount(accountId);
          if (!ownerOrgId) {
            console.warn(
              `[stripe connect] checkout.session.completed for unknown account ${accountId}, skipping`,
            );
            break;
          }
          await recordStripeInvoicePayment({
            invoiceId,
            expectedOrgId: ownerOrgId,
            amountCents: session.amount_total ?? 0,
            piId:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id ?? null,
            feeCents: null, // not present on the session; the PI event has it
            tipCents: tipFromMetadata(session.metadata),
          });
        }
        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const invoiceId = pi.metadata?.invoice_id ?? null;
        if (invoiceId) {
          const ownerOrgId = await ownerOrgForAccount(accountId);
          if (!ownerOrgId) {
            console.warn(
              `[stripe connect] payment_intent.succeeded for unknown account ${accountId}, skipping`,
            );
            break;
          }
          await recordStripeInvoicePayment({
            invoiceId,
            expectedOrgId: ownerOrgId,
            amountCents: pi.amount_received ?? 0,
            piId: pi.id,
            feeCents: pi.application_fee_amount ?? null,
            tipCents: tipFromMetadata(pi.metadata),
          });
        }
        break;
      }

      case "payout.paid": {
        // Fires on the connected account when Stripe has sent money to
        // the merchant's bank. We notify the owner so they know the
        // deposit is incoming.
        const payout = event.data.object as Stripe.Payout;
        if (accountId) {
          await sendPayoutNotification({
            stripeAccountId: accountId,
            amountCents: payout.amount,
            currency: payout.currency,
            arrivalDateUnix: payout.arrival_date,
            payoutId: payout.id,
          });
        }
        break;
      }

      case "charge.refunded": {
        // Kept for completeness, but for destination charges this event
        // arrives at the PLATFORM endpoint (the charge lives there — the same
        // routing that silently ate every card payment). The shared recorder
        // is the single implementation; this endpoint only ever sees the
        // event for a charge created directly on a connected account.
        const charge = event.data.object as Stripe.Charge;
        const piId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id ?? null;
        const ownerOrgId = await ownerOrgForAccount(accountId);
        if (!ownerOrgId) {
          console.warn(
            `[stripe connect] charge.refunded for unknown account ${accountId}, skipping`,
          );
          break;
        }
        await recordStripeRefund({
          piId,
          amountRefundedCents: charge.amount_refunded ?? 0,
          expectedOrgId: ownerOrgId,
        });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("[stripe connect webhook] handler error", event.type, err);
    // Release the claim row so Stripe's next retry can re-process. The
    // previous "poison-pilled until human investigates" approach silently
    // lost charge.refunded events on transient DB blips — money goes back
    // to the customer but our DB never marks the invoice refunded.
    await releaseClaim(event.id);
    return NextResponse.json(
      { error: "Handler failed" },
      { status: 500 },
    );
  }

  // Stamp processed_at. If THIS fails, release so retry can run cleanly.
  try {
    await markEventProcessed(event.id);
  } catch (err) {
    console.error("[stripe connect webhook] markEventProcessed failed:", err);
    await releaseClaim(event.id);
    return NextResponse.json(
      { error: "Failed to stamp processed_at" },
      { status: 500 },
    );
  }
  return NextResponse.json({ received: true });
}

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
import { sendPayoutNotification } from "@/lib/automations";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

  if (await isEventAlreadyProcessed(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const admin = createSupabaseAdminClient();
  // Connect events carry the connected account id here.
  const accountId = (event as unknown as { account?: string }).account ?? null;

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
          // CRITICAL: enforce that the invoice belongs to the org that
          // owns this Stripe account. Without this filter, a malicious
          // Connect-enabled tenant could forge metadata.invoice_id to
          // flip another org's invoice to paid.
          const ownerOrgId = await ownerOrgForAccount(accountId);
          if (!ownerOrgId) {
            console.warn(
              `[stripe connect] checkout.session.completed for unknown account ${accountId}, skipping`,
            );
            break;
          }
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
            .eq("id", invoiceId)
            .eq("organization_id", ownerOrgId);
        }
        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const invoiceId = pi.metadata?.invoice_id ?? null;
        if (invoiceId) {
          // Same cross-tenant guard as checkout.session.completed —
          // metadata is attacker-controlled when the PI is created
          // outside our code.
          const ownerOrgId = await ownerOrgForAccount(accountId);
          if (!ownerOrgId) {
            console.warn(
              `[stripe connect] payment_intent.succeeded for unknown account ${accountId}, skipping`,
            );
            break;
          }
          await admin
            .from("invoices")
            .update({
              status: "paid",
              stripe_paid_at: new Date().toISOString(),
              paid_at: new Date().toISOString(),
              stripe_payment_intent_id: pi.id,
              stripe_fee_cents: pi.application_fee_amount ?? null,
            } as never)
            .eq("id", invoiceId)
            .eq("organization_id", ownerOrgId);
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
        const charge = event.data.object as Stripe.Charge;
        const piId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id ?? null;
        if (piId) {
          // PI ids are globally unique (not guessable) so the cross-tenant
          // forgery risk is lower, but we still enforce the org filter
          // defensively in case an attacker has observed a legitimate PI id.
          const ownerOrgId = await ownerOrgForAccount(accountId);
          if (!ownerOrgId) {
            console.warn(
              `[stripe connect] charge.refunded for unknown account ${accountId}, skipping`,
            );
            break;
          }
          await admin
            .from("invoices")
            .update({
              status: "draft",
              paid_at: null,
              stripe_paid_at: null,
            } as never)
            .eq("stripe_payment_intent_id" as never, piId)
            .eq("organization_id", ownerOrgId);
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

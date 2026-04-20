/**
 * Stripe billing webhook — handles subscription lifecycle events for our
 * own SaaS billing (charging Sollos 3 customers their $49/$99 subscription).
 *
 * Security:
 *   1. Signature MUST verify against STRIPE_WEBHOOK_SECRET.
 *   2. Idempotency: we record every event.id in `stripe_events` and
 *      short-circuit duplicates.
 *   3. Service-role client is used because subscription writes bypass RLS
 *      by design (the org's users don't directly write this table).
 *
 * Events handled:
 *   - checkout.session.completed       (first successful checkout)
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.payment_succeeded
 *   - invoice.payment_failed
 */

import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import {
  isStripeEnabled,
  verifyWebhookSignature,
  isEventAlreadyProcessed,
  recordEvent,
  getPlanFromPriceId,
} from "@/lib/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function upsertSubscriptionFromStripe(sub: Stripe.Subscription) {
  const admin = createSupabaseAdminClient();
  const organization_id =
    (sub.metadata && sub.metadata.organization_id) || null;
  if (!organization_id) return;

  const firstItem = sub.items.data[0];
  const priceId = firstItem?.price.id ?? null;
  const plan = getPlanFromPriceId(priceId);
  // In the Dahlia API version, current_period_end lives on the subscription
  // item, not the subscription. Fall back to the item if needed.
  const currentPeriodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    firstItem?.current_period_end ??
    null;

  await admin.from("subscriptions").upsert(
    {
      organization_id,
      stripe_customer_id:
        typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      plan_tier: plan,
      status: sub.status,
      current_period_end: currentPeriodEnd
        ? new Date(currentPeriodEnd * 1000).toISOString()
        : null,
      cancel_at_period_end: sub.cancel_at_period_end,
      trial_ends_at: sub.trial_end
        ? new Date(sub.trial_end * 1000).toISOString()
        : null,
    } as never,
    { onConflict: "organization_id" },
  );
}

export async function POST(req: NextRequest) {
  // 600/min/IP — way above Stripe's legitimate retry volume but blocks
  // scripted DoS. Signature verification is the real auth; this is defense
  // in depth against unauthenticated traffic before we do crypto work.
  const { rateLimitByIp } = await import("@/lib/rate-limit-helpers");
  const limited = await rateLimitByIp(req, "stripe-webhook", 600, 60_000);
  if (limited) return limited;

  if (!isStripeEnabled()) {
    return NextResponse.json(
      { error: "Stripe is not enabled in this environment." },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(rawBody, signature, "STRIPE_WEBHOOK_SECRET");
  } catch (err) {
    console.error("[stripe webhook] signature verification failed", err);
    return NextResponse.json(
      { error: "Invalid Stripe signature." },
      { status: 400 },
    );
  }

  // Idempotency — Stripe retries, so we dedupe on event id.
  if (await isEventAlreadyProcessed(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const organization_id =
          (session.metadata && session.metadata.organization_id) || null;
        if (organization_id && session.subscription) {
          // Pull the subscription to get up-to-date status + period info.
          // We do this via the Stripe API on the subscription id so the
          // upsert is consistent with the subscription.* events.
          // The subscription.created event is also fired, so this is a
          // belt-and-braces write in case events arrive out of order.
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const { getStripe } = await import("@/lib/stripe");
          const stripe = getStripe();
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscriptionFromStripe(sub);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await upsertSubscriptionFromStripe(sub);
        break;
      }

      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        // We don't mirror invoice rows for SaaS billing — Stripe's portal
        // is the source of truth. But we can refresh subscription status,
        // since a failed payment may flip status to 'past_due'.
        const invoice = event.data.object as Stripe.Invoice;
        const subRef = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
        if (subRef) {
          const subId = typeof subRef === "string" ? subRef : subRef.id;
          const { getStripe } = await import("@/lib/stripe");
          const stripe = getStripe();
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscriptionFromStripe(sub);
        }
        break;
      }

      default:
        // Ignore other events — Stripe wants a 200 so it stops retrying.
        break;
    }
  } catch (err) {
    console.error("[stripe webhook] handler error", event.type, err);
    // Re-throw by returning 500 so Stripe retries. Do NOT record the event
    // as processed on failure.
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 },
    );
  }

  await recordEvent(event.id, event.type, null);
  return NextResponse.json({ received: true });
}

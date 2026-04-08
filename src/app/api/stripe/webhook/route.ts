/**
 * Stripe webhook route — scaffolded but DISABLED until STRIPE_ENABLED=true.
 *
 * Stripe sends signed POST requests to this URL whenever a subscription
 * changes state. The handler should:
 *
 *   1. Read the raw body and the `stripe-signature` header.
 *   2. Verify the signature against STRIPE_WEBHOOK_SECRET.
 *   3. Switch on `event.type` and upsert the corresponding row in the
 *      `subscriptions` table using the service-role client.
 *
 * For now we return 503 unless the feature flag is on. When you flip the
 * flag, replace `verifyStripeSignaturePlaceholder` with the real verifier
 * (see src/lib/stripe.ts for the migration steps).
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  isStripeEnabled,
  verifyStripeSignaturePlaceholder,
} from "@/lib/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Stripe sends application/json — disable Next's automatic body parsing so
// the raw text is preserved for signature verification.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isStripeEnabled()) {
    return NextResponse.json(
      { error: "Stripe is not enabled in this environment." },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  const event = verifyStripeSignaturePlaceholder(rawBody, signature);
  if (!event) {
    // The placeholder always returns null. Once the real verifier is wired
    // up, a null result here means the signature failed to validate.
    return NextResponse.json(
      { error: "Invalid Stripe signature." },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  // Skeleton dispatch — fill in once the real Stripe types are imported.
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as {
        id?: string;
        customer?: string;
        status?: string;
        items?: { data?: Array<{ price?: { id?: string } }> };
        current_period_end?: number;
        cancel_at_period_end?: boolean;
        trial_end?: number | null;
        metadata?: { organization_id?: string };
      };

      const organization_id = sub.metadata?.organization_id;
      if (!organization_id) break;

      await admin.from("subscriptions").upsert(
        {
          organization_id,
          stripe_customer_id: sub.customer ?? null,
          stripe_subscription_id: sub.id ?? null,
          stripe_price_id: sub.items?.data?.[0]?.price?.id ?? null,
          status: sub.status ?? null,
          current_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
          cancel_at_period_end: sub.cancel_at_period_end ?? false,
          trial_ends_at: sub.trial_end
            ? new Date(sub.trial_end * 1000).toISOString()
            : null,
        },
        { onConflict: "organization_id" },
      );
      break;
    }

    default:
      // Ignore unsubscribed events. Stripe accepts a 200 here.
      break;
  }

  return NextResponse.json({ received: true });
}

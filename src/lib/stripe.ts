/**
 * Stripe SaaS billing (charging customers of Sollos 3 the $49/$99/Enterprise
 * subscription). Connect logic lives in `stripe-connect.ts`.
 *
 * Security posture:
 *   - Secret keys never touch the client bundle (this module is server-only).
 *   - All webhook bodies are verified against STRIPE_WEBHOOK_SECRET before
 *     any DB write.
 *   - Every webhook event is idempotency-checked against `stripe_events` so
 *     Stripe's at-least-once delivery can't cause double-writes.
 *   - Customer creation uses a deterministic metadata link (organization_id)
 *     and an idempotency key derived from the org id.
 *   - Nothing here trusts data from the browser — all price_ids and org_ids
 *     are looked up server-side from the authenticated membership.
 */

import "server-only";
import Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export function isStripeEnabled(): boolean {
  return process.env.STRIPE_ENABLED === "true";
}

export function isStripeConnectEnabled(): boolean {
  return (
    isStripeEnabled() &&
    Boolean(process.env.STRIPE_CONNECT_CLIENT_ID) &&
    Boolean(process.env.STRIPE_CONNECT_WEBHOOK_SECRET)
  );
}

let _client: Stripe | null = null;

/**
 * Lazy singleton. Throws if STRIPE_SECRET_KEY is missing at call-time,
 * which is the correct behavior — the caller should have gated on
 * isStripeEnabled() first.
 */
export function getStripe(): Stripe {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Gate the caller on isStripeEnabled().",
    );
  }
  _client = new Stripe(key, {
    // Pin the API version so upgrades don't silently change response shapes.
    apiVersion: "2026-03-25.dahlia",
    typescript: true,
    appInfo: {
      name: "Sollos 3",
      url: "https://sollos3.com",
    },
  });
  return _client;
}

export type PlanTier = "starter" | "growth" | "enterprise";

/**
 * Map from our internal plan name to the Stripe Price ID. Price IDs come
 * from the Stripe Dashboard (Products → your product → Pricing section).
 */
export function getPriceIdForPlan(plan: PlanTier): string | null {
  switch (plan) {
    case "starter":
      return process.env.STRIPE_PRICE_STARTER ?? null;
    case "growth":
      return process.env.STRIPE_PRICE_GROWTH ?? null;
    case "enterprise":
      return null;
  }
}

export function getPlanFromPriceId(priceId: string | null): PlanTier | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId === process.env.STRIPE_PRICE_GROWTH) return "growth";
  return null;
}

/**
 * Find or create a Stripe Customer for the given organization. Two layers
 * of idempotency:
 *   1. Check `subscriptions.stripe_customer_id` first.
 *   2. If not, create with an idempotency key tied to the org id, so
 *      retries don't create duplicates.
 */
export async function getOrCreateStripeCustomer(args: {
  organizationId: string;
  email: string;
  name?: string | null;
}): Promise<string> {
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const stripe = getStripe();
  const customer = await stripe.customers.create(
    {
      email: args.email,
      name: args.name ?? undefined,
      metadata: { organization_id: args.organizationId },
    },
    { idempotencyKey: `org_customer_create_${args.organizationId}` },
  );

  await admin.from("subscriptions").upsert(
    {
      organization_id: args.organizationId,
      stripe_customer_id: customer.id,
      billing_email: args.email,
    } as never,
    { onConflict: "organization_id" },
  );

  return customer.id;
}

export async function createCheckoutSession(args: {
  organizationId: string;
  email: string;
  plan: PlanTier;
  successUrl: string;
  cancelUrl: string;
}): Promise<string | null> {
  const priceId = getPriceIdForPlan(args.plan);
  if (!priceId) return null;

  const customerId = await getOrCreateStripeCustomer({
    organizationId: args.organizationId,
    email: args.email,
  });

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    allow_promotion_codes: true,
    subscription_data: {
      trial_period_days: 21,
      metadata: { organization_id: args.organizationId },
    },
    metadata: { organization_id: args.organizationId },
  });

  return session.url ?? null;
}

export async function createBillingPortalSession(args: {
  organizationId: string;
  returnUrl: string;
}): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  if (!sub?.stripe_customer_id) return null;

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: args.returnUrl,
  });
  return session.url;
}

/**
 * Verify a webhook body against the appropriate webhook secret. Throws on
 * failure. Callers MUST pass raw text — no JSON parsing — or the signature
 * will not match.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secretEnvVar:
    | "STRIPE_WEBHOOK_SECRET"
    | "STRIPE_CONNECT_WEBHOOK_SECRET" = "STRIPE_WEBHOOK_SECRET",
): Stripe.Event {
  if (!signatureHeader) throw new Error("Missing stripe-signature header");
  const secret = process.env[secretEnvVar];
  if (!secret) throw new Error(`${secretEnvVar} is not set`);
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
}

export async function isEventAlreadyProcessed(
  eventId: string,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("stripe_events" as never)
    .select("processed_at")
    .eq("id", eventId)
    .maybeSingle();
  return Boolean((data as { processed_at: string | null } | null)?.processed_at);
}

export async function recordEvent(
  eventId: string,
  type: string,
  accountId: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.from("stripe_events" as never).upsert(
    {
      id: eventId,
      type,
      account_id: accountId,
      processed_at: new Date().toISOString(),
    } as never,
    { onConflict: "id" },
  );
}

// Legacy export kept for the old placeholder import — no-op wrapper around
// the real verifier so nothing breaks.
export type StripeWebhookEvent = Stripe.Event;
export function verifyStripeSignaturePlaceholder(
  rawBody: string,
  signatureHeader: string | null,
): Stripe.Event | null {
  try {
    return verifyWebhookSignature(rawBody, signatureHeader);
  } catch {
    return null;
  }
}

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
      trial_period_days: 14,
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

/**
 * Atomically claim an event slot by INSERTing into stripe_events with
 * processed_at = null. Returns true if this process is the sole handler
 * for this event; false if a concurrent request (or a prior run) already
 * claimed it.
 *
 * This replaces the old SELECT → process → UPSERT pattern, which had a
 * race window where two Stripe retries could both pass the SELECT at the
 * same millisecond and both execute the handler. INSERT on a PRIMARY KEY
 * table is atomic — exactly one caller wins.
 *
 * If the handler succeeds, call markEventProcessed(). If it FAILS, call
 * releaseClaim(eventId) to delete the row so Stripe's next retry can
 * cleanly re-attempt — without this, a transient handler error
 * permanently poisons the event (Stripe retries → tryClaimEvent returns
 * false → handler never runs → state in our DB is permanently stale).
 */
export async function tryClaimEvent(
  eventId: string,
  type: string,
  accountId: string | null,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("stripe_events" as never).insert({
    id: eventId,
    type,
    account_id: accountId,
    processed_at: null,
  } as never);
  if (error) {
    // 23505 = unique_violation — another request already claimed this event.
    const pgError = error as { code?: string };
    if (pgError.code === "23505") return false;
    throw error;
  }
  return true;
}

/**
 * Release a previously-claimed event so Stripe's next retry can re-process
 * it from scratch. Use this in the catch path of webhook handlers — if we
 * don't release, the half-processed row blocks future retries forever.
 */
export async function releaseClaim(eventId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("stripe_events" as never)
    .delete()
    .eq("id" as never, eventId as never)
    .is("processed_at" as never, null as never); // safety: only release UN-stamped rows
  if (error) {
    // If we can't release, log loudly — manual cleanup may be needed.
    console.error(
      "[stripe] releaseClaim failed; event may be permanently stuck:",
      eventId,
      error,
    );
  }
}

/**
 * Stamp processed_at after a successful handler run.
 * Errors are surfaced — a silent failure here means Stripe will retry
 * and tryClaimEvent will refuse, leaving the event in a successful-but-
 * not-stamped state. Caller should catch and decide whether to retry
 * the stamp or alert.
 */
export async function markEventProcessed(eventId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("stripe_events" as never)
    .update({ processed_at: new Date().toISOString() } as never)
    .eq("id" as never, eventId as never);
  if (error) {
    console.error(
      "[stripe] markEventProcessed failed for event:",
      eventId,
      error,
    );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// SMS metered overage (Phase 1, model B).
//
// SMS is included in the plan up to a monthly segment allotment; only overage
// past it is billed, as a metered subscription item on the org's EXISTING
// subscription. Comped orgs never get the item (overage waived). See
// docs/sms-phase1-spec.md and src/lib/sms.ts.
// ---------------------------------------------------------------------------

/**
 * Ensure the org's subscription carries the metered SMS-overage item, and
 * return its id. Idempotent. Returns null when overage can't be metered —
 * Stripe disabled, no overage price configured, org comped, or no live Stripe
 * subscription (nothing to attach to). Stores the id on organizations.
 */
export async function ensureSmsOverageItem(
  organizationId: string,
): Promise<string | null> {
  const priceId = process.env.STRIPE_PRICE_SMS_OVERAGE;
  if (!isStripeEnabled() || !priceId) return null;

  const admin = createSupabaseAdminClient();

  const { data: orgRow } = (await admin
    .from("organizations")
    .select("billing_override, sms_overage_item_id")
    .eq("id", organizationId)
    .maybeSingle()) as unknown as {
    data: { billing_override: string | null; sms_overage_item_id: string | null } | null;
  };

  // Comped orgs are never billed for overage — no item.
  if (!orgRow || orgRow.billing_override) return null;
  if (orgRow.sms_overage_item_id) return orgRow.sms_overage_item_id;

  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const subscriptionId = sub?.stripe_subscription_id ?? null;
  if (!subscriptionId) return null; // no live subscription to attach to

  const stripe = getStripe();
  // No static idempotency key: the sms_overage_item_id guard above already
  // prevents duplicates, and a reused key would return a STALE (possibly
  // deleted) item after a disable→re-enable within Stripe's 24h key window.
  const item = await stripe.subscriptionItems.create({
    subscription: subscriptionId,
    price: priceId,
  });

  await (admin
    .from("organizations")
    .update({ sms_overage_item_id: item.id } as never)
    .eq("id", organizationId) as unknown as Promise<unknown>);

  return item.id;
}

/** Remove the metered overage item (on SMS disable) and clear the stored id. */
export async function removeSmsOverageItem(
  organizationId: string,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: orgRow } = (await admin
    .from("organizations")
    .select("sms_overage_item_id")
    .eq("id", organizationId)
    .maybeSingle()) as unknown as {
    data: { sms_overage_item_id: string | null } | null;
  };

  const itemId = orgRow?.sms_overage_item_id ?? null;
  if (itemId && isStripeEnabled()) {
    try {
      await getStripe().subscriptionItems.del(itemId, { clear_usage: true });
    } catch (err) {
      console.error("[stripe] removeSmsOverageItem failed:", err);
    }
  }

  await (admin
    .from("organizations")
    .update({ sms_overage_item_id: null } as never)
    .eq("id", organizationId) as unknown as Promise<unknown>);
}

/**
 * Report `quantity` overage segments against the metered subscription item.
 * Best-effort, guarded on isStripeEnabled(). Uses metered usage records (the
 * classic pairing for a metered Price); if you migrate to Stripe Billing Meters,
 * swap the body for a meterEvents.create keyed on the customer.
 */
export async function reportSmsOverageUsage(
  subscriptionItemId: string,
  quantity: number,
): Promise<void> {
  if (!isStripeEnabled() || quantity <= 0) return;
  const stripe = getStripe();
  // createUsageRecord isn't in the pinned SDK's typed surface for all price
  // shapes — call through a minimal structural type.
  const usage = (
    stripe.subscriptionItems as unknown as {
      createUsageRecord?: (
        item: string,
        params: { quantity: number; action: "increment"; timestamp: "now" },
      ) => Promise<unknown>;
    }
  ).createUsageRecord;
  if (!usage) {
    console.error("[stripe] createUsageRecord unavailable — overage not metered");
    return;
  }
  await usage(subscriptionItemId, { quantity, action: "increment", timestamp: "now" });
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

/**
 * Stripe scaffolding (Phase 10).
 *
 * Stripe is wired into the schema, the webhook route, and a billing portal
 * stub page, but DISABLED by default. Flip `STRIPE_ENABLED=true` in the
 * environment once you're ready to start charging — until then, every
 * Stripe code path short-circuits and the webhook route returns 503.
 *
 * No Stripe SDK is imported here so the build does not need the package
 * installed yet. When you turn this on:
 *
 *   1. pnpm add stripe
 *   2. Replace `verifyStripeSignaturePlaceholder` with the real call:
 *        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
 *        const event = stripe.webhooks.constructEvent(
 *          rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!
 *        );
 *   3. Set STRIPE_ENABLED=true in Vercel env vars.
 *
 * Until then this module exposes:
 *   - `isStripeEnabled()` — feature flag the UI checks
 *   - `verifyStripeSignaturePlaceholder()` — typed stub the webhook calls
 */

import "server-only";

export function isStripeEnabled(): boolean {
  return process.env.STRIPE_ENABLED === "true";
}

export type StripeWebhookEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

/**
 * PLACEHOLDER signature verifier.
 *
 * The real implementation MUST use `stripe.webhooks.constructEvent` so the
 * signature is checked against `STRIPE_WEBHOOK_SECRET`. Until Stripe is
 * enabled, this stub refuses to parse anything.
 */
export function verifyStripeSignaturePlaceholder(
  _rawBody: string,
  _signature: string | null,
): StripeWebhookEvent | null {
  return null;
}

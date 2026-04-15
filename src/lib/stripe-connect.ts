/**
 * Stripe Connect — lets a customer organization (e.g. a cleaning company)
 * connect their own Stripe account, so they can accept card payments from
 * THEIR end-clients through Sollos 3.
 *
 * Model: Standard accounts + OAuth.
 *
 *   - The org owner clicks "Connect Stripe" in Settings → Integrations.
 *   - We redirect them to Stripe's hosted OAuth consent screen.
 *   - They sign in / create a Stripe account and approve the connection.
 *   - Stripe redirects back to /api/integrations/stripe/callback?code=...&state=...
 *   - We exchange the code for an `access_token` + `stripe_user_id`, save
 *     only the `stripe_user_id` (account id) to the organization row, then
 *     discard the access token. (Stripe recommends API calls go through
 *     our platform key with `stripeAccount` header, not the stored token.)
 *
 * Checkout for a specific invoice uses `transfer_data.destination` and
 * `application_fee_amount` — the canonical "destination charge" model. The
 * end-client pays on a Stripe-hosted page; funds land in the org's Stripe
 * account minus Stripe's card fee and our application fee.
 *
 * Security posture:
 *   - OAuth uses a single-use CSRF token (`stripe_oauth_states` table),
 *     10-minute TTL, scoped to (organization_id, membership_id).
 *   - Callback rejects any state we didn't issue or that has expired.
 *   - We never trust the `state` alone — we re-verify the current user's
 *     membership matches the state's recorded membership before writing.
 *   - Application fee is clamped to the org's configured bps.
 *   - Connect webhook is verified with its own secret (separate from the
 *     platform/billing webhook).
 */

import "server-only";
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeConnectEnabled } from "@/lib/stripe";

/**
 * Generate a one-time CSRF state and persist it.
 */
export async function issueOAuthState(args: {
  organizationId: string;
  membershipId: string;
}): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  const admin = createSupabaseAdminClient();
  await admin.from("stripe_oauth_states" as never).insert({
    state,
    organization_id: args.organizationId,
    membership_id: args.membershipId,
  } as never);
  return state;
}

/**
 * Build the Stripe Connect OAuth authorize URL.
 *
 * Returns null if Connect is not configured, so callers can render a
 * friendly message instead of a broken link.
 */
export function buildOAuthUrl(args: {
  state: string;
  redirectUri: string;
}): string | null {
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!clientId) return null;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "read_write",
    state: args.state,
    redirect_uri: args.redirectUri,
    // Ask Stripe to prefill what it can — makes onboarding faster.
    "stripe_user[business_type]": "company",
  });
  return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
}

/**
 * Consume a state token and return the associated (organization, membership).
 * Deletes the state so it can't be replayed.
 *
 * Throws if state is missing, expired, or unknown.
 */
export async function consumeOAuthState(
  state: string,
): Promise<{ organizationId: string; membershipId: string }> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("stripe_oauth_states" as never)
    .select("organization_id, membership_id, expires_at")
    .eq("state", state)
    .maybeSingle();

  const row = data as {
    organization_id: string;
    membership_id: string;
    expires_at: string;
  } | null;

  if (!row) throw new Error("Unknown OAuth state");
  if (new Date(row.expires_at) < new Date()) {
    throw new Error("OAuth state expired");
  }

  // Delete immediately — one-time use.
  await admin
    .from("stripe_oauth_states" as never)
    .delete()
    .eq("state", state);

  return {
    organizationId: row.organization_id,
    membershipId: row.membership_id,
  };
}

/**
 * Exchange an authorization code for a connected account id.
 * Returns the `stripe_user_id` (the connected account id, starts with `acct_`).
 */
export async function completeOAuth(
  code: string,
): Promise<{ accountId: string }> {
  if (!isStripeConnectEnabled()) {
    throw new Error("Stripe Connect is not configured");
  }
  const stripe = getStripe();
  const response = await stripe.oauth.token({
    grant_type: "authorization_code",
    code,
  });

  if (!response.stripe_user_id) {
    throw new Error("Stripe did not return a connected account id");
  }
  return { accountId: response.stripe_user_id };
}

/**
 * Save a connected account to the org, then immediately fetch the account's
 * capabilities so the UI can show whether the merchant can accept payments.
 */
export async function saveConnectedAccount(args: {
  organizationId: string;
  accountId: string;
}): Promise<void> {
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(args.accountId);

  const admin = createSupabaseAdminClient();
  await admin
    .from("organizations")
    .update({
      stripe_account_id: account.id,
      stripe_account_type: account.type ?? null,
      stripe_charges_enabled: Boolean(account.charges_enabled),
      stripe_payouts_enabled: Boolean(account.payouts_enabled),
      stripe_details_submitted: Boolean(account.details_submitted),
      stripe_connected_at: new Date().toISOString(),
      stripe_disconnected_at: null,
    } as never)
    .eq("id", args.organizationId);
}

/**
 * Disconnect by deauthorizing on Stripe's side AND clearing our row.
 * Both are best-effort — if Stripe returns "already revoked", we still
 * clear locally.
 */
export async function disconnectAccount(args: {
  organizationId: string;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("stripe_account_id")
    .eq("id", args.organizationId)
    .maybeSingle();

  const accountId = (data as { stripe_account_id: string | null } | null)
    ?.stripe_account_id;

  if (accountId && process.env.STRIPE_CONNECT_CLIENT_ID) {
    try {
      const stripe = getStripe();
      await stripe.oauth.deauthorize({
        client_id: process.env.STRIPE_CONNECT_CLIENT_ID,
        stripe_user_id: accountId,
      });
    } catch {
      // Swallow — merchant may have already revoked from their Stripe dash.
    }
  }

  await admin
    .from("organizations")
    .update({
      stripe_account_id: null,
      stripe_account_type: null,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_details_submitted: false,
      stripe_disconnected_at: new Date().toISOString(),
    } as never)
    .eq("id", args.organizationId);
}

/**
 * Create a Checkout Session for a specific invoice using the destination
 * charge model. The end-client pays on Stripe; funds settle to the
 * connected account; our application fee is collected separately.
 *
 * @param invoiceId  The Sollos invoice row the session is for.
 * @param successUrl Where Stripe redirects on payment success.
 * @param cancelUrl  Where Stripe redirects if the client bails.
 */
export async function createInvoiceCheckoutSession(args: {
  invoiceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string } | null> {
  const admin = createSupabaseAdminClient();

  const { data: invoiceRaw } = await admin
    .from("invoices")
    .select(
      "id, organization_id, client_id, amount_cents, status",
    )
    .eq("id", args.invoiceId)
    .maybeSingle();

  const invoice = invoiceRaw as {
    id: string;
    organization_id: string;
    client_id: string;
    amount_cents: number;
    status: string;
  } | null;

  if (!invoice) return null;
  if (invoice.status === "paid") return null;
  if (!invoice.amount_cents || invoice.amount_cents <= 0) return null;

  const { data: org } = await admin
    .from("organizations")
    .select(
      "id, name, stripe_account_id, stripe_charges_enabled, stripe_application_fee_bps",
    )
    .eq("id", invoice.organization_id)
    .maybeSingle();

  const orgRow = org as {
    id: string;
    name: string;
    stripe_account_id: string | null;
    stripe_charges_enabled: boolean;
    stripe_application_fee_bps: number;
  } | null;

  if (!orgRow?.stripe_account_id || !orgRow.stripe_charges_enabled) {
    return null;
  }

  const { data: client } = await admin
    .from("clients")
    .select("name, email")
    .eq("id", invoice.client_id)
    .maybeSingle();

  // Platform fee in cents, clamped to non-negative.
  const feeCents = Math.max(
    0,
    Math.round((invoice.amount_cents * orgRow.stripe_application_fee_bps) / 10000),
  );

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer_email: client?.email ?? undefined,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: invoice.amount_cents,
            product_data: {
              name: `Invoice from ${orgRow.name}`,
              description: `Invoice #${invoice.id.slice(0, 8).toUpperCase()}`,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination: orgRow.stripe_account_id },
        metadata: {
          invoice_id: invoice.id,
          organization_id: orgRow.id,
        },
      },
      metadata: {
        invoice_id: invoice.id,
        organization_id: orgRow.id,
      },
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
    },
    // Scope the session to the org id + invoice id so repeated clicks on
    // "Send payment link" produce the same session instead of piling up.
    {
      idempotencyKey: `invoice_checkout_${invoice.id}`,
    },
  );

  if (session.url) {
    await admin
      .from("invoices")
      .update({
        stripe_checkout_session_id: session.id,
        stripe_payment_url: session.url,
      } as never)
      .eq("id", invoice.id);
  }

  return session.url
    ? { url: session.url, sessionId: session.id }
    : null;
}

/**
 * Update the org's cached Connect capability flags based on an
 * `account.updated` webhook payload.
 */
export async function applyAccountUpdate(account: Stripe.Account): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("organizations")
    .update({
      stripe_charges_enabled: Boolean(account.charges_enabled),
      stripe_payouts_enabled: Boolean(account.payouts_enabled),
      stripe_details_submitted: Boolean(account.details_submitted),
    } as never)
    .eq("stripe_account_id" as never, account.id);
}

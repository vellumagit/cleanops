/**
 * Square Connect — lets a customer organization (cleaning company) connect
 * their own Square account so they can accept card payments from THEIR
 * end-clients through Sollos 3.
 *
 * Model: OAuth2 with refresh tokens.
 *
 *   - The org owner clicks "Connect Square" in Settings → Integrations.
 *   - We redirect them to Square's hosted OAuth consent page.
 *   - They sign in / approve the scopes.
 *   - Square redirects back to /api/integrations/square/callback?code=...&state=...
 *   - We exchange the code for { access_token, refresh_token, expires_at,
 *     merchant_id }, encrypt both tokens, and upsert integration_connections
 *     with provider='square'.
 *
 * Unlike Stripe's "platform key + stripeAccount header" model, every Square
 * API call uses the merchant's access token directly. Tokens expire, so we
 * check + refresh lazily on every API call. Refresh tokens are long-lived
 * but can be rotated — we persist the rotated value if Square sends one.
 *
 * Payment flow: Square's Online Checkout "Payment Link" API — a hosted
 * checkout URL the end-client visits to pay. Cheaper + simpler than
 * custom-integrating Payments API. Each link is tied to one invoice via
 * the `reference_id` field we set at creation time; the webhook uses
 * that reference to attribute payments back.
 *
 * Security posture:
 *   - OAuth uses a single-use CSRF token (square_oauth_states table),
 *     10-min TTL.
 *   - Callback re-verifies the current user matches the state's recorded
 *     membership before writing.
 *   - Access + refresh tokens encrypted at rest via lib/crypto.ts.
 *   - Webhook signature verified with SQUARE_WEBHOOK_SIGNATURE_KEY.
 */

import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

// -----------------------------------------------------------------------------
// Environment + API host resolution
// -----------------------------------------------------------------------------

function getSquareEnv(): "production" | "sandbox" {
  const raw = process.env.SQUARE_ENVIRONMENT?.toLowerCase();
  return raw === "production" ? "production" : "sandbox";
}

/** Base URL for Square's REST API (connect.squareup.com for prod). */
export function squareApiBase(): string {
  return getSquareEnv() === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

/** Square-Version header value — pin to a known-good version. */
const SQUARE_API_VERSION = "2024-10-17";

// -----------------------------------------------------------------------------
// CSRF state token
// -----------------------------------------------------------------------------

/**
 * Generate a one-time CSRF state and persist it with a 10-minute TTL.
 */
export async function issueOAuthState(args: {
  organizationId: string;
  membershipId: string;
}): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  const admin = createSupabaseAdminClient();
  await admin.from("square_oauth_states" as never).insert({
    state,
    organization_id: args.organizationId,
    membership_id: args.membershipId,
  } as never);
  return state;
}

/**
 * Consume a state token and return the associated (organization, membership).
 * Deletes the row so it can't be replayed. Throws on unknown/expired state.
 */
export async function consumeOAuthState(
  state: string,
): Promise<{ organizationId: string; membershipId: string }> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("square_oauth_states" as never)
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

  await admin
    .from("square_oauth_states" as never)
    .delete()
    .eq("state", state);

  return {
    organizationId: row.organization_id,
    membershipId: row.membership_id,
  };
}

// -----------------------------------------------------------------------------
// OAuth URL
// -----------------------------------------------------------------------------

/**
 * Scopes we request. Kept minimal — just what we need to create payment
 * links and read merchant/location metadata.
 *
 *   MERCHANT_PROFILE_READ  → GET /v2/merchants/me
 *   PAYMENTS_READ          → read payments via webhook enrichment
 *   PAYMENTS_WRITE         → (not strictly needed for hosted Checkout, but
 *                            some endpoints require it)
 *   ORDERS_WRITE           → create the Order that backs a payment link
 *   ORDERS_READ            → look up order details from webhook
 */
const SCOPES = [
  "MERCHANT_PROFILE_READ",
  "PAYMENTS_READ",
  "PAYMENTS_WRITE",
  "ORDERS_READ",
  "ORDERS_WRITE",
].join("+");

/**
 * Build the authorize URL. Returns null when Square isn't configured so
 * callers can render a friendly message instead of a broken link.
 */
export function buildOAuthUrl(args: {
  state: string;
  redirectUri: string;
}): string | null {
  const appId = process.env.SQUARE_APPLICATION_ID;
  if (!appId) return null;
  const base =
    getSquareEnv() === "production"
      ? "https://connect.squareup.com/oauth2/authorize"
      : "https://connect.squareupsandbox.com/oauth2/authorize";
  // Square is strict — `scope` must be space- or plus-separated in the URL.
  const params = new URLSearchParams({
    client_id: appId,
    response_type: "code",
    session: "false",
    redirect_uri: args.redirectUri,
    state: args.state,
  });
  // `scope` goes in unencoded because Square accepts it as a single plus-
  // separated string. URLSearchParams would encode the +'s to %2B.
  return `${base}?${params.toString()}&scope=${SCOPES}`;
}

// -----------------------------------------------------------------------------
// OAuth token exchange + refresh
// -----------------------------------------------------------------------------

type SquareTokenResponse = {
  access_token: string;
  token_type: string;
  expires_at: string; // ISO8601
  merchant_id: string;
  refresh_token: string;
  short_lived: boolean;
  error?: string;
  error_description?: string;
};

/**
 * Exchange an authorization code for tokens. Returns the full set.
 */
export async function exchangeCodeForTokens(
  code: string,
): Promise<SquareTokenResponse> {
  const appId = process.env.SQUARE_APPLICATION_ID;
  const appSecret = process.env.SQUARE_APPLICATION_SECRET;
  if (!appId || !appSecret) {
    throw new Error("Square is not configured");
  }

  const res = await fetch(`${squareApiBase()}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Square-Version": SQUARE_API_VERSION,
    },
    body: JSON.stringify({
      client_id: appId,
      client_secret: appSecret,
      code,
      grant_type: "authorization_code",
    }),
  });

  const json = (await res.json()) as SquareTokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Square token exchange failed: ${json.error_description ?? json.error ?? "unknown"}`,
    );
  }
  return json;
}

/**
 * Swap a refresh token for a fresh access token. Square may rotate the
 * refresh token too — always persist whichever it returns.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<SquareTokenResponse> {
  const appId = process.env.SQUARE_APPLICATION_ID;
  const appSecret = process.env.SQUARE_APPLICATION_SECRET;
  if (!appId || !appSecret) {
    throw new Error("Square is not configured");
  }

  const res = await fetch(`${squareApiBase()}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Square-Version": SQUARE_API_VERSION,
    },
    body: JSON.stringify({
      client_id: appId,
      client_secret: appSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const json = (await res.json()) as SquareTokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Square token refresh failed: ${json.error_description ?? json.error ?? "unknown"}`,
    );
  }
  return json;
}

/**
 * Revoke a merchant's access token — called on disconnect so Square drops
 * its server-side reference to us.
 */
export async function revokeAccessToken(args: {
  accessToken: string;
  merchantId: string;
}): Promise<void> {
  const appId = process.env.SQUARE_APPLICATION_ID;
  const appSecret = process.env.SQUARE_APPLICATION_SECRET;
  if (!appId || !appSecret) return;

  try {
    await fetch(`${squareApiBase()}/oauth2/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Square-Version": SQUARE_API_VERSION,
        Authorization: `Client ${appSecret}`,
      },
      body: JSON.stringify({
        client_id: appId,
        access_token: args.accessToken,
        merchant_id: args.merchantId,
      }),
    });
  } catch {
    // Swallow — merchant may have revoked from their Square dashboard.
  }
}

// -----------------------------------------------------------------------------
// Persistence — integration_connections row
// -----------------------------------------------------------------------------

/**
 * Upsert the integration_connections row for a Square connection. Encrypts
 * both tokens before they ever hit the DB.
 */
export async function saveConnection(args: {
  organizationId: string;
  membershipId: string;
  merchantId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  locationId: string | null;
}): Promise<void> {
  const admin = createSupabaseAdminClient();

  // Upsert by (organization_id, provider). Any prior disconnected row gets
  // overwritten with active status.
  await admin
    .from("integration_connections" as never)
    .upsert(
      {
        organization_id: args.organizationId,
        provider: "square",
        external_account_id: args.merchantId,
        external_account_label: null,
        access_token_ciphertext: encryptSecret(args.accessToken),
        refresh_token_ciphertext: encryptSecret(args.refreshToken),
        token_expires_at: args.expiresAt,
        scope: SCOPES.replace(/\+/g, " "),
        status: "active",
        last_error: null,
        metadata: args.locationId
          ? { location_id: args.locationId }
          : {},
        connected_by: args.membershipId,
        connected_at: new Date().toISOString(),
      } as never,
      { onConflict: "organization_id,provider" } as never,
    );
}

/**
 * Load the active Square connection for an org. Returns decrypted tokens
 * (use with care — never ship to the client).
 */
export async function loadConnection(
  organizationId: string,
): Promise<{
  merchantId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  locationId: string | null;
} | null> {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("integration_connections" as never)
    .select(
      "external_account_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, metadata",
    )
    .eq("organization_id" as never, organizationId as never)
    .eq("provider" as never, "square" as never)
    .eq("status" as never, "active" as never)
    .maybeSingle()) as unknown as {
    data: {
      external_account_id: string | null;
      access_token_ciphertext: string | null;
      refresh_token_ciphertext: string | null;
      token_expires_at: string | null;
      metadata: Record<string, unknown> | null;
    } | null;
  };

  if (!data || !data.external_account_id) return null;

  const accessToken = decryptSecret(data.access_token_ciphertext);
  const refreshToken = decryptSecret(data.refresh_token_ciphertext);
  if (!accessToken || !refreshToken) return null;

  const locationRaw = (data.metadata as { location_id?: string } | null)
    ?.location_id;

  return {
    merchantId: data.external_account_id,
    accessToken,
    refreshToken,
    expiresAt: data.token_expires_at ?? "",
    locationId: locationRaw ?? null,
  };
}

/**
 * Get a fresh access token for an org, refreshing if close to expiry.
 * 5-minute buffer — safer than waiting until the last second.
 */
export async function getValidAccessToken(
  organizationId: string,
): Promise<string | null> {
  const conn = await loadConnection(organizationId);
  if (!conn) return null;

  const expiresMs = conn.expiresAt ? new Date(conn.expiresAt).getTime() : 0;
  const fiveMinFromNow = Date.now() + 5 * 60 * 1000;

  if (expiresMs > fiveMinFromNow) return conn.accessToken;

  // Need to refresh.
  const fresh = await refreshAccessToken(conn.refreshToken);
  await saveConnection({
    organizationId,
    membershipId: "", // kept NULL-ish via the schema; we don't know who triggered the refresh
    merchantId: fresh.merchant_id,
    accessToken: fresh.access_token,
    refreshToken: fresh.refresh_token,
    expiresAt: fresh.expires_at,
    locationId: conn.locationId,
  });
  return fresh.access_token;
}

/**
 * Mark the Square connection disconnected (kept in history, status='disconnected').
 * Best-effort revoke on Square's side.
 */
export async function disconnect(organizationId: string): Promise<void> {
  const conn = await loadConnection(organizationId);
  if (conn) {
    await revokeAccessToken({
      accessToken: conn.accessToken,
      merchantId: conn.merchantId,
    });
  }

  const admin = createSupabaseAdminClient();
  await admin
    .from("integration_connections" as never)
    .update({
      status: "disconnected",
      access_token_ciphertext: null,
      refresh_token_ciphertext: null,
      token_expires_at: null,
    } as never)
    .eq("organization_id" as never, organizationId as never)
    .eq("provider" as never, "square" as never);
}

// -----------------------------------------------------------------------------
// Square REST helpers
// -----------------------------------------------------------------------------

/**
 * GET /v2/merchants/me → the merchant metadata for a just-connected account.
 * We use this to learn the business name for the UI and the primary location.
 */
export async function fetchMerchant(
  accessToken: string,
): Promise<{ id: string; business_name: string | null } | null> {
  const res = await fetch(`${squareApiBase()}/v2/merchants/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": SQUARE_API_VERSION,
    },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    merchant?: { id?: string; business_name?: string };
  };
  if (!json.merchant?.id) return null;
  return {
    id: json.merchant.id,
    business_name: json.merchant.business_name ?? null,
  };
}

/**
 * GET /v2/locations → pick the "main" location (used as the Payment Link
 * location_id). Most small businesses have one; we take the first MAIN or
 * ACTIVE one we find.
 */
export async function fetchPrimaryLocation(
  accessToken: string,
): Promise<string | null> {
  const res = await fetch(`${squareApiBase()}/v2/locations`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": SQUARE_API_VERSION,
    },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    locations?: Array<{
      id?: string;
      status?: string;
      type?: string;
    }>;
  };
  const locations = json.locations ?? [];
  const main =
    locations.find(
      (l) => l.status === "ACTIVE" && l.type === "PHYSICAL",
    ) ??
    locations.find((l) => l.status === "ACTIVE") ??
    locations[0];
  return main?.id ?? null;
}

// -----------------------------------------------------------------------------
// Payment Link (hosted checkout)
// -----------------------------------------------------------------------------

/**
 * Create a Square hosted checkout URL for a specific invoice. Returns the
 * `url` the customer should visit and the `id` of the link (stored on the
 * invoice so repeat clicks reuse the same link until paid).
 */
export async function createInvoiceCheckoutLink(args: {
  organizationId: string;
  invoiceId: string;
  amountCents: number;
  currency?: string; // default USD
  orgName: string;
  invoiceNumber: string;
  buyerEmail?: string | null;
  successUrl: string;
}): Promise<{ url: string; id: string } | null> {
  const accessToken = await getValidAccessToken(args.organizationId);
  if (!accessToken) return null;

  const conn = await loadConnection(args.organizationId);
  if (!conn?.locationId) return null;

  const currency = (args.currency ?? "USD").toUpperCase();

  const body = {
    // Scoped to (org, invoice) so repeated calls produce the same link.
    idempotency_key: `sollos-invoice-${args.invoiceId}`,
    quick_pay: {
      name: `Invoice ${args.invoiceNumber} — ${args.orgName}`,
      price_money: {
        amount: args.amountCents,
        currency,
      },
      location_id: conn.locationId,
    },
    // These come back on the webhook so we can attribute the payment.
    pre_populated_data: args.buyerEmail
      ? { buyer_email: args.buyerEmail }
      : undefined,
    checkout_options: {
      redirect_url: args.successUrl,
      ask_for_shipping_address: false,
      allow_tipping: false,
    },
    payment_note: `Sollos invoice ${args.invoiceId}`,
  };

  const res = await fetch(`${squareApiBase()}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": SQUARE_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as {
    payment_link?: { id?: string; url?: string; order_id?: string };
    errors?: Array<{ detail?: string }>;
  };

  if (!res.ok || !json.payment_link?.url || !json.payment_link?.id) {
    const msg =
      json.errors?.map((e) => e.detail).join(", ") ??
      `Square payment link creation failed (${res.status})`;
    throw new Error(msg);
  }

  // Stash the link id + order id on the invoice so the webhook can find us.
  const admin = createSupabaseAdminClient();
  await admin
    .from("invoices" as never)
    .update({
      square_payment_link_id: json.payment_link.id,
      square_payment_link_url: json.payment_link.url,
      square_order_id: json.payment_link.order_id ?? null,
    } as never)
    .eq("id" as never, args.invoiceId as never);

  return { url: json.payment_link.url, id: json.payment_link.id };
}

// -----------------------------------------------------------------------------
// Webhook signature verification
// -----------------------------------------------------------------------------

/**
 * Square signs webhook bodies with an HMAC-SHA256 over the notification
 * URL + raw body, using the signature key from the Square dashboard.
 *
 * https://developer.squareup.com/docs/webhooks/step3validate
 */
export function verifyWebhookSignature(args: {
  notificationUrl: string;
  rawBody: string;
  signature: string;
}): boolean {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key) return false;

  const expected = createHmac("sha256", key)
    .update(args.notificationUrl + args.rawBody)
    .digest("base64");

  // timingSafeEqual requires equal-length buffers.
  const a = Buffer.from(expected);
  const b = Buffer.from(args.signature);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

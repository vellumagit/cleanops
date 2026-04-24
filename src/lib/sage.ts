/**
 * Sage Business Cloud Accounting integration service.
 *
 * Handles OAuth2 token exchange + refresh, and syncs invoices + clients
 * from Sollos into Sage so the owner's bookkeeping matches reality
 * without manual re-entry.
 *
 * Sage quirks:
 *   - Access tokens expire after ~5 minutes (300s)
 *   - Refresh tokens expire after 31 days
 *   - Refresh tokens rotate on every use — the new refresh token must
 *     be stored immediately, or the connection is permanently broken
 *   - The API base is v3.1. `/contacts` for customers/vendors,
 *     `/sales_invoices` for invoices. Amounts are major units (dollars,
 *     not cents).
 */

import "server-only";
import { getEnv } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const SAGE_API_BASE = "https://api.accounting.sage.com/v3.1";

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

const SAGE_AUTH_URL = "https://www.sageone.com/oauth2/auth/central";
const SAGE_TOKEN_URL = "https://oauth.accounting.sage.com/token";

/**
 * Build the Sage OAuth consent URL.
 */
export function buildSageOAuthUrl(state: string): string {
  const env = getEnv();
  const params = new URLSearchParams({
    client_id: env.SAGE_CLIENT_ID!,
    redirect_uri: `${env.NEXT_PUBLIC_SITE_URL}/api/integrations/sage/callback`,
    response_type: "code",
    scope: "full_access",
    state,
  });
  return `${SAGE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeSageCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  resource_owner_id?: string;
}> {
  const env = getEnv();
  const res = await fetch(SAGE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.SAGE_CLIENT_ID!,
      client_secret: env.SAGE_CLIENT_SECRET!,
      redirect_uri: `${env.NEXT_PUBLIC_SITE_URL}/api/integrations/sage/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sage token exchange failed: ${res.status} ${body}`);
  }

  return res.json();
}

/**
 * Refresh an expired access token.
 *
 * IMPORTANT: Sage rotates refresh tokens on every use — the old refresh
 * token is invalidated as soon as a new one is issued. We must persist
 * the new refresh token immediately.
 */
export async function refreshSageAccessToken(
  connectionId: string,
  refreshTokenCiphertext: string,
): Promise<string> {
  const env = getEnv();
  const refreshToken = decryptSecret(refreshTokenCiphertext);
  if (!refreshToken) throw new Error("No refresh token available");

  const res = await fetch(SAGE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.SAGE_CLIENT_ID!,
      client_secret: env.SAGE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const admin = createSupabaseAdminClient();

  if (!res.ok) {
    const body = await res.text();
    await admin
      .from("integration_connections" as never)
      .update({
        status: "error",
        last_error: `Token refresh failed: ${res.status}`,
      } as never)
      .eq("id" as never, connectionId);
    throw new Error(`Sage token refresh failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  const newAccessToken: string = data.access_token;
  const newRefreshToken: string = data.refresh_token;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  // Persist BOTH the new access token AND the rotated refresh token
  await admin
    .from("integration_connections" as never)
    .update({
      access_token_ciphertext: encryptSecret(newAccessToken),
      refresh_token_ciphertext: encryptSecret(newRefreshToken),
      token_expires_at: expiresAt,
      status: "active",
      last_error: null,
    } as never)
    .eq("id" as never, connectionId);

  return newAccessToken;
}

// ---------------------------------------------------------------------------
// Authenticated API client
// ---------------------------------------------------------------------------

type SageConnection = {
  id: string;
  organization_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  token_expires_at: string;
  status: string;
};

/**
 * Fetch the active Sage connection for an org. Returns null when the
 * org hasn't connected Sage or the connection is in an error state.
 *
 * Callers that will actually hit the API should use getUsableSageAccessToken()
 * instead — this is for "is Sage connected?" checks.
 */
export async function getSageConnection(
  organizationId: string,
): Promise<SageConnection | null> {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("integration_connections" as never)
    .select(
      "id, organization_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, status",
    )
    .eq("organization_id" as never, organizationId as never)
    .eq("provider" as never, "sage" as never)
    .eq("status" as never, "active" as never)
    .maybeSingle()) as unknown as { data: SageConnection | null };
  return data ?? null;
}

/**
 * Resolve a usable Sage access token for an org — refreshes
 * automatically if the stored one is expired or close to it.
 *
 * Buffers by 30s so we don't try to use a token that'll die mid-request.
 * Returns null when there's no active connection (caller should treat
 * as "Sage not connected").
 */
async function getUsableSageAccessToken(
  organizationId: string,
): Promise<string | null> {
  const conn = await getSageConnection(organizationId);
  if (!conn) return null;

  const now = Date.now();
  const expiresAt = new Date(conn.token_expires_at).getTime();
  // 30s buffer — don't hand out a token we're about to eat.
  if (now < expiresAt - 30_000) {
    const access = decryptSecret(conn.access_token_ciphertext);
    if (access) return access;
  }

  // Expired or close — refresh. refreshSageAccessToken persists the
  // rotated pair back to the row and returns the new access token.
  try {
    return await refreshSageAccessToken(
      conn.id,
      conn.refresh_token_ciphertext,
    );
  } catch (err) {
    console.error("[sage] refresh on use failed:", err);
    return null;
  }
}

/**
 * Authenticated fetch wrapper. Retries once after a 401 on the theory
 * that our token clock drifted — the retry uses a fresh token from
 * refreshSageAccessToken.
 *
 * Throws on non-2xx responses with the Sage response body text as
 * the error message so callers can surface / log the real problem.
 */
async function sageFetch<T>(
  organizationId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let access = await getUsableSageAccessToken(organizationId);
  if (!access) {
    throw new Error("Sage is not connected for this organization.");
  }

  const doFetch = async (token: string) => {
    return fetch(`${SAGE_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
  };

  let res = await doFetch(access);

  if (res.status === 401) {
    // Likely a clock-skew 401 — force a refresh and retry once.
    const conn = await getSageConnection(organizationId);
    if (conn) {
      try {
        access = await refreshSageAccessToken(
          conn.id,
          conn.refresh_token_ciphertext,
        );
        res = await doFetch(access);
      } catch {
        // fall through — we'll throw below with the original 401 body
      }
    }
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Sage API ${init.method ?? "GET"} ${path} → ${res.status}: ${body}`,
    );
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Contact (client) sync
// ---------------------------------------------------------------------------

type SageContact = {
  id: string;
  displayed_as: string;
};

/**
 * Push a Sollos client into Sage as a customer contact. Idempotent via
 * clients.sage_contact_id — if already synced, this is a no-op and
 * returns the existing id. Returns null when Sage isn't connected
 * (caller can decide whether that's an error).
 *
 * Sync rules:
 *   - Sollos name → Sage contact name
 *   - Sollos email → main_address.email (Sage's main contact-method spot)
 *   - Sollos phone → main_address.telephone
 *   - Sollos address → main_address.address_line_1
 *   - contact_type_ids: Sage requires at least one type; we pass
 *     "CUSTOMER" (Sage's built-in type id).
 */
export async function pushClientToSage(
  clientId: string,
): Promise<string | null> {
  const admin = createSupabaseAdminClient();

  const { data: client } = (await admin
    .from("clients")
    .select(
      "id, organization_id, name, email, phone, address, sage_contact_id",
    )
    .eq("id", clientId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      name: string;
      email: string | null;
      phone: string | null;
      address: string | null;
      sage_contact_id: string | null;
    } | null;
  };

  if (!client) {
    console.log(`[sage] pushClientToSage: client ${clientId} not found`);
    return null;
  }
  if (client.sage_contact_id) {
    return client.sage_contact_id;
  }

  const conn = await getSageConnection(client.organization_id);
  if (!conn) {
    console.log(
      `[sage] pushClientToSage: org ${client.organization_id} has no active Sage connection`,
    );
    return null;
  }

  try {
    const result = await sageFetch<SageContact>(
      client.organization_id,
      "/contacts",
      {
        method: "POST",
        body: JSON.stringify({
          contact: {
            name: client.name,
            contact_type_ids: ["CUSTOMER"],
            main_address: {
              email: client.email ?? undefined,
              telephone: client.phone ?? undefined,
              address_line_1: client.address ?? undefined,
            },
          },
        }),
      },
    );

    await admin
      .from("clients")
      .update({ sage_contact_id: result.id } as never)
      .eq("id", clientId);

    console.log(
      `[sage] pushClientToSage: client ${clientId} → contact ${result.id}`,
    );
    return result.id;
  } catch (err) {
    console.error("[sage] pushClientToSage failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Invoice sync
// ---------------------------------------------------------------------------

type SageSalesInvoice = {
  id: string;
  displayed_as: string;
};

/**
 * Push a Sollos invoice into Sage as a Sales Invoice. Ensures the
 * client is synced first (calls pushClientToSage if the client has
 * no sage_contact_id yet).
 *
 * Idempotent via invoices.sage_invoice_id. Updates existing Sage
 * invoices are NOT attempted — Sage locks invoices once posted, and
 * re-sending the same Sollos invoice returns the existing id so we
 * don't create a duplicate in the books.
 *
 * Returns the Sage invoice id on success, null on failure (with an
 * error logged to console).
 */
export async function pushInvoiceToSage(
  invoiceId: string,
): Promise<string | null> {
  const admin = createSupabaseAdminClient();

  // Fetch invoice + line items in one shot.
  const { data: invoice } = (await admin
    .from("invoices")
    .select(
      `
        id, organization_id, client_id, number, status,
        amount_cents, due_date, created_at,
        tax_rate_bps, tax_amount_cents,
        sage_invoice_id,
        line_items:invoice_line_items (
          id, label, quantity, unit_price_cents, sort_order
        )
      `,
    )
    .eq("id", invoiceId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      client_id: string;
      number: string | null;
      status: string;
      amount_cents: number;
      due_date: string | null;
      created_at: string;
      tax_rate_bps: number | null;
      tax_amount_cents: number | null;
      sage_invoice_id: string | null;
      line_items: Array<{
        id: string;
        label: string;
        quantity: number;
        unit_price_cents: number;
        sort_order: number;
      }> | null;
    } | null;
  };

  if (!invoice) {
    console.log(`[sage] pushInvoiceToSage: invoice ${invoiceId} not found`);
    return null;
  }
  if (invoice.sage_invoice_id) {
    return invoice.sage_invoice_id;
  }

  const conn = await getSageConnection(invoice.organization_id);
  if (!conn) {
    console.log(
      `[sage] pushInvoiceToSage: org ${invoice.organization_id} has no active Sage connection`,
    );
    return null;
  }

  // Ensure the client exists in Sage first.
  const sageContactId = await pushClientToSage(invoice.client_id);
  if (!sageContactId) {
    console.error(
      "[sage] pushInvoiceToSage: could not sync client, aborting invoice",
    );
    return null;
  }

  // Build line items. If there are none (rare — auto-invoice always
  // seeds one), fall back to a single "Services" line for the full
  // pre-tax amount so the totals still reconcile.
  const preTaxCents =
    invoice.amount_cents - (invoice.tax_amount_cents ?? 0);
  const rawLines = (invoice.line_items ?? []).slice().sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  const sageLines =
    rawLines.length > 0
      ? rawLines.map((li) => ({
          description: li.label,
          quantity: Number(li.quantity) || 1,
          unit_price: li.unit_price_cents / 100,
        }))
      : [
          {
            description: "Services",
            quantity: 1,
            unit_price: preTaxCents / 100,
          },
        ];

  const invoiceDate = new Date(invoice.created_at)
    .toISOString()
    .slice(0, 10);
  const dueDate =
    invoice.due_date ??
    new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);

  try {
    const result = await sageFetch<SageSalesInvoice>(
      invoice.organization_id,
      "/sales_invoices",
      {
        method: "POST",
        body: JSON.stringify({
          sales_invoice: {
            contact_id: sageContactId,
            date: invoiceDate,
            due_date: dueDate,
            reference: invoice.number ?? undefined,
            // Line totals without Sage-side tax ledgers — we've already
            // calculated tax in Sollos. Sage accepts invoice_lines with
            // pre-tax unit_price; Sage tax setup would add on top but
            // we omit the tax_rate_id so Sage treats these as tax-free
            // on its end (tax is reflected in the Sollos total).
            invoice_lines: sageLines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unit_price: l.unit_price,
              ledger_account_id: undefined, // owner's Sage default
            })),
          },
        }),
      },
    );

    await admin
      .from("invoices")
      .update({ sage_invoice_id: result.id } as never)
      .eq("id", invoiceId);

    console.log(
      `[sage] pushInvoiceToSage: invoice ${invoiceId} (${invoice.number}) → sage ${result.id}`,
    );
    return result.id;
  } catch (err) {
    console.error("[sage] pushInvoiceToSage failed:", err);
    return null;
  }
}

/**
 * QuickBooks Online (Intuit) integration service.
 *
 * Mirrors the Sage integration: OAuth2 token exchange + refresh, and pushes
 * clients + invoices from Sollos into QuickBooks so the owner's books match
 * without manual re-entry.
 *
 * QBO quirks:
 *   - Access tokens expire after 1 hour; refresh tokens last 100 days and
 *     ROTATE on every use — the new refresh token must be stored immediately.
 *   - Every API call is scoped to the company: /v3/company/{realmId}/...
 *     The realmId comes back on the OAuth callback and is stored as the
 *     connection's external_account_id.
 *   - Invoice lines require an ItemRef (a QBO product/service). We resolve the
 *     org's default service item once and cache it on the connection metadata.
 *   - Tax: line TaxCodeRef, resolved from the Sollos rate → a QBO tax code.
 *     Omitted when we can't map it (QBO then applies the company default).
 *   - Amounts are major units (dollars), not cents.
 */

import "server-only";
import { randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";
const MINOR_VERSION = "70";

function qbEnv(): "sandbox" | "production" {
  return getEnv().QUICKBOOKS_ENVIRONMENT === "production"
    ? "production"
    : "sandbox";
}

/** REST API base — sandbox vs production. */
function qbApiBase(): string {
  return qbEnv() === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

function redirectUri(): string {
  return `${getEnv().NEXT_PUBLIC_SITE_URL}/api/integrations/quickbooks/callback`;
}

function basicAuthHeader(): string {
  const env = getEnv();
  const raw = `${env.QUICKBOOKS_CLIENT_ID}:${env.QUICKBOOKS_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function buildQuickBooksOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getEnv().QUICKBOOKS_CLIENT_ID!,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri(),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Single-use CSRF state, tied to (org, membership), 10-min TTL. */
export async function issueQBOAuthState(args: {
  organizationId: string;
  membershipId: string;
}): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  const admin = createSupabaseAdminClient();
  await admin.from("quickbooks_oauth_states" as never).insert({
    state,
    organization_id: args.organizationId,
    membership_id: args.membershipId,
  } as never);
  return state;
}

/** Consume a state token → (org, membership); deletes it. Throws if invalid. */
export async function consumeQBOAuthState(
  state: string,
): Promise<{ organizationId: string; membershipId: string }> {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("quickbooks_oauth_states" as never)
    .select("organization_id, membership_id, expires_at")
    .eq("state" as never, state as never)
    .maybeSingle()) as unknown as {
    data: {
      organization_id: string;
      membership_id: string;
      expires_at: string;
    } | null;
  };
  if (!data) throw new Error("Unknown OAuth state");
  if (new Date(data.expires_at) < new Date()) {
    throw new Error("OAuth state expired");
  }
  await admin
    .from("quickbooks_oauth_states" as never)
    .delete()
    .eq("state" as never, state as never);
  return {
    organizationId: data.organization_id,
    membershipId: data.membership_id,
  };
}

type QBTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
  token_type: string;
};

export async function exchangeQBCodeForTokens(
  code: string,
): Promise<QBTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) {
    throw new Error(
      `QuickBooks token exchange failed: ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

/**
 * Refresh an expired access token. QBO rotates the refresh token on every use —
 * the new one is persisted immediately or the connection breaks permanently.
 */
async function refreshQBAccessToken(
  connectionId: string,
  refreshTokenCiphertext: string,
): Promise<string> {
  const refreshToken = decryptSecret(refreshTokenCiphertext);
  if (!refreshToken) throw new Error("No refresh token available");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const admin = createSupabaseAdminClient();
  if (!res.ok) {
    await admin
      .from("integration_connections" as never)
      .update({
        status: "error",
        last_error: `QBO token refresh failed: ${res.status}`,
      } as never)
      .eq("id" as never, connectionId);
    throw new Error(`QuickBooks token refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as QBTokenResponse;
  await admin
    .from("integration_connections" as never)
    .update({
      access_token_ciphertext: encryptSecret(data.access_token),
      refresh_token_ciphertext: encryptSecret(data.refresh_token),
      token_expires_at: new Date(
        Date.now() + data.expires_in * 1000,
      ).toISOString(),
      status: "active",
      last_error: null,
    } as never)
    .eq("id" as never, connectionId);

  return data.access_token;
}

// ---------------------------------------------------------------------------
// Connection + authenticated client
// ---------------------------------------------------------------------------

type QBConnection = {
  id: string;
  organization_id: string;
  external_account_id: string | null; // realmId (QBO company id)
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  token_expires_at: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

export async function getQBConnection(
  organizationId: string,
): Promise<QBConnection | null> {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("integration_connections" as never)
    .select(
      "id, organization_id, external_account_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, status, metadata",
    )
    .eq("organization_id" as never, organizationId as never)
    .eq("provider" as never, "quickbooks" as never)
    .eq("status" as never, "active" as never)
    .maybeSingle()) as unknown as { data: QBConnection | null };
  return data ?? null;
}

async function mergeConnectionMetadata(
  connectionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("integration_connections" as never)
    .select("metadata")
    .eq("id" as never, connectionId as never)
    .maybeSingle()) as unknown as {
    data: { metadata: Record<string, unknown> | null } | null;
  };
  await admin
    .from("integration_connections" as never)
    .update({ metadata: { ...(data?.metadata ?? {}), ...patch } } as never)
    .eq("id" as never, connectionId as never);
}

/** Resolve a usable access token for a connection, refreshing if near expiry. */
async function usableToken(conn: QBConnection): Promise<string | null> {
  const expiresAt = new Date(conn.token_expires_at).getTime();
  if (Date.now() < expiresAt - 60_000) {
    const t = decryptSecret(conn.access_token_ciphertext);
    if (t) return t;
  }
  try {
    return await refreshQBAccessToken(conn.id, conn.refresh_token_ciphertext);
  } catch (err) {
    console.error("[qbo] refresh on use failed:", err);
    return null;
  }
}

/**
 * Authenticated fetch against the company API. `path` is relative to
 * /v3/company/{realmId}. Retries once on 401 with a forced refresh. Throws on
 * non-2xx with the QBO body so callers can log the real fault.
 */
async function qbFetch<T>(
  conn: QBConnection,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!conn.external_account_id) {
    throw new Error("QuickBooks connection is missing its company id (realmId).");
  }
  let token = await usableToken(conn);
  if (!token) throw new Error("QuickBooks is not connected for this organization.");

  const sep = path.includes("?") ? "&" : "?";
  const url = `${qbApiBase()}/v3/company/${conn.external_account_id}${path}${sep}minorversion=${MINOR_VERSION}`;

  const doFetch = (t: string) =>
    fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

  let res = await doFetch(token);
  if (res.status === 401) {
    try {
      token = await refreshQBAccessToken(conn.id, conn.refresh_token_ciphertext);
      res = await doFetch(token);
    } catch {
      /* fall through to throw below */
    }
  }
  if (!res.ok) {
    throw new Error(
      `QBO ${init.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

/** Run a QBO SQL-ish query and return the QueryResponse object. */
async function qbQuery<T>(
  conn: QBConnection,
  query: string,
): Promise<T> {
  const resp = await qbFetch<{ QueryResponse?: T }>(
    conn,
    `/query?query=${encodeURIComponent(query)}`,
  );
  return (resp.QueryResponse ?? {}) as T;
}

const escapeQuoted = (s: string) => s.replace(/'/g, "''");

// ---------------------------------------------------------------------------
// Default item + tax code resolution (cached on the connection)
// ---------------------------------------------------------------------------

/** A QBO service Item to hang invoice lines on. Required by the invoice API. */
async function getDefaultItemRef(conn: QBConnection): Promise<string | null> {
  const cached = (conn.metadata ?? {})["item_ref_id"];
  if (typeof cached === "string" && cached) return cached;

  const bySvc = await qbQuery<{ Item?: Array<{ Id: string }> }>(
    conn,
    "SELECT Id FROM Item WHERE Type = 'Service' AND Active = true MAXRESULTS 1",
  );
  let id = bySvc.Item?.[0]?.Id;
  if (!id) {
    const any = await qbQuery<{ Item?: Array<{ Id: string }> }>(
      conn,
      "SELECT Id FROM Item WHERE Active = true MAXRESULTS 1",
    );
    id = any.Item?.[0]?.Id;
  }
  if (id) {
    await mergeConnectionMetadata(conn.id, { item_ref_id: id });
    return id;
  }
  return null;
}

type QBTaxCode = {
  Id: string;
  SalesTaxRateList?: {
    TaxRateDetail?: Array<{ TaxRateRef?: { value?: string } }>;
  };
};

/**
 * Resolve a QBO sales TaxCode id whose effective rate matches the Sollos rate
 * (bps). Returns null for zero tax or when no confident match exists (the
 * invoice then syncs without an explicit tax code — QBO applies its default).
 * Cached per-rate on the connection metadata.
 */
async function getTaxCodeRefForBps(
  conn: QBConnection,
  bps: number | null | undefined,
): Promise<string | null> {
  if (!bps || bps <= 0) return null;
  const pct = bps / 100;
  const cacheKey = `tax_code_id_${bps}`;
  const cached = (conn.metadata ?? {})[cacheKey];
  if (typeof cached === "string" && cached) return cached;

  // Find a tax RATE whose value matches, then a sales tax CODE that uses it.
  const rates = await qbQuery<{
    TaxRate?: Array<{ Id: string; RateValue?: number }>;
  }>(conn, "SELECT Id, RateValue FROM TaxRate");
  const rate = (rates.TaxRate ?? []).find(
    (r) => typeof r.RateValue === "number" && Math.abs(r.RateValue - pct) < 0.001,
  );
  if (!rate) return null;

  const codes = await qbQuery<{ TaxCode?: QBTaxCode[] }>(
    conn,
    "SELECT * FROM TaxCode",
  );
  const code = (codes.TaxCode ?? []).find((c) =>
    (c.SalesTaxRateList?.TaxRateDetail ?? []).some(
      (d) => d.TaxRateRef?.value === rate.Id,
    ),
  );
  if (code?.Id) {
    await mergeConnectionMetadata(conn.id, { [cacheKey]: code.Id });
    return code.Id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Customer sync
// ---------------------------------------------------------------------------

/**
 * Push a Sollos client into QBO as a Customer. Idempotent via
 * clients.quickbooks_customer_id; if not yet linked, looks up an existing
 * customer by display name (QBO requires unique names) before creating.
 */
export async function pushClientToQuickBooks(
  clientId: string,
): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data: client } = (await admin
    .from("clients")
    .select(
      "id, organization_id, name, email, phone, address, quickbooks_customer_id",
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
      quickbooks_customer_id: string | null;
    } | null;
  };
  if (!client) return null;
  if (client.quickbooks_customer_id) return client.quickbooks_customer_id;

  const conn = await getQBConnection(client.organization_id);
  if (!conn) return null;

  try {
    // QBO rejects duplicate DisplayName — reuse an existing customer if present.
    const existing = await qbQuery<{ Customer?: Array<{ Id: string }> }>(
      conn,
      `SELECT Id FROM Customer WHERE DisplayName = '${escapeQuoted(client.name)}'`,
    );
    let customerId = existing.Customer?.[0]?.Id ?? null;

    if (!customerId) {
      const created = await qbFetch<{ Customer: { Id: string } }>(
        conn,
        "/customer",
        {
          method: "POST",
          body: JSON.stringify({
            DisplayName: client.name,
            ...(client.email
              ? { PrimaryEmailAddr: { Address: client.email } }
              : {}),
            ...(client.phone
              ? { PrimaryPhone: { FreeFormNumber: client.phone } }
              : {}),
            ...(client.address
              ? { BillAddr: { Line1: client.address } }
              : {}),
          }),
        },
      );
      customerId = created.Customer.Id;
    }

    await admin
      .from("clients")
      .update({ quickbooks_customer_id: customerId } as never)
      .eq("id", clientId);
    return customerId;
  } catch (err) {
    console.error("[qbo] pushClientToQuickBooks failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Invoice sync
// ---------------------------------------------------------------------------

/**
 * Push a Sollos invoice into QBO as an Invoice. Ensures the customer is synced
 * first. Idempotent via invoices.quickbooks_invoice_id. Returns the QBO invoice
 * id, or null on failure (logged).
 */
export async function pushInvoiceToQuickBooks(
  invoiceId: string,
): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data: invoice } = (await admin
    .from("invoices")
    .select(
      `
        id, organization_id, client_id, number, amount_cents, due_date,
        created_at, tax_rate_bps, tax_amount_cents, quickbooks_invoice_id,
        line_items:invoice_line_items ( id, label, quantity, unit_price_cents, sort_order )
      `,
    )
    .eq("id", invoiceId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      client_id: string;
      number: string | null;
      amount_cents: number;
      due_date: string | null;
      created_at: string;
      tax_rate_bps: number | null;
      tax_amount_cents: number | null;
      quickbooks_invoice_id: string | null;
      line_items: Array<{
        id: string;
        label: string;
        quantity: number;
        unit_price_cents: number;
        sort_order: number;
      }> | null;
    } | null;
  };
  if (!invoice) return null;
  if (invoice.quickbooks_invoice_id) return invoice.quickbooks_invoice_id;

  const conn = await getQBConnection(invoice.organization_id);
  if (!conn) return null;

  const customerId = await pushClientToQuickBooks(invoice.client_id);
  if (!customerId) {
    console.error("[qbo] pushInvoiceToQuickBooks: could not sync client, aborting");
    return null;
  }

  try {
    const itemRef = await getDefaultItemRef(conn);
    if (!itemRef) {
      console.error(
        `[qbo] pushInvoiceToQuickBooks: no Item found in QBO for org ${invoice.organization_id} — invoice ${invoiceId} not synced (create a Service item in QuickBooks)`,
      );
      return null;
    }

    const taxCodeId = await getTaxCodeRefForBps(conn, invoice.tax_rate_bps);
    if (invoice.tax_rate_bps && invoice.tax_rate_bps > 0 && !taxCodeId) {
      console.warn(
        `[qbo] pushInvoiceToQuickBooks: no QBO tax code matches ${invoice.tax_rate_bps} bps for org ${invoice.organization_id} — syncing invoice ${invoiceId} without an explicit tax code`,
      );
    }

    const preTaxCents = invoice.amount_cents - (invoice.tax_amount_cents ?? 0);
    const rawLines = (invoice.line_items ?? [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const sourceLines =
      rawLines.length > 0
        ? rawLines.map((li) => ({
            description: li.label,
            quantity: Number(li.quantity) || 1,
            unitPrice: li.unit_price_cents / 100,
          }))
        : [{ description: "Services", quantity: 1, unitPrice: preTaxCents / 100 }];

    const Line = sourceLines.map((l) => ({
      DetailType: "SalesItemLineDetail",
      Amount: Math.round(l.quantity * l.unitPrice * 100) / 100,
      Description: l.description,
      SalesItemLineDetail: {
        ItemRef: { value: itemRef },
        Qty: l.quantity,
        UnitPrice: l.unitPrice,
        ...(taxCodeId ? { TaxCodeRef: { value: taxCodeId } } : {}),
      },
    }));

    const txnDate = new Date(invoice.created_at).toISOString().slice(0, 10);
    const dueDate =
      invoice.due_date ??
      new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

    const created = await qbFetch<{ Invoice: { Id: string } }>(
      conn,
      "/invoice",
      {
        method: "POST",
        body: JSON.stringify({
          CustomerRef: { value: customerId },
          TxnDate: txnDate,
          DueDate: dueDate,
          Line,
          ...(invoice.number
            ? { CustomerMemo: { value: `Sollos invoice ${invoice.number}` } }
            : {}),
        }),
      },
    );

    await admin
      .from("invoices")
      .update({ quickbooks_invoice_id: created.Invoice.Id } as never)
      .eq("id", invoiceId);
    console.log(
      `[qbo] invoice ${invoiceId} (${invoice.number}) → QBO ${created.Invoice.Id}`,
    );
    return created.Invoice.Id;
  } catch (err) {
    console.error("[qbo] pushInvoiceToQuickBooks failed:", err);
    return null;
  }
}

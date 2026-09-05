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
import { getEnv } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  consumeOAuthState,
  issueOAuthState,
  type OAuthStateOutcome,
} from "@/lib/oauth-state";

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
export function issueQBOAuthState(args: {
  organizationId: string;
  membershipId: string;
}): Promise<string> {
  return issueOAuthState("quickbooks_oauth_states", args);
}

/**
 * Claim a state token. See @/lib/oauth-state for why a replayed callback is a
 * distinct outcome rather than an error.
 */
export function consumeQBOAuthState(
  state: string,
): Promise<OAuthStateOutcome> {
  return consumeOAuthState("quickbooks_oauth_states", state);
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
    // Keep Intuit's correlation id on auth failures too — token-exchange
    // problems are exactly what their support team gets asked to trace.
    const tid = res.headers.get("intuit_tid") ?? "none";
    await admin
      .from("integration_connections" as never)
      .update({
        status: "error",
        last_error: `QBO token refresh failed: ${res.status} [intuit_tid=${tid}]`,
      } as never)
      .eq("id" as never, connectionId);
    throw new Error(
      `QuickBooks token refresh failed: ${res.status} [intuit_tid=${tid}]`,
    );
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
    // intuit_tid is Intuit's request correlation id. Capturing it in the
    // error means their support team can trace one specific failed call
    // instead of guessing from timestamps.
    const tid = res.headers.get("intuit_tid") ?? "none";
    throw new Error(
      `QBO ${init.method ?? "GET"} ${path} → ${res.status} [intuit_tid=${tid}]: ${await res.text()}`,
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
  Name?: string;
  Active?: boolean;
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
/**
 * The connected company's country code ("CA", "US", "GB", …), cached on the
 * connection. Matters because QuickBooks enforces sales tax differently
 * outside the US: CA/AU/UK companies REQUIRE a TaxCodeRef on every sales line,
 * so silently omitting one (fine in the US) gets the whole invoice rejected.
 */
async function getCompanyCountry(conn: QBConnection): Promise<string | null> {
  const cached = (conn.metadata ?? {})["company_country"];
  if (typeof cached === "string" && cached) return cached;
  try {
    const info = await qbQuery<{
      CompanyInfo?: Array<{ Country?: string }>;
    }>(conn, "SELECT * FROM CompanyInfo");
    const country = info.CompanyInfo?.[0]?.Country ?? null;
    if (country) {
      await mergeConnectionMetadata(conn.id, { company_country: country });
    }
    return country;
  } catch (err) {
    console.error("[qbo] company country lookup failed:", err);
    return null;
  }
}

async function getTaxCodeRefForBps(
  conn: QBConnection,
  bps: number | null | undefined,
): Promise<string | null> {
  if (!bps || bps <= 0) return null;
  const pct = bps / 100;
  const cacheKey = `tax_code_id_${bps}`;
  const cached = (conn.metadata ?? {})[cacheKey];
  if (typeof cached === "string" && cached) return cached;

  // Walk CODES first, then total the rates each one references on its SALES
  // side. The obvious approach — find a TaxRate whose value matches, then find
  // a code using it — is wrong outside the US: QuickBooks keeps SEPARATE rate
  // entities for sales and purchases at the same percentage, so "find the 13%
  // rate" reliably returns the PURCHASE rate (id 11 in a CA company), which no
  // sales code references, and matching silently fails.
  //
  // Totalling the components also handles composite provincial codes, e.g. BC
  // where 5% GST + 7% PST must add up to a 12% Sollos rate.
  const rates = await qbQuery<{
    TaxRate?: Array<{ Id: string; RateValue?: number }>;
  }>(conn, "SELECT Id, RateValue FROM TaxRate");
  const rateById = new Map<string, number>();
  for (const r of rates.TaxRate ?? []) {
    if (typeof r.RateValue === "number") {
      rateById.set(String(r.Id), r.RateValue);
    }
  }

  const codes = await qbQuery<{ TaxCode?: QBTaxCode[] }>(
    conn,
    "SELECT * FROM TaxCode",
  );
  for (const c of codes.TaxCode ?? []) {
    if (c.Active === false) continue;
    const details = c.SalesTaxRateList?.TaxRateDetail ?? [];
    if (details.length === 0) continue;

    let total = 0;
    let resolvable = true;
    for (const d of details) {
      const v = rateById.get(String(d.TaxRateRef?.value ?? ""));
      if (typeof v !== "number") {
        resolvable = false;
        break;
      }
      total += v;
    }
    if (!resolvable) continue;

    if (Math.abs(total - pct) < 0.001) {
      await mergeConnectionMetadata(conn.id, { [cacheKey]: c.Id });
      console.log(
        `[qbo] tax ${pct}% → code ${c.Id} ("${c.Name ?? "?"}") for org ${conn.organization_id}`,
      );
      return c.Id;
    }
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
export type QBCustomerPush = {
  id: string | null;
  /** Why there is no id — worded for the person who has to fix it. */
  error?: string;
  /** Retrying with the same data will fail again. */
  permanent?: boolean;
};

export async function pushClientToQuickBooks(
  clientId: string,
): Promise<QBCustomerPush> {
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
  if (!client) return { id: null, error: "Client not found.", permanent: true };
  if (client.quickbooks_customer_id) return { id: client.quickbooks_customer_id };
  const conn = await getQBConnection(client.organization_id);
  if (!conn) {
    return {
      id: null,
      error:
        "QuickBooks isn't connected. Reconnect it in Settings → Integrations, then try again.",
    };
  }
  if (!client.name.trim()) {
    return {
      id: null,
      error: "QuickBooks needs a display name for the customer; this client has none.",
      permanent: true,
    };
  }

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
    return { id: customerId };
  } catch (err) {
    // Until 2026-09-04 this returned null and the caller said "check the
    // client has a name" — Intuit's actual sentence went to the log only.
    console.error("[qbo] pushClientToQuickBooks failed:", err);
    const raw = err instanceof Error ? err.message : String(err);
    return {
      id: null,
      error: `QuickBooks refused to create ${client.name} as a customer — ${describeQBOError(raw)}`,
      permanent: isPermanentQBOError(raw),
    };
  }
}

// ---------------------------------------------------------------------------
// Invoice sync
// ---------------------------------------------------------------------------

/**
 * Push a Sollos invoice into QBO as an Invoice. Ensures the customer is synced
 * first. Idempotent via invoices.quickbooks_invoice_id.
 *
 * Returns { id } on success, or { id: null, error } with the REAL reason on
 * failure — callers that show a message to a human must use `error` rather
 * than guessing. (It previously returned bare null, so the UI printed a
 * speculative "probably a missing Service item" message that sent us chasing
 * the wrong thing during sandbox testing.)
 */
export async function pushInvoiceToQuickBooks(
  invoiceId: string,
): Promise<{ id: string | null; error?: string; permanent?: boolean }> {
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
  const fail = async (error: string, permanent = false) => {
    console.error(`[qbo] invoice ${invoiceId}: ${error}`);
    if (invoice) await recordQBOError(invoice.organization_id, error);
    return { id: null, error, permanent };
  };

  if (!invoice) return fail("Invoice not found.", true);
  if (invoice.quickbooks_invoice_id) {
    return { id: invoice.quickbooks_invoice_id };
  }

  const conn = await getQBConnection(invoice.organization_id);
  if (!conn) {
    return fail(
      "QuickBooks isn't connected. Reconnect it in Settings → Integrations, then try again.",
    );
  }

  const customer = await pushClientToQuickBooks(invoice.client_id);
  const customerId = customer.id;
  if (!customerId) {
    return fail(
      customer.error ??
        "Couldn't create this client as a QuickBooks customer. Try again, and if it keeps failing reconnect QuickBooks in Settings → Integrations.",
      customer.permanent ?? false,
    );
  }

  try {
    const itemRef = await getDefaultItemRef(conn);
    if (!itemRef) {
      return fail(
        "QuickBooks has no product or service to put on the invoice line. Create one in QuickBooks (Sales → Products & services), then try again.",
        true,
      );
    }

    const country = await getCompanyCountry(conn);
    const isUsCompany = (country ?? "US").toUpperCase() === "US";
    const taxCodeId = await getTaxCodeRefForBps(conn, invoice.tax_rate_bps);
    const taxPct = (invoice.tax_rate_bps ?? 0) / 100;

    // A TAXED invoice we cannot map to a QuickBooks tax code must never sync.
    //
    // This used to be a hard failure only outside the US, on the assumption
    // that omitting TaxCodeRef would let QuickBooks apply its own default.
    // US sandbox testing disproved that: QuickBooks marks every line
    // "Nontaxable" and books the PRE-TAX total, so the invoice the client was
    // billed and the invoice in the books silently disagree — $353.86 sent vs
    // $325.00 recorded in the observed case. A refused sync is recoverable;
    // a quiet discrepancy in someone's accounting is not.
    if (invoice.tax_rate_bps && invoice.tax_rate_bps > 0 && !taxCodeId) {
      // Permanent until someone adds the rate in QuickBooks — the reconciler
      // will pick it up again after ?retry_skipped=1.
      return fail(
        isUsCompany
          ? `No sales tax code in QuickBooks matches this invoice's ${taxPct}% rate. Syncing would record the invoice as untaxed, so your books would disagree with what the client was billed. Add a matching ${taxPct}% sales tax rate in QuickBooks (Taxes → Sales tax), then try again — or change this invoice's tax rate to one QuickBooks already has.`
          : `QuickBooks (${country}) requires a matching sales tax code, and no tax rate of ${taxPct}% exists in your QuickBooks company. Add a ${taxPct}% sales tax rate in QuickBooks (Taxes → Sales tax), then try again — or change this invoice's tax rate to one QuickBooks already has.`,
        true,
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

    // Books dates are calendar dates in the BUSINESS's timezone. The UTC
    // slice put an evening invoice on the next day's books.
    const { getOrgTimezone } = await import("@/lib/org-timezone");
    const { zonedYmd } = await import("@/lib/wall-clock");
    const orgTz = await getOrgTimezone(conn.organization_id);
    const txnDate = zonedYmd(new Date(invoice.created_at), orgTz);
    const dueDate =
      invoice.due_date ??
      zonedYmd(new Date(Date.now() + 14 * 86_400_000), orgTz);

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
          // Non-US companies (CA/AU/UK) need the tax treatment stated
          // explicitly. Sollos always computes tax ON TOP of the line
          // subtotal, which is "TaxExcluded"; with no tax it's NotApplicable.
          ...(isUsCompany
            ? {}
            : {
                GlobalTaxCalculation: taxCodeId
                  ? "TaxExcluded"
                  : "NotApplicable",
              }),
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
    await recordQBOError(invoice.organization_id, null);
    console.log(
      `[qbo] invoice ${invoiceId} (${invoice.number}) → QBO ${created.Invoice.Id}`,
    );
    return { id: created.Invoice.Id };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return fail(
      `QuickBooks rejected the invoice — ${describeQBOError(raw)}`,
      isPermanentQBOError(raw),
    );
  }
}

// ---------------------------------------------------------------------------
// Errors that say something, and the connection remembers them
// ---------------------------------------------------------------------------

/** Stamp the connection card's "last error" so the Integrations page shows it. */
async function recordQBOError(
  organizationId: string,
  message: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("integration_connections" as never)
    .update({ last_error: message ? message.slice(0, 500) : null } as never)
    .eq("organization_id" as never, organizationId as never)
    .eq("provider" as never, "quickbooks")
    .eq("status" as never, "active");
}

/**
 * Turn "QBO POST /payment → 400 [intuit_tid=…]: {"Fault":{"Error":[{"Message":
 * "…","Detail":"…","code":"6000"}]}}" into the sentence Intuit put inside it.
 * Keeps the status and the intuit_tid (their support asks for it).
 */
export function describeQBOError(message: string): string {
  const m = message.match(/→\s*(\d{3})\s*\[intuit_tid=([^\]]*)\]:\s*([\s\S]*)$/);
  if (!m) return message;
  const [, status, tid, body] = m;
  try {
    const parsed = JSON.parse(body) as {
      Fault?: { Error?: Array<{ Message?: string; Detail?: string; code?: string }> };
    };
    const errs = parsed.Fault?.Error ?? [];
    const lines = errs
      .map((e) => [e.Message, e.Detail].filter(Boolean).join(": "))
      .filter(Boolean);
    if (lines.length) {
      return `QuickBooks said (${status}): ${lines.join("; ")} [intuit_tid=${tid}]`;
    }
  } catch {
    // not JSON — fall through
  }
  return `QuickBooks answered ${status}: ${body.slice(0, 300)} [intuit_tid=${tid}]`;
}

/** A 4xx means Intuit read the request and refused it; the same payload will be refused again. */
function isPermanentQBOError(message: string): boolean {
  return /→\s*4\d\d\s*\[/.test(message);
}

/** For the reconciler: merge a patch into the QuickBooks connection's metadata. */
export async function mergeQBConnectionMetadata(
  organizationId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const conn = await getQBConnection(organizationId);
  if (conn) await mergeConnectionMetadata(conn.id, patch);
}

// ---------------------------------------------------------------------------
// Payment sync
// ---------------------------------------------------------------------------
//
// A Sollos payment becomes a QuickBooks Payment applied to the invoice
// (LinkedTxn). Deposited to Undeposited Funds by default — QuickBooks'
// own default when DepositToAccountRef is omitted — so the bookkeeper
// matches it to the bank feed the way they already do.
//
// Idempotent on invoice_payments.quickbooks_payment_id. Pushes the invoice
// first if it isn't there yet.

type QBPaymentMethod = { Id: string; Name: string };

/** Payment-method ids by name, read once and cached on the connection. */
async function getQBPaymentMethods(
  conn: QBConnection,
): Promise<Record<string, string>> {
  const cached = (conn.metadata ?? {})["payment_methods"];
  if (cached && typeof cached === "object" && !Array.isArray(cached)) {
    return cached as Record<string, string>;
  }
  try {
    const resp = await qbQuery<{ PaymentMethod?: QBPaymentMethod[] }>(
      conn,
      "SELECT Id, Name FROM PaymentMethod WHERE Active = true MAXRESULTS 50",
    );
    const map: Record<string, string> = {};
    for (const m of resp.PaymentMethod ?? []) map[m.Name.toLowerCase()] = m.Id;
    await mergeConnectionMetadata(conn.id, { payment_methods: map });
    return map;
  } catch (err) {
    console.error("[qbo] PaymentMethod lookup failed:", err);
    return {};
  }
}

/** Sollos payment method → a QuickBooks PaymentMethod id, if the company has a matching name. */
function qbPaymentMethodRef(
  method: string,
  byName: Record<string, string>,
): string | null {
  const candidates: Record<string, string[]> = {
    card: ["credit card", "visa", "mastercard", "debit card"],
    cash: ["cash"],
    check: ["check", "cheque"],
    bank_transfer: ["bank transfer", "e-transfer", "etransfer", "direct deposit", "eft"],
    ach: ["ach", "bank transfer", "direct deposit", "eft"],
    zelle: ["zelle", "bank transfer"],
    venmo: ["venmo"],
    cashapp: ["cash app", "cashapp"],
  };
  for (const name of candidates[method] ?? []) {
    const id = byName[name];
    if (id) return id;
  }
  return null;
}

export async function pushInvoicePaymentToQuickBooks(
  paymentId: string,
): Promise<{ id: string | null; error?: string; permanent?: boolean }> {
  const admin = createSupabaseAdminClient();

  const { data: payment } = (await admin
    .from("invoice_payments" as never)
    .select(
      "id, organization_id, invoice_id, amount_cents, method, reference, received_at, quickbooks_payment_id, invoice:invoices ( id, number, quickbooks_invoice_id, client_id, voided_at )",
    )
    .eq("id" as never, paymentId as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      invoice_id: string;
      amount_cents: number;
      method: string;
      reference: string | null;
      received_at: string;
      quickbooks_payment_id: string | null;
      invoice: {
        id: string;
        number: string | null;
        quickbooks_invoice_id: string | null;
        client_id: string | null;
        voided_at: string | null;
      } | null;
    } | null;
  };
  if (!payment) return { id: null, error: "Payment not found.", permanent: true };
  if (payment.quickbooks_payment_id) return { id: payment.quickbooks_payment_id };
  if (!payment.invoice) {
    return { id: null, error: "Payment has no invoice.", permanent: true };
  }
  if (payment.invoice.voided_at) {
    return {
      id: null,
      error:
        "The invoice is void; a payment against it would not reconcile. Refund or re-issue instead.",
      permanent: true,
    };
  }

  const orgId = payment.organization_id;
  const fail = async (error: string, permanent = false) => {
    console.error(`[qbo] payment ${paymentId}: ${error}`);
    await recordQBOError(orgId, error);
    return { id: null, error, permanent };
  };

  const conn = await getQBConnection(orgId);
  if (!conn) {
    return fail(
      "QuickBooks isn't connected. Reconnect it in Settings → Integrations, then try again.",
    );
  }

  let qbInvoiceId = payment.invoice.quickbooks_invoice_id;
  if (!qbInvoiceId) {
    const inv = await pushInvoiceToQuickBooks(payment.invoice.id);
    if (!inv.id) {
      return fail(
        `The invoice isn't in QuickBooks yet, and pushing it failed: ${inv.error ?? "unknown error"}`,
        inv.permanent ?? false,
      );
    }
    qbInvoiceId = inv.id;
  }

  const { data: client } = (await admin
    .from("clients")
    .select("quickbooks_customer_id")
    .eq("id", payment.invoice.client_id ?? "")
    .maybeSingle()) as unknown as {
    data: { quickbooks_customer_id: string | null } | null;
  };
  const customerId = client?.quickbooks_customer_id;
  if (!customerId) {
    return fail(
      "The client has no QuickBooks customer yet; sync the invoice first.",
      false,
    );
  }

  try {
    // QuickBooks refuses to apply more than the invoice's balance. A client
    // who rounds up is still real money: apply what the invoice can take,
    // the rest sits as an unapplied credit on the customer, as a
    // bookkeeper would leave it.
    const { Invoice: qbInvoice } = await qbFetch<{
      Invoice: { Id: string; Balance?: number | string };
    }>(conn, `/invoice/${qbInvoiceId}`);
    const balance = Number(qbInvoice.Balance ?? 0);
    if (!(balance > 0)) {
      return fail(
        `QuickBooks already shows ${payment.invoice.number ?? "this invoice"} as paid — the payment was recorded there by hand. Nothing pushed, nothing to fix.`,
        true,
      );
    }
    const amount = payment.amount_cents / 100;
    const applied = Math.min(amount, balance);

    const { getOrgTimezone } = await import("@/lib/org-timezone");
    const { zonedYmd } = await import("@/lib/wall-clock");
    const orgTz = await getOrgTimezone(orgId);
    const txnDate = zonedYmd(new Date(payment.received_at), orgTz);

    const methodRef = qbPaymentMethodRef(
      payment.method,
      await getQBPaymentMethods(conn),
    );
    // PaymentRefNum is 21 chars in QuickBooks.
    const refNum = (payment.reference ?? "").trim().slice(0, 21) || undefined;

    const created = await qbFetch<{ Payment: { Id: string } }>(conn, "/payment", {
      method: "POST",
      body: JSON.stringify({
        CustomerRef: { value: customerId },
        TotalAmt: amount,
        TxnDate: txnDate,
        ...(refNum ? { PaymentRefNum: refNum } : {}),
        ...(methodRef ? { PaymentMethodRef: { value: methodRef } } : {}),
        Line: [
          {
            Amount: applied,
            LinkedTxn: [{ TxnId: qbInvoiceId, TxnType: "Invoice" }],
          },
        ],
      }),
    });

    await admin
      .from("invoice_payments" as never)
      .update({ quickbooks_payment_id: created.Payment.Id } as never)
      .eq("id" as never, paymentId as never);
    await recordQBOError(orgId, null);
    console.log(
      `[qbo] payment ${paymentId} (${payment.invoice.number}, ${amount}${amount > applied ? `, ${Math.round((amount - applied) * 100) / 100} unapplied` : ""}) → QBO payment ${created.Payment.Id}`,
    );
    return { id: created.Payment.Id };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return fail(describeQBOError(raw), isPermanentQBOError(raw));
  }
}

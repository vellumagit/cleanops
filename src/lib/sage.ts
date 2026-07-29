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
import {
  consumeOAuthState,
  issueOAuthState,
  type OAuthStateOutcome,
} from "@/lib/oauth-state";
import { sageRatePercent, type SageTaxRate } from "@/lib/sage-rate";

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
 * Mint a single-use CSRF state token for the Sage OAuth handshake, tied to
 * (org, membership) with a 10-minute TTL. Mirrors the Stripe/Square flows —
 * the previous code passed the (stable) membership id as the state, a weaker
 * guard. Persisted in sage_oauth_states; claimed once at callback.
 */
export function issueSageOAuthState(args: {
  organizationId: string;
  membershipId: string;
}): Promise<string> {
  return issueOAuthState("sage_oauth_states", args);
}

/**
 * Claim a Sage OAuth state token. See @/lib/oauth-state for why a replayed
 * callback is a distinct outcome rather than an error.
 */
export function consumeSageOAuthState(
  state: string,
): Promise<OAuthStateOutcome> {
  return consumeOAuthState("sage_oauth_states", state);
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
  metadata: Record<string, unknown> | null;
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
      "id, organization_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, status, metadata",
    )
    .eq("organization_id" as never, organizationId as never)
    .eq("provider" as never, "sage" as never)
    .eq("status" as never, "active" as never)
    .maybeSingle()) as unknown as { data: SageConnection | null };
  return data ?? null;
}

/**
 * Read → merge → write a patch into integration_connections.metadata. Used to
 * cache Sage lookups (sales ledger account, tax-rate ids) so we don't refetch
 * them on every invoice sync.
 */
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
  const merged = { ...(data?.metadata ?? {}), ...patch };
  await admin
    .from("integration_connections" as never)
    .update({ metadata: merged } as never)
    .eq("id" as never, connectionId as never);
}

type SageLedgerAccount = {
  id: string;
  displayed_as?: string | null;
  nominal_code?: string | null;
  visible_in_sales?: boolean | null;
  ledger_account_type?: { displayed_as?: string | null } | null;
};

/**
 * Resolve the org's SALES ledger account id — Sage requires one on every
 * sales-invoice line for its double-entry books. Cached on the connection
 * metadata after the first lookup. Returns null if Sage exposes no
 * sales-suitable account (the caller then aborts the sync with a clear log).
 */
async function getSalesLedgerAccountId(
  conn: SageConnection,
): Promise<string | null> {
  const cached = (conn.metadata ?? {})["sales_ledger_account_id"];
  if (typeof cached === "string" && cached) return cached;

  const resp = await sageFetch<{ $items?: SageLedgerAccount[] }>(
    conn.organization_id,
    "/ledger_accounts?items_per_page=200&attributes=all",
  );
  const items = resp.$items ?? [];
  const looksLikeSales = (a: SageLedgerAccount) =>
    /sale|revenue|income/i.test(a.displayed_as ?? "") ||
    /sale|revenue|income/i.test(a.ledger_account_type?.displayed_as ?? "");
  const chosen =
    items.find((a) => a.nominal_code === "4000") ??
    items.find((a) => a.visible_in_sales === true && looksLikeSales(a)) ??
    items.find((a) => a.visible_in_sales === true) ??
    items.find(looksLikeSales) ??
    null;

  if (chosen?.id) {
    await mergeConnectionMetadata(conn.id, {
      sales_ledger_account_id: chosen.id,
    });
    return chosen.id;
  }
  return null;
}

// Percentage parsing lives in @/lib/sage-rate — it's subtle (strings, dated
// history, attributes=all) and belongs somewhere testable.

/**
 * Resolve the Sage tax_rate_id whose percentage matches the Sollos rate (bps),
 * so the synced invoice total includes tax and reconciles with Sollos. Cached
 * per-rate on the connection metadata. Returns null when tax is zero or no Sage
 * rate matches (caller then syncs without tax and logs a warning).
 */
async function getTaxRateIdForBps(
  conn: SageConnection,
  bps: number | null | undefined,
  onDate: string,
): Promise<{ id: string | null; available: string[] }> {
  if (!bps || bps <= 0) return { id: null, available: [] };
  const pct = bps / 100;
  const cacheKey = `tax_rate_id_${bps}`;
  const cached = (conn.metadata ?? {})[cacheKey];
  if (typeof cached === "string" && cached) {
    return { id: cached, available: [] };
  }

  // attributes=all is REQUIRED. Without it Sage returns only id/displayed_as
  // and every comparison below misses. getSalesLedgerAccountId already asked
  // for it; this call didn't, so no tax rate could ever match — including the
  // ones that genuinely existed.
  const resp = await sageFetch<{ $items?: SageTaxRate[] }>(
    conn.organization_id,
    "/tax_rates?items_per_page=200&attributes=all",
  );
  const items = resp.$items ?? [];

  const match = items.find((t) => {
    const p = sageRatePercent(t, onDate);
    return p !== null && Math.abs(p - pct) < 0.001;
  });

  if (match?.id) {
    await mergeConnectionMetadata(conn.id, { [cacheKey]: match.id });
    return { id: match.id, available: [] };
  }

  // Name what Sage DOES have, so a mismatch tells the reader what to go fix
  // instead of leaving them guessing which rates exist.
  const available = items.map((t) => {
    const p = sageRatePercent(t, onDate);
    return `${t.displayed_as ?? t.id}${p === null ? "" : ` (${p}%)`}`;
  });
  return { id: null, available };
}

type SageAddressRegion = {
  id: string;
  displayed_as?: string | null;
  country_id?: string | null;
};

/**
 * List the address regions this Sage account accepts (e.g. "CA-ON", "US-KY").
 *
 * Sage's US and Canadian editions require a tax_address_region_id on every
 * sales invoice so they can validate the tax against the sale's destination —
 * omitting it fails the POST with 422 "tax_address_region_id is required".
 *
 * Deliberately not cached: it's read only when an admin opens the picker, and
 * it throws with Sage's own message so the settings page can explain an empty
 * list instead of rendering a mysteriously blank dropdown.
 */
export async function listSageAddressRegions(
  organizationId: string,
): Promise<SageAddressRegion[]> {
  const resp = await sageFetch<{ $items?: SageAddressRegion[] }>(
    organizationId,
    "/address_regions?items_per_page=200",
  );
  return resp.$items ?? [];
}

/** The org's chosen tax address region, or null when it hasn't picked one. */
export function getSageTaxRegionId(conn: SageConnection): string | null {
  const v = (conn.metadata ?? {})["tax_address_region_id"];
  return typeof v === "string" && v ? v : null;
}

/** Persist the org's tax-region choice onto its Sage connection. */
export async function setSageTaxRegionId(
  organizationId: string,
  regionId: string,
): Promise<boolean> {
  const conn = await getSageConnection(organizationId);
  if (!conn) return false;
  await mergeConnectionMetadata(conn.id, { tax_address_region_id: regionId });
  return true;
}

/**
 * Record a Sage failure on the connection row so an owner can read it in
 * Settings → Integrations.
 *
 * These errors used to exist only in the server logs, so the UI told people to
 * "check Vercel logs" — useless to the person who actually hit the problem,
 * and it cost a CLI token and a log dig to recover a 422 body the app already
 * had in hand.
 */
async function recordSageError(
  organizationId: string,
  message: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("integration_connections" as never)
    .update({ last_error: message ? message.slice(0, 500) : null } as never)
    .eq("organization_id" as never, organizationId as never)
    .eq("provider" as never, "sage")
    .eq("status" as never, "active");
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
 * Returns { id } on success, or { id: null, error } carrying Sage's REAL
 * message on failure — mirroring pushInvoiceToQuickBooks, which learned this
 * same lesson: a bare null made the UI print a speculative cause and sent us
 * chasing the wrong thing. The message is also stamped onto the connection's
 * last_error so it can be read from Settings → Integrations.
 */
export async function pushInvoiceToSage(
  invoiceId: string,
): Promise<{ id: string | null; error?: string }> {
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
    console.error(`[sage] pushInvoiceToSage: invoice ${invoiceId} not found`);
    return { id: null, error: "Invoice not found." };
  }
  if (invoice.sage_invoice_id) {
    return { id: invoice.sage_invoice_id };
  }

  const orgId = invoice.organization_id;
  const fail = async (error: string) => {
    console.error(`[sage] invoice ${invoiceId}: ${error}`);
    await recordSageError(orgId, error);
    return { id: null, error };
  };

  const conn = await getSageConnection(orgId);
  if (!conn) {
    return fail(
      "Sage isn't connected. Reconnect it in Settings → Integrations, then try again.",
    );
  }

  // Sage's US and Canadian editions reject a sales invoice that doesn't say
  // where the sale is destined — they validate the tax against that region.
  const taxRegionId = getSageTaxRegionId(conn);
  if (!taxRegionId) {
    return fail(
      "Sage needs a tax region before it will accept invoices. Pick one in Settings → Integrations → Sage Accounting, then try again.",
    );
  }

  // Ensure the client exists in Sage first.
  const sageContactId = await pushClientToSage(invoice.client_id);
  if (!sageContactId) {
    return fail(
      "Couldn't create this client as a Sage contact. Check the client has a name, then try again.",
    );
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
    // Sage requires a sales ledger account on every invoice line. Resolve (and
    // cache) the org's; abort with a clear log if Sage has none configured.
    const ledgerAccountId = await getSalesLedgerAccountId(conn);
    if (!ledgerAccountId) {
      return fail(
        "Sage has no sales ledger account to post this invoice to. Create one in Sage (Settings → Chart of Accounts), then try again.",
      );
    }

    // Map the Sollos tax rate to a Sage tax_rate_id so the synced invoice total
    // INCLUDES tax and reconciles with Sollos. If Sage has no matching rate,
    // sync without tax and warn (totals will understate until one is set up).
    const taxRate = await getTaxRateIdForBps(
      conn,
      invoice.tax_rate_bps,
      invoiceDate,
    );
    const taxRateId = taxRate.id;
    if (invoice.tax_rate_bps && invoice.tax_rate_bps > 0 && !taxRateId) {
      // This used to warn and sync WITHOUT tax, quietly posting a total lower
      // than the invoice the client actually received. A failed sync is
      // recoverable; a wrong number sitting in someone's books is not — and
      // Sage validates the rate against the region anyway, so the silent path
      // was usually about to be rejected regardless.
      return fail(
        `Sage has no tax rate matching ${(invoice.tax_rate_bps / 100).toFixed(2)}%. ` +
          (taxRate.available.length
            ? `Sage currently has: ${taxRate.available.join(", ")}. `
            : "") +
          `Create a matching rate in Sage for the ${taxRegionId} region (Settings → Tax Rates), then try again.`,
      );
    }

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
            // Required by Sage US/CA — without it the POST 422s with
            // "tax_address_region_id is required".
            tax_address_region_id: taxRegionId,
            invoice_lines: sageLines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unit_price: l.unit_price,
              ledger_account_id: ledgerAccountId,
              ...(taxRateId ? { tax_rate_id: taxRateId } : {}),
            })),
          },
        }),
      },
    );

    await admin
      .from("invoices")
      .update({ sage_invoice_id: result.id } as never)
      .eq("id", invoiceId);

    // Clear any stale failure now that a sync has gone through.
    await recordSageError(orgId, null);

    console.log(
      `[sage] pushInvoiceToSage: invoice ${invoiceId} (${invoice.number}) → sage ${result.id}`,
    );
    return { id: result.id };
  } catch (err) {
    return fail(
      err instanceof Error ? err.message : "Unknown error pushing to Sage.",
    );
  }
}

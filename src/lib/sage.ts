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
import { parsePostalAddress } from "@/lib/postal-address";
import {
  consumeOAuthState,
  issueOAuthState,
  type OAuthStateOutcome,
} from "@/lib/oauth-state";
import {
  allocateLineTax,
  sageRatePercent,
  type SageTaxRate,
} from "@/lib/sage-rate";

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
/**
 * The account's explicit zero-rate tax code (Canada ships `CA_NO_TAX`).
 *
 * Sage requires a tax rate on EVERY invoice line, including untaxed ones —
 * omitting it fails validation on tax_rate_id, tax_rate AND
 * currency_tax_amount at once, because Sage can't derive any of them without
 * the rate. So an untaxed invoice still has to name a rate explicitly.
 */
async function getNoTaxRateId(
  conn: SageConnection,
  onDate: string,
): Promise<string | null> {
  const cached = (conn.metadata ?? {})["no_tax_rate_id"];
  if (typeof cached === "string" && cached) return cached;

  const resp = await sageFetch<{ $items?: SageTaxRate[] }>(
    conn.organization_id,
    "/tax_rates?items_per_page=200&attributes=all",
  );
  const items = resp.$items ?? [];
  const chosen =
    items.find((t) => t.type === "NO_TAX") ??
    items.find((t) => sageRatePercent(t, onDate) === 0) ??
    null;

  if (chosen?.id) {
    await mergeConnectionMetadata(conn.id, { no_tax_rate_id: chosen.id });
    return chosen.id;
  }
  return null;
}

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

/**
 * Merge a patch into the org's Sage connection metadata.
 *
 * The connection row's jsonb is the scratch space for everything we learn
 * about an org's Sage setup — resolved ledger account, matched tax rates, the
 * reconciler's skip-list — so none of it needs a column of its own.
 */
export async function mergeSageConnectionMetadata(
  organizationId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const conn = await getSageConnection(organizationId);
  if (!conn) return false;
  await mergeConnectionMetadata(conn.id, patch);
  return true;
}

/** Persist the org's tax-region choice onto its Sage connection. */
export function setSageTaxRegionId(
  organizationId: string,
  regionId: string,
): Promise<boolean> {
  return mergeSageConnectionMetadata(organizationId, {
    tax_address_region_id: regionId,
  });
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
    // Two different situations wore the same sentence until 2026-09-04:
    // no connection row at all, and a connection whose refresh failed.
    // The second one is the one people hit, and "not connected" sent
    // them to check a page that said Connected.
    const conn = await getSageConnection(organizationId);
    throw new Error(
      conn
        ? "Sage's sign-in couldn't be renewed (the refresh token was rejected or the encryption key changed). Reconnect Sage in Settings → Integrations."
        : "Sage is not connected for this organization.",
    );
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

/** Read-only GET against the org's Sage account, for diagnostics and tooling. */
export function sageApiGet<T>(organizationId: string, path: string): Promise<T> {
  return sageFetch<T>(organizationId, path);
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
 *   - Sollos name    → Sage contact name
 *   - Sollos address → main_address AND delivery_address, parsed into
 *                      address_line_1 / city / region / postal_code /
 *                      country_id
 *   - Sollos email   → main_contact_person.email
 *   - Sollos phone   → main_contact_person.telephone
 *   - contact_type_ids: Sage requires at least one type; we pass
 *     "CUSTOMER" (Sage's built-in type id).
 *
 * This mapping was wrong until now: email and telephone were being written
 * INTO main_address, which has no such fields in Sage's schema — they belong
 * on main_contact_person. Worse, a client with a null address/email/phone
 * produced literally `"main_address": {}`, because JSON.stringify drops
 * undefined values. Sage accepted the contact (201) but every subsequent
 * sales-invoice POST for that contact 422'd with "Invoice Address is
 * required." — which is why no invoice has ever reached Sage.
 */
export type SageContactPush = {
  id: string | null;
  /** Why there is no id — worded for the person who has to fix it. */
  error?: string;
  /** Retrying with the same data will fail again. */
  permanent?: boolean;
};

export async function pushClientToSage(
  clientId: string,
): Promise<SageContactPush> {
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
    return { id: null, error: "Client not found.", permanent: true };
  }
  const conn = await getSageConnection(client.organization_id);
  if (!conn) {
    console.log(
      `[sage] pushClientToSage: org ${client.organization_id} has no active Sage connection`,
    );
    return {
      id: null,
      error:
        "Sage isn't connected. Reconnect it in Settings → Integrations, then try again.",
    };
  }

  if (client.sage_contact_id) {
    // The contact exists, but it may be one of the address-less ones this
    // function used to create — and Sage rejects invoices for those forever.
    // Push the current address up before returning. PUT is idempotent, so a
    // contact that is already correct simply stays correct.
    const repair = parsePostalAddress(client.address);
    if (repair) {
      try {
        await sageFetch(
          client.organization_id,
          `/contacts/${client.sage_contact_id}`,
          {
            method: "PUT",
            body: JSON.stringify({
              contact: {
                main_address: { name: "Main", ...repair },
                delivery_address: { name: "Delivery", ...repair },
              },
            }),
          },
        );
      } catch (err) {
        // Non-fatal: the invoice now carries its own addresses, so a failed
        // contact repair no longer blocks the sync.
        console.error(
          `[sage] contact ${client.sage_contact_id} address repair failed:`,
          err,
        );
      }
    }
    return { id: client.sage_contact_id };
  }

  // Sage will not accept an invoice for a contact with no address, so refuse
  // to create a contact we already know is unusable rather than storing an id
  // that poisons every future sync.
  const parsed = parsePostalAddress(client.address);
  if (!parsed) {
    console.error(
      `[sage] pushClientToSage: client ${clientId} has no usable address; ` +
        `Sage rejects invoices for address-less contacts, so not creating one`,
    );
    return {
      id: null,
      error: `Sage needs a postal address for ${client.name} before it can be created as a contact. Add one on the client (street, city, province, country), then sync again.`,
      permanent: true,
    };
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
            // Every Sage address needs a `name` label — without it the POST
            // is a 422 "This field is required. (addresses.name)". That
            // one line kept every new contact from being created between
            // 2026-07-31 (when addresses were first sent) and 2026-09-04,
            // and the error was swallowed into "check the client has a name".
            main_address: { name: "Main", ...parsed },
            // Sage treats these as separate records; without a delivery
            // address the invoice POST fails its own "Delivery Address is
            // required." rule even when main_address is present.
            delivery_address: { name: "Delivery", ...parsed },
            ...(client.email || client.phone
              ? {
                  main_contact_person: {
                    name: client.name,
                    ...(client.email ? { email: client.email } : {}),
                    ...(client.phone ? { telephone: client.phone } : {}),
                    is_main_contact: true,
                  },
                }
              : {}),
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
    return { id: result.id };
  } catch (err) {
    // Until 2026-09-04 this returned null and the caller told the user to
    // "check the client has a name" — while the real reason (Sage's own
    // validation message, a dead token, a 5xx) went to the server log and
    // nowhere else. Now the reason travels with the failure.
    console.error("[sage] pushClientToSage failed:", err);
    const message =
      err instanceof Error ? err.message : "Unknown error creating the contact.";
    return {
      id: null,
      error: `Sage refused to create ${client.name} as a contact — ${describeSageError(message)}`,
      permanent: /→\s*4\d\d:/.test(message),
    };
  }
}

/**
 * Turn "Sage API POST /contacts → 422: [{"$severity":"error",...,"$message":"…"}]"
 * into the human sentence Sage put inside it, keeping the status. Falls
 * back to the raw message when the body isn't the shape we expect.
 */
export function describeSageError(message: string): string {
  const m = message.match(/→\s*(\d{3}):\s*([\s\S]*)$/);
  if (!m) return message;
  const [, status, body] = m;
  try {
    const parsed = JSON.parse(body) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const lines = items
      .map((it) => {
        if (!it || typeof it !== "object") return null;
        const o = it as { $message?: string; $source?: string; message?: string };
        const text = o.$message ?? o.message;
        if (!text) return null;
        return o.$source ? `${text} (${o.$source})` : text;
      })
      .filter((x): x is string => Boolean(x));
    if (lines.length) return `Sage said (${status}): ${lines.join("; ")}`;
  } catch {
    // not JSON — fall through
  }
  return `Sage answered ${status}: ${body.slice(0, 300)}`;
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
 *
 * `permanent` marks a failure that retrying cannot fix — missing data or Sage
 * config, as opposed to a token blip or a 5xx. The reconcile cron uses it to
 * stop hammering an invoice that will fail identically every time.
 */
export async function pushInvoiceToSage(
  invoiceId: string,
): Promise<{ id: string | null; error?: string; permanent?: boolean }> {
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
        client:clients ( address ),
        booking:bookings!invoices_booking_id_fkey ( address ),
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
      client: { address: string | null } | null;
      booking: { address: string | null } | null;
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
    return { id: null, error: "Invoice not found.", permanent: true };
  }
  if (invoice.sage_invoice_id) {
    return { id: invoice.sage_invoice_id };
  }

  const orgId = invoice.organization_id;
  const fail = async (error: string, permanent = false) => {
    console.error(`[sage] invoice ${invoiceId}: ${error}`);
    await recordSageError(orgId, error);
    return { id: null, error, permanent };
  };

  const conn = await getSageConnection(orgId);
  if (!conn) {
    return fail(
      "Sage isn't connected. Reconnect it in Settings → Integrations, then try again.",
    );
  }

  // The org's configured region. Only used to word the tax-rate error below —
  // it is deliberately NOT sent on the invoice; see the payload comment.
  const orgTaxRegionId = getSageTaxRegionId(conn);

  // Ensure the client exists in Sage first.
  const contact = await pushClientToSage(invoice.client_id);
  const sageContactId = contact.id;
  if (!sageContactId) {
    return fail(
      contact.error ??
        "Couldn't create this client as a Sage contact. Try again, and if it keeps failing reconnect Sage in Settings → Integrations.",
      contact.permanent ?? false,
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
          unitPriceCents: li.unit_price_cents,
        }))
      : [
          {
            description: "Services",
            quantity: 1,
            unitPriceCents: preTaxCents,
          },
        ];

  // Sage wants the tax amount ON each line; Sollos stores it once per invoice.
  const lineTaxCents = allocateLineTax(
    sageLines.map((l) => Math.round(l.unitPriceCents * l.quantity)),
    invoice.tax_amount_cents ?? 0,
  );

  // Address for the invoice: the job's own address wins (that's where the
  // work happened), then the client's address on file. Resolved BEFORE the
  // POST so a missing address fails with a message naming the client instead
  // of a raw Sage 422.
  const invoiceAddress = parsePostalAddress(
    invoice.booking?.address ?? invoice.client?.address ?? null,
  );
  if (!invoiceAddress) {
    return fail(
      "Sage needs a service address on this invoice. Add an address to the " +
        "client (or to the booking) and sync again.",
      true,
    );
  }

  // Whether the address itself pins a tax jurisdiction. Drives the
  // tax_address_region_id decision at the POST — see the payload comment.
  const addressPinsRegion = Boolean(
    invoiceAddress.country_id && invoiceAddress.region,
  );
  if (!addressPinsRegion && !orgTaxRegionId) {
    return fail(
      "This invoice's address doesn't name a state/province and country, and no default tax region is set. Add a fuller address, or pick a region in Settings → Integrations → Sage Accounting.",
      true,
    );
  }

  // Same rule as QuickBooks: books dates are the business's calendar days,
  // not UTC's.
  const { getOrgTimezone } = await import("@/lib/org-timezone");
  const { zonedYmd } = await import("@/lib/wall-clock");
  const orgTz = await getOrgTimezone(conn.organization_id);
  const invoiceDate = zonedYmd(new Date(invoice.created_at), orgTz);
  const dueDate =
    invoice.due_date ?? zonedYmd(new Date(Date.now() + 14 * 86400_000), orgTz);

  try {
    // Sage requires a sales ledger account on every invoice line. Resolve (and
    // cache) the org's; abort with a clear log if Sage has none configured.
    const ledgerAccountId = await getSalesLedgerAccountId(conn);
    if (!ledgerAccountId) {
      return fail(
        "Sage has no sales ledger account to post this invoice to. Create one in Sage (Settings → Chart of Accounts), then try again.",
        true,
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
    const isTaxed = Boolean(invoice.tax_rate_bps && invoice.tax_rate_bps > 0);
    const taxRateId = taxRate.id;
    if (isTaxed && !taxRateId) {
      // This used to warn and sync WITHOUT tax, quietly posting a total lower
      // than the invoice the client actually received. A failed sync is
      // recoverable; a wrong number sitting in someone's books is not — and
      // Sage validates the rate against the region anyway, so the silent path
      // was usually about to be rejected regardless.
      return fail(
        `Sage has no tax rate matching ${((invoice.tax_rate_bps ?? 0) / 100).toFixed(2)}%. ` +
          (taxRate.available.length
            ? `Sage currently has: ${taxRate.available.join(", ")}. `
            : "") +
          `Create a matching rate in Sage${
            invoiceAddress.country_id && invoiceAddress.region
              ? ` for the ${invoiceAddress.country_id}-${invoiceAddress.region} region`
              : orgTaxRegionId
                ? ` for the ${orgTaxRegionId} region`
                : ""
          } (Settings → Tax Rates), then try again.`,
        true,
      );
    }

    // Every line needs a rate id — the zero-rate code when there's no tax.
    const lineTaxRateId = isTaxed
      ? taxRateId
      : await getNoTaxRateId(conn, invoiceDate);
    if (!lineTaxRateId) {
      return fail(
        "Sage has no zero-rate tax code to put on an untaxed invoice line. Check Settings → Tax Rates in Sage.",
        true,
      );
    }

    const postInvoice = (regionForAttempt: string | null) =>
      sageFetch<SageSalesInvoice>(
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
            // Sage will not create a sales invoice it cannot resolve an
            // address for. It only inherits one from the contact, so an
            // address-less contact produced a 422 naming BOTH rules:
            // "Invoice Address is required." + "Delivery Address is
            // required." Sending them explicitly makes the invoice
            // self-sufficient — it no longer depends on the contact record
            // being correct.
            main_address: invoiceAddress,
            delivery_address: invoiceAddress,
            // tax_address_region_id and the delivery address are mutually
            // exclusive — but only when the address actually pins a
            // jurisdiction. With country + region present Sage derives the tax
            // region itself and refuses ours ("not allowed"); with a vaguer
            // address (a bare street line, no city or country) it can derive
            // nothing and demands the field instead ("required"). Both were
            // observed on real invoices, so this is decided per invoice rather
            // than picking one and hoping. Not about the customer's country:
            // the "not allowed" case reproduced for a Canadian and a US
            // contact alike.
            ...(regionForAttempt
              ? { tax_address_region_id: regionForAttempt }
              : {}),
            invoice_lines: sageLines.map((l, i) => ({
              description: l.description,
              quantity: l.quantity,
              unit_price: l.unitPriceCents / 100,
              ledger_account_id: ledgerAccountId,
              // Sage rejects a line missing any of these, even at 0%.
              tax_rate_id: lineTaxRateId,
              // tax_amount is the field Sage actually stores. Its 422 names
              // `currency_tax_amount` — a value it DERIVES from this one — so
              // sending only that was ignored and it kept reporting the derived
              // field as missing. Verified against the live API: a line with
              // tax_rate_id + tax_amount is accepted at 201, and Sage echoes
              // back tax_amount / base_currency_tax_amount with no
              // currency_tax_amount field at all.
              tax_amount: lineTaxCents[i] / 100,
              currency_tax_amount: lineTaxCents[i] / 100,
            })),
          },
        }),
      },
    );

    // Which region to name. Live evidence, 2026-09-04, on the same Sage
    // account: an Edmonton address with province AND country was refused
    // WITHOUT the field ("tax_address_region_id is required"), while the
    // 2026-08-04 note above records the opposite refusal WITH it. Sage's
    // behaviour here is not stable enough to encode as a rule, so: send the
    // region the address implies (CA-AB from "AB, Canada"), falling back to
    // the org's configured one, and if Sage answers "not allowed" retry
    // once without it. One extra request on the rare path beats a
    // permanent skip-list entry on the common one.
    const impliedRegion =
      invoiceAddress.country_id && invoiceAddress.region
        ? `${invoiceAddress.country_id}-${invoiceAddress.region}`
        : null;
    const firstRegion = impliedRegion ?? orgTaxRegionId;
    let result: SageSalesInvoice;
    try {
      result = await postInvoice(firstRegion);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const regionRefused =
        /→\s*422:/.test(msg) &&
        /tax_address_region_id/i.test(msg) &&
        /not allowed|not permitted|must be blank|cannot be set/i.test(msg);
      if (!regionRefused || firstRegion === null) throw err;
      console.log(
        `[sage] invoice ${invoiceId}: Sage refused tax_address_region_id=${firstRegion}; retrying without`,
      );
      result = await postInvoice(null);
    }

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
    const message =
      err instanceof Error ? err.message : "Unknown error pushing to Sage.";
    // A 4xx means Sage read the request and refused it — the same payload will
    // be refused again, so don't let the reconciler retry it forever. 5xx,
    // timeouts and token trouble are worth another go. sageFetch formats the
    // message as "Sage API POST /path → <status>: <body>".
    return fail(message, /→\s*4\d\d:/.test(message));
  }
}

// ---------------------------------------------------------------------------
// Payment sync
// ---------------------------------------------------------------------------
//
// A Sollos payment becomes a Sage "contact payment" of type CUSTOMER_RECEIPT,
// paid into a bank account, allocated to the sales invoice we already pushed.
// Without this every paid invoice sat open in Sage and the receipt was keyed
// by hand — the half of "the books" the integration never did until
// 2026-09-04.
//
// Idempotent on invoice_payments.sage_payment_id. Needs the invoice in Sage
// first; if it isn't, this pushes it (same idempotent path), so a payment on
// a never-synced invoice does the whole job in one call.

type SageBankAccount = {
  id: string;
  displayed_as?: string | null;
  bank_account_type?: { id?: string | null; displayed_as?: string | null } | null;
  currency?: { id?: string | null } | null;
};

/**
 * Which Sage bank account receipts land in. Cached in connection metadata as
 * `bank_account_id`; first run picks the first current/checking account, else
 * the first account of any kind. The owner can move money between accounts
 * in Sage; what matters here is that the receipt exists and is allocated.
 */
async function getSageBankAccountId(
  conn: SageConnection,
): Promise<string | null> {
  const cached = (conn.metadata ?? {})["bank_account_id"];
  if (typeof cached === "string" && cached) return cached;

  const resp = await sageFetch<{ $items?: SageBankAccount[] }>(
    conn.organization_id,
    "/bank_accounts?items_per_page=100&attributes=all",
  );
  const items = resp.$items ?? [];
  const isCurrent = (a: SageBankAccount) =>
    /current|checking|chequing/i.test(a.bank_account_type?.id ?? "") ||
    /current|checking|chequing/i.test(a.bank_account_type?.displayed_as ?? "");
  const chosen = items.find(isCurrent) ?? items[0] ?? null;
  if (chosen?.id) {
    await mergeConnectionMetadata(conn.id, { bank_account_id: chosen.id });
    return chosen.id;
  }
  return null;
}

/**
 * The payment-method ids this Sage business actually has. They differ by
 * region (the Canadian test business has CASH, CHECK, ELECTRONIC,
 * CREDIT_DEBIT, ONLINE_PAYMENT — no BANK_TRANSFER, no CHEQUE), and Sage
 * answers a wrong one with "is invalid for business. (payment_type_id)".
 * Read once, cached on the connection.
 */
async function getSagePaymentMethodIds(conn: SageConnection): Promise<string[]> {
  const cached = (conn.metadata ?? {})["payment_method_ids"];
  if (Array.isArray(cached) && cached.every((x) => typeof x === "string")) {
    return cached as string[];
  }
  try {
    const resp = await sageFetch<{ $items?: Array<{ id: string }> }>(
      conn.organization_id,
      "/payment_methods",
    );
    const ids = (resp.$items ?? []).map((m) => m.id).filter(Boolean);
    await mergeConnectionMetadata(conn.id, { payment_method_ids: ids });
    return ids;
  } catch (err) {
    console.error("[sage] payment_methods lookup failed:", err);
    return [];
  }
}

/**
 * Sollos payment method → the first matching id the business offers.
 * Nothing matching → omitted; the receipt still books without it.
 */
function sagePaymentMethodId(method: string, available: string[]): string | null {
  const candidates: Record<string, string[]> = {
    card: ["CREDIT_DEBIT"],
    cash: ["CASH"],
    check: ["CHECK", "CHEQUE"],
    bank_transfer: ["ELECTRONIC", "BANK_TRANSFER"],
    ach: ["ELECTRONIC", "BANK_TRANSFER"],
    zelle: ["ELECTRONIC", "BANK_TRANSFER"],
    venmo: ["ELECTRONIC", "BANK_TRANSFER"],
    cashapp: ["ELECTRONIC", "BANK_TRANSFER"],
  };
  for (const id of candidates[method] ?? []) {
    if (available.includes(id)) return id;
  }
  return null;
}

type SageContactPayment = { id: string; displayed_as?: string };

export async function pushInvoicePaymentToSage(
  paymentId: string,
): Promise<{ id: string | null; error?: string; permanent?: boolean }> {
  const admin = createSupabaseAdminClient();

  const { data: payment } = (await admin
    .from("invoice_payments" as never)
    .select(
      "id, organization_id, invoice_id, amount_cents, method, reference, received_at, sage_payment_id, invoice:invoices ( id, number, sage_invoice_id, client_id, voided_at )",
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
      sage_payment_id: string | null;
      invoice: {
        id: string;
        number: string | null;
        sage_invoice_id: string | null;
        client_id: string | null;
        voided_at: string | null;
      } | null;
    } | null;
  };
  if (!payment) return { id: null, error: "Payment not found.", permanent: true };
  if (payment.sage_payment_id) return { id: payment.sage_payment_id };
  if (!payment.invoice) {
    return { id: null, error: "Payment has no invoice.", permanent: true };
  }
  if (payment.invoice.voided_at) {
    return {
      id: null,
      error:
        "The invoice is void; a receipt against it would not reconcile. Refund or re-issue instead.",
      permanent: true,
    };
  }

  const orgId = payment.organization_id;
  const fail = async (error: string, permanent = false) => {
    console.error(`[sage] payment ${paymentId}: ${error}`);
    await recordSageError(orgId, error);
    return { id: null, error, permanent };
  };

  const conn = await getSageConnection(orgId);
  if (!conn) {
    return fail(
      "Sage isn't connected. Reconnect it in Settings → Integrations, then try again.",
    );
  }

  // The invoice must exist in Sage to allocate against. Push it if needed —
  // idempotent, and its failure reasons are already worded for people.
  let sageInvoiceId = payment.invoice.sage_invoice_id;
  if (!sageInvoiceId) {
    const inv = await pushInvoiceToSage(payment.invoice.id);
    if (!inv.id) {
      return fail(
        `The invoice isn't in Sage yet, and pushing it failed: ${inv.error ?? "unknown error"}`,
        inv.permanent ?? false,
      );
    }
    sageInvoiceId = inv.id;
  }

  const { data: client } = (await admin
    .from("clients")
    .select("sage_contact_id")
    .eq("id", payment.invoice.client_id ?? "")
    .maybeSingle()) as unknown as {
    data: { sage_contact_id: string | null } | null;
  };
  const contactId = client?.sage_contact_id;
  if (!contactId) {
    return fail(
      "The client has no Sage contact yet; sync the invoice first.",
      false,
    );
  }

  try {
    const bankAccountId = await getSageBankAccountId(conn);
    if (!bankAccountId) {
      return fail(
        "Sage has no bank account to receive payments into. Create one in Sage (Banking → New account), then sync again.",
        true,
      );
    }

    const { getOrgTimezone } = await import("@/lib/org-timezone");
    const { zonedYmd } = await import("@/lib/wall-clock");
    const orgTz = await getOrgTimezone(orgId);
    const date = zonedYmd(new Date(payment.received_at), orgTz);
    const amount = payment.amount_cents / 100;
    const methodId = sagePaymentMethodId(
      payment.method,
      await getSagePaymentMethodIds(conn),
    );

    // Sage refuses to allocate more than the invoice still owes ("You
    // cannot overpay invoices"). A client who rounds up, or a test payment
    // keyed for more than the bill, is real money all the same: allocate
    // what the invoice can take and leave the rest on the customer's
    // account in Sage, which is exactly what a bookkeeper would do.
    const sageInvoice = await sageFetch<{ outstanding_amount?: number | string }>(
      orgId,
      `/sales_invoices/${sageInvoiceId}`,
    );
    const outstanding = Number(sageInvoice.outstanding_amount ?? 0);
    if (!(outstanding > 0)) {
      return fail(
        `Sage already shows ${payment.invoice.number ?? "this invoice"} as paid — the receipt was recorded there by hand. Nothing pushed, nothing to fix.`,
        true,
      );
    }
    const allocate = Math.min(amount, outstanding);
    const onAccount = Math.round((amount - allocate) * 100) / 100;
    const reference =
      (payment.reference ?? payment.invoice.number ?? "").slice(0, 50) ||
      undefined;

    const post = (withMethod: boolean) =>
      sageFetch<SageContactPayment>(orgId, "/contact_payments", {
        method: "POST",
        body: JSON.stringify({
          contact_payment: {
            transaction_type_id: "CUSTOMER_RECEIPT",
            contact_id: contactId,
            bank_account_id: bankAccountId,
            date,
            total_amount: amount,
            reference,
            ...(withMethod && methodId ? { payment_method_id: methodId } : {}),
            allocated_artefacts: [{ artefact_id: sageInvoiceId, amount: allocate }],
          },
        }),
      });

    let result: SageContactPayment;
    try {
      result = await post(true);
    } catch (err) {
      // payment_method_id is decoration; if Sage's list doesn't carry the
      // one we guessed, the receipt still belongs in the books.
      const msg = err instanceof Error ? err.message : "";
      if (
        methodId &&
        /→\s*422:/.test(msg) &&
        /payment_method|payment_type/i.test(msg)
      ) {
        console.log(
          `[sage] payment ${paymentId}: method ${methodId} refused; retrying without`,
        );
        result = await post(false);
      } else {
        throw err;
      }
    }

    await admin
      .from("invoice_payments" as never)
      .update({ sage_payment_id: result.id } as never)
      .eq("id" as never, paymentId as never);
    await recordSageError(orgId, null);
    console.log(
      `[sage] pushInvoicePaymentToSage: payment ${paymentId} (${payment.invoice.number}, ${amount}${onAccount > 0 ? `, ${onAccount} left on account` : ""}) → sage ${result.id}`,
    );
    return { id: result.id };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Unknown error pushing payment to Sage.";
    return fail(describeSageError(message), /→\s*4\d\d:/.test(message));
  }
}

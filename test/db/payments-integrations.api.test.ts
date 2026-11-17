/**
 * Settings → Integrations and Billing: connecting a payment processor and
 * paying for Sollos itself, pressed the way the browser presses them against
 * a real database behind the real PostgREST.
 *
 *   Connect Square      connect → Square's consent → callback; disconnect
 *   Connect Stripe      connect → Stripe's consent → callback; disconnect
 *   Billing             subscribe (Stripe Checkout) and manage (billing portal)
 *
 * Stand-ins: the Stripe SDK (a fake that records what it was asked) and
 * Square's REST API (a fetch stand-in for its host only). Nothing reaches a
 * real processor.
 *
 * What each owes: the OAuth state is single-use and bound to the company and
 * the person who started it, so a forged, expired, replayed or someone else's
 * state can never connect a payment account to the wrong company; only an
 * owner or admin can connect, disconnect or buy; a disconnect wipes the
 * stored tokens; a subscription is bought for the caller's own company,
 * whatever the request body says.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { hasPostgrest, startApi, type Api } from "./api";
import { addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

// ── Stand-ins ────────────────────────────────────────────────────────────────

type Call = { method: string; params: Record<string, unknown>; opts?: Record<string, unknown> };
const stripeFake = vi.hoisted(() => ({ calls: [] as Call[], seq: 0 }));
vi.mock("stripe", () => {
  const rec = (method: string, params: Record<string, unknown>, opts?: Record<string, unknown>) =>
    stripeFake.calls.push({ method, params, opts });
  class FakeStripe {
    oauth = {
      token: async (params: Record<string, unknown>) => {
        rec("oauth.token", params);
        return { stripe_user_id: `acct_from_${String(params.code)}`, access_token: "sk_discarded" };
      },
      deauthorize: async (params: Record<string, unknown>) => {
        rec("oauth.deauthorize", params);
        return { stripe_user_id: params.stripe_user_id };
      },
    };
    accounts = {
      retrieve: async (id: string) => {
        rec("accounts.retrieve", { id });
        return { id, type: "standard", charges_enabled: true, payouts_enabled: true, details_submitted: true };
      },
    };
    customers = {
      create: async (params: Record<string, unknown>, opts?: Record<string, unknown>) => {
        rec("customers.create", params, opts);
        return { id: `cus_test_${++stripeFake.seq}` };
      },
    };
    checkout = {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          rec("checkout.sessions.create", params);
          const id = `cs_test_${++stripeFake.seq}`;
          return { id, url: `https://checkout.stripe.test/c/pay/${id}` };
        },
      },
    };
    billingPortal = {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          rec("billingPortal.sessions.create", params);
          return { id: `bps_${++stripeFake.seq}`, url: `https://billing.stripe.test/p/session/${stripeFake.seq}` };
        },
      },
    };
  }
  return { default: FakeStripe };
});

type SquareCall = { path: string; method: string; body: Record<string, unknown>; auth: string | null };
const squareFake = vi.hoisted(() => ({ calls: [] as SquareCall[] }));

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));

// Test values only; none of these is a real secret.
const SITE = "http://localhost:3000";
const SETTINGS = `${SITE}/app/settings/integrations`;
process.env.NEXT_PUBLIC_SITE_URL = SITE;
process.env.STRIPE_ENABLED = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_sollos_integrations_not_real";
process.env.STRIPE_CONNECT_CLIENT_ID = "ca_test_sollos_integrations";
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_test_sollos_integrations";
process.env.STRIPE_PRICE_STARTER = "price_test_starter";
process.env.STRIPE_PRICE_TEAM = "price_test_team";
process.env.STRIPE_PRICE_GROWTH = "price_test_growth";
process.env.INTEGRATION_ENCRYPTION_KEY = `base64:${randomBytes(32).toString("base64")}`;
process.env.SQUARE_APPLICATION_ID = "sandbox-sq0idb-sollos-integrations";
process.env.SQUARE_APPLICATION_SECRET = "sandbox-sq0csb-sollos-integrations";
process.env.SQUARE_ENVIRONMENT = "sandbox";

const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const m = /^https:\/\/connect\.squareup(?:sandbox)?\.com(\/[^?]*)/.exec(url);
  if (!m) return realFetch(input, init);
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  squareFake.calls.push({ path: m[1], method: init?.method ?? "GET", body, auth: new Headers(init?.headers).get("authorization") });
  const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  switch (m[1]) {
    case "/oauth2/token":
      if (body.code === "refused-code") return json(401, { errors: [{ code: "UNAUTHORIZED", detail: "Authorization code is invalid" }] });
      return json(200, {
        access_token: `sq-at-${String(body.code)}`,
        refresh_token: `sq-rt-${String(body.code)}`,
        token_type: "bearer",
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        merchant_id: `MERCHANT-${String(body.code)}`,
        short_lived: false,
      });
    case "/v2/merchants/me":
      return json(200, { merchant: { id: "MERCHANT", business_name: "Svit Cleaning" } });
    case "/v2/locations":
      return json(200, { locations: [{ id: "LOC_CLOSED", status: "INACTIVE" }, { id: "LOC_MAIN", status: "ACTIVE", type: "PHYSICAL" }] });
    case "/oauth2/revoke":
      return json(200, { success: true });
    default:
      return json(404, { errors: [{ code: "NOT_FOUND", detail: `stand-in has no ${m[1]}` }] });
  }
});

const squareConnect = await import("@/app/api/integrations/square/connect/route");
const squareCallback = await import("@/app/api/integrations/square/callback/route");
const squareDisconnect = await import("@/app/api/integrations/square/disconnect/route");
const stripeConnect = await import("@/app/api/integrations/stripe/connect/route");
const stripeCallback = await import("@/app/api/integrations/stripe/callback/route");
const stripeDisconnect = await import("@/app/api/integrations/stripe/disconnect/route");
const billingCheckout = await import("@/app/api/stripe/checkout/route");
const billingPortal = await import("@/app/api/stripe/portal/route");
const { decryptSecret } = await import("@/lib/crypto");
const { remainingTrialDays } = await import("@/lib/trial");

let api: Api;
let restoreEnv: () => void;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  stripeFake.calls.length = 0;
  squareFake.calls.length = 0;
});

const emailOf = new Map<string, string>();

/** Signed in as this member; a redirect thrown by the auth guard is an answer too. */
async function as<T>(m: Member, run: () => Promise<T>): Promise<T | { redirected: string }> {
  request.cookies = api.sessionCookies(m.userId, emailOf.get(m.userId));
  try {
    return await run();
  } catch (err) {
    const r = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
    if (r) return { redirected: r[1] };
    throw err;
  } finally {
    await settle();
  }
}

async function company(name = "Connect Co") {
  const org = await addOrg(api.sql, name);
  const mk = async (role: "owner" | "admin" | "manager", who: string) => {
    const m = await addMember(api.sql, org, role, who);
    const [u] = await api.sql<{ email: string }>("select email from auth.users where id = $1", [m.userId]);
    emailOf.set(m.userId, u.email);
    return m;
  };
  return { org, owner: await mk("owner", "Svitlana"), admin: await mk("admin", "Admin"), manager: await mk("manager", "Olha") };
}

const location = (res: unknown) => {
  expect(res, "expected a Response, not a thrown redirect").toBeInstanceOf(Response);
  return (res as Response).headers.get("location") ?? "";
};
const get = (path: string) => new NextRequest(`${SITE}${path}`);

const squareRows = (org: string) =>
  api.sql<{
    status: string;
    external_account_id: string;
    access_token_ciphertext: string | null;
    refresh_token_ciphertext: string | null;
    metadata: Record<string, unknown>;
    connected_by: string | null;
  }>(
    "select status::text as status, external_account_id, access_token_ciphertext, refresh_token_ciphertext, metadata, connected_by from public.integration_connections where organization_id = $1 and provider = 'square' order by connected_at",
    [org],
  );
const stateCount = async (table: "square_oauth_states" | "stripe_oauth_states", org: string) =>
  (await api.sql<{ n: number }>(`select count(*)::int as n from public.${table} where organization_id = $1`, [org]))[0].n;
const orgStripe = async (org: string) =>
  (
    await api.sql<{ stripe_account_id: string | null; stripe_charges_enabled: boolean; stripe_disconnected_at: string | null }>(
      "select stripe_account_id, stripe_charges_enabled, stripe_disconnected_at from public.organizations where id = $1",
      [org],
    )
  )[0];

/** Press Connect Square and return the state Sollos handed Square. */
async function startSquare(m: Member): Promise<string> {
  const to = location(await as(m, () => squareConnect.GET(get("/api/integrations/square/connect"))));
  const state = new URL(to).searchParams.get("state");
  expect(state).toBeTruthy();
  return state!;
}
async function startStripe(m: Member): Promise<string> {
  const to = location(await as(m, () => stripeConnect.GET()));
  const state = new URL(to).searchParams.get("state");
  expect(state).toBeTruthy();
  return state!;
}
const squareBack = (m: Member, q: Record<string, string>) =>
  as(m, () => squareCallback.GET(get(`/api/integrations/square/callback?${new URLSearchParams(q)}`)));
const stripeBack = (m: Member, q: Record<string, string>) =>
  as(m, () => stripeCallback.GET(get(`/api/integrations/stripe/callback?${new URLSearchParams(q)}`)));

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("Connect Square", { timeout: 120_000 }, () => {
  it("an owner is sent to Square's consent page with a one-time state tied to her company and to her", async () => {
    const c = await company();
    const to = location(await as(c.owner, () => squareConnect.GET(get("/api/integrations/square/connect"))));
    const url = new URL(to);
    expect(`${url.origin}${url.pathname}`).toBe("https://connect.squareupsandbox.com/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe(process.env.SQUARE_APPLICATION_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(`${SITE}/api/integrations/square/callback`);
    const [row] = await api.sql<{ organization_id: string; membership_id: string; ttl: number }>(
      "select organization_id, membership_id, round(extract(epoch from expires_at - now()) / 60)::int as ttl from public.square_oauth_states where state = $1",
      [url.searchParams.get("state")],
    );
    expect(row).toEqual({ organization_id: c.org, membership_id: c.owner.membershipId, ttl: 10 });

    expect(await as(c.manager, () => squareConnect.GET(get("/api/integrations/square/connect")))).toEqual({ redirected: "/app" });
    expect(await stateCount("square_oauth_states", c.org), "a manager mints no state").toBe(1);
  });

  it("Square's answer with her own state connects her company once, encrypted, at its active location; the state can't be used again", async () => {
    const c = await company();
    const state = await startSquare(c.owner);
    expect(location(await squareBack(c.owner, { code: "good-code-1", state }))).toBe(`${SETTINGS}?square_connected=1`);

    const exchange = squareFake.calls.find((k) => k.path === "/oauth2/token");
    expect(exchange?.body).toMatchObject({ code: "good-code-1", grant_type: "authorization_code", redirect_uri: `${SITE}/api/integrations/square/callback` });
    const rows = await squareRows(c.org);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", external_account_id: "MERCHANT-good-code-1", metadata: { location_id: "LOC_MAIN" }, connected_by: c.owner.membershipId });
    expect(rows[0].access_token_ciphertext).not.toContain("sq-at-good-code-1");
    expect(decryptSecret(rows[0].access_token_ciphertext)).toBe("sq-at-good-code-1");
    expect(decryptSecret(rows[0].refresh_token_ciphertext)).toBe("sq-rt-good-code-1");
    expect(await stateCount("square_oauth_states", c.org), "the state is spent").toBe(0);

    squareFake.calls.length = 0;
    expect(location(await squareBack(c.owner, { code: "good-code-2", state }))).toBe(`${SETTINGS}?square_error=invalid_state`);
    expect(squareFake.calls, "a replay never reaches Square").toEqual([]);
    expect((await squareRows(c.org)).filter((r) => r.status === "active")).toHaveLength(1);
  });

  it("a forged, expired, or someone else's state connects nothing to anyone", async () => {
    const victim = await company("Victim Co");
    const attacker = await company("Attacker Co");
    const attackerState = await startSquare(attacker.owner);
    const colleagueState = await startSquare(victim.admin);
    const [{ state: expired }] = await api.sql<{ state: string }>(
      "insert into public.square_oauth_states (state, organization_id, membership_id, expires_at) values ($1, $2, $3, now() - interval '1 minute') returning state",
      [`expired-${randomBytes(8).toString("hex")}`, victim.org, victim.owner.membershipId],
    );

    // The attacker's own consent finished in the victim's browser.
    expect(location(await squareBack(victim.owner, { code: "attacker-code", state: attackerState }))).toBe(`${SETTINGS}?square_error=session_mismatch`);
    // A colleague's state, in the owner's browser.
    expect(location(await squareBack(victim.owner, { code: "colleague-code", state: colleagueState }))).toBe(`${SETTINGS}?square_error=session_mismatch`);
    expect(location(await squareBack(victim.owner, { code: "forged-code", state: "forged-state-value" }))).toBe(`${SETTINGS}?square_error=invalid_state`);
    expect(location(await squareBack(victim.owner, { code: "late-code", state: expired }))).toBe(`${SETTINGS}?square_error=invalid_state`);
    expect(location(await squareBack(victim.owner, { code: "x" }))).toBe(`${SETTINGS}?square_error=missing_code_or_state`);

    expect(squareFake.calls, "no code was ever exchanged").toEqual([]);
    expect(await squareRows(victim.org)).toEqual([]);
    expect(await squareRows(attacker.org)).toEqual([]);
  });

  it("a manager can't finish one, a denied consent says so, and a refused code connects nothing", async () => {
    const c = await company();
    const state = await startSquare(c.owner);
    expect(await squareBack(c.manager, { code: "good-code", state })).toEqual({ redirected: "/app" });
    expect(await stateCount("square_oauth_states", c.org), "her state survives a manager's attempt").toBe(1);
    expect(location(await squareBack(c.owner, { error: "access_denied", state }))).toBe(`${SETTINGS}?square_error=access_denied`);
    const refused = location(await squareBack(c.owner, { code: "refused-code", state }));
    expect(decodeURIComponent(refused)).toContain("square_error=Square token exchange failed: Authorization code is invalid");
    expect(await squareRows(c.org)).toEqual([]);
  });

  it("reconnecting replaces the active connection; disconnect revokes at Square and wipes the tokens, for her company only", async () => {
    const c = await company();
    const other = await company("Other Square Co");
    await squareBack(c.owner, { code: "first", state: await startSquare(c.owner) });
    await squareBack(c.owner, { code: "second", state: await startSquare(c.owner) });
    await squareBack(other.owner, { code: "theirs", state: await startSquare(other.owner) });
    expect((await squareRows(c.org)).map((r) => [r.status, r.external_account_id])).toEqual([
      ["disconnected", "MERCHANT-first"],
      ["active", "MERCHANT-second"],
    ]);

    const post = () => squareDisconnect.POST(new NextRequest(`${SITE}/api/integrations/square/disconnect`, { method: "POST" }));
    expect(await as(c.manager, post)).toEqual({ redirected: "/app" });
    expect((await squareRows(c.org)).filter((r) => r.status === "active")).toHaveLength(1);

    squareFake.calls.length = 0;
    const res = (await as(c.owner, post)) as Response;
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${SETTINGS}?square_disconnected=1`);
    const revoke = squareFake.calls.filter((k) => k.path === "/oauth2/revoke");
    expect(revoke).toHaveLength(1);
    expect(revoke[0].body).toMatchObject({ access_token: "sq-at-second", merchant_id: "MERCHANT-second" });
    for (const row of await squareRows(c.org)) {
      expect(row.status).toBe("disconnected");
      expect(row.access_token_ciphertext).toBeNull();
      expect(row.refresh_token_ciphertext).toBeNull();
    }
    const [theirs] = await squareRows(other.org);
    expect(theirs.status, "another company's Square is untouched").toBe("active");
    expect(decryptSecret(theirs.access_token_ciphertext)).toBe("sq-at-theirs");
  });
});

describe.skipIf(!hasPostgrest)("Connect Stripe", { timeout: 120_000 }, () => {
  it("an owner is sent to Stripe's consent page with a one-time state tied to her company and to her; a manager isn't", async () => {
    const c = await company();
    const to = new URL(location(await as(c.owner, () => stripeConnect.GET())));
    expect(`${to.origin}${to.pathname}`).toBe("https://connect.stripe.com/oauth/authorize");
    expect(to.searchParams.get("client_id")).toBe("ca_test_sollos_integrations");
    expect(to.searchParams.get("redirect_uri")).toBe(`${SITE}/api/integrations/stripe/callback`);
    const [row] = await api.sql<{ organization_id: string; membership_id: string }>(
      "select organization_id, membership_id from public.stripe_oauth_states where state = $1",
      [to.searchParams.get("state")],
    );
    expect(row).toEqual({ organization_id: c.org, membership_id: c.owner.membershipId });
    expect(await as(c.manager, () => stripeConnect.GET())).toEqual({ redirected: "/app" });
    expect(await stateCount("stripe_oauth_states", c.org)).toBe(1);
  });

  it("Stripe's answer with her own state connects her company's account, once", async () => {
    const c = await company();
    const state = await startStripe(c.admin);
    expect(location(await stripeBack(c.admin, { code: "ac_good", state }))).toBe(`${SETTINGS}?stripe=connected`);
    expect(stripeFake.calls.map((k) => k.method)).toEqual(["oauth.token", "accounts.retrieve"]);
    expect(await orgStripe(c.org)).toMatchObject({ stripe_account_id: "acct_from_ac_good", stripe_charges_enabled: true, stripe_disconnected_at: null });

    stripeFake.calls.length = 0;
    expect(location(await stripeBack(c.admin, { code: "ac_again", state }))).toBe(`${SETTINGS}?stripe=bad_state`);
    expect(stripeFake.calls).toEqual([]);
    expect((await orgStripe(c.org)).stripe_account_id).toBe("acct_from_ac_good");
  });

  it("a forged, expired, or someone else's state connects no account to anyone", async () => {
    const victim = await company("Stripe Victim Co");
    const attacker = await company("Stripe Attacker Co");
    const attackerState = await startStripe(attacker.owner);
    const colleagueState = await startStripe(victim.admin);
    const [{ state: expired }] = await api.sql<{ state: string }>(
      "insert into public.stripe_oauth_states (state, organization_id, membership_id, expires_at) values ($1, $2, $3, now() - interval '1 minute') returning state",
      [`expired-${randomBytes(8).toString("hex")}`, victim.org, victim.owner.membershipId],
    );

    expect(location(await stripeBack(victim.owner, { code: "ac_attacker", state: attackerState }))).toBe(`${SETTINGS}?stripe=identity_mismatch`);
    expect(location(await stripeBack(victim.owner, { code: "ac_colleague", state: colleagueState }))).toBe(`${SETTINGS}?stripe=identity_mismatch`);
    expect(location(await stripeBack(victim.owner, { code: "ac_forged", state: "forged-state-value" }))).toBe(`${SETTINGS}?stripe=bad_state`);
    expect(location(await stripeBack(victim.owner, { code: "ac_late", state: expired }))).toBe(`${SETTINGS}?stripe=bad_state`);
    expect(location(await stripeBack(victim.owner, { state: "anything" }))).toBe(`${SETTINGS}?stripe=missing_params`);
    expect(location(await stripeBack(victim.owner, { error: "access_denied" }))).toBe(`${SETTINGS}?stripe=denied`);

    expect(stripeFake.calls, "no code was ever exchanged").toEqual([]);
    expect((await orgStripe(victim.org)).stripe_account_id).toBeNull();
    expect((await orgStripe(attacker.org)).stripe_account_id).toBeNull();
    expect(await stripeBack(victim.manager, { code: "ac_m", state: colleagueState })).toEqual({ redirected: "/app" });
  });

  it("with Stripe switched off, nothing connects, disconnects or bills, and no state is minted", async () => {
    const c = await company("Switched Off Co");
    const state = await startStripe(c.owner);
    const saved = { connect: process.env.STRIPE_CONNECT_CLIENT_ID, enabled: process.env.STRIPE_ENABLED };
    delete process.env.STRIPE_CONNECT_CLIENT_ID;
    try {
      expect(((await as(c.owner, () => stripeConnect.GET())) as Response).status).toBe(503);
      expect(((await as(c.owner, () => stripeDisconnect.POST())) as Response).status).toBe(503);
      expect(location(await stripeBack(c.owner, { code: "ac_off", state }))).toBe(`${SETTINGS}?stripe=disabled`);
      process.env.STRIPE_ENABLED = "false";
      expect(((await as(c.owner, () => billingPortal.POST())) as Response).status).toBe(503);
      const buy = () => billingCheckout.POST(new NextRequest(`${SITE}/api/stripe/checkout`, { method: "POST", body: JSON.stringify({ plan: "team" }) }));
      expect(((await as(c.owner, buy)) as Response).status).toBe(503);
    } finally {
      process.env.STRIPE_CONNECT_CLIENT_ID = saved.connect;
      process.env.STRIPE_ENABLED = saved.enabled;
    }
    expect(stripeFake.calls).toEqual([]);
    expect(await stateCount("stripe_oauth_states", c.org), "only the one minted while it was on").toBe(1);
    expect((await orgStripe(c.org)).stripe_account_id).toBeNull();
  });

  it("disconnect lets go at Stripe and clears her company's account, and only hers; a manager can't", async () => {
    const c = await company();
    const other = await company("Other Stripe Co");
    await stripeBack(c.owner, { code: "ac_mine", state: await startStripe(c.owner) });
    await stripeBack(other.owner, { code: "ac_theirs", state: await startStripe(other.owner) });
    const post = () => stripeDisconnect.POST();

    expect(await as(c.manager, post)).toEqual({ redirected: "/app" });
    expect((await orgStripe(c.org)).stripe_account_id).toBe("acct_from_ac_mine");

    stripeFake.calls.length = 0;
    const res = (await as(c.owner, post)) as Response;
    expect(await res.json()).toEqual({ disconnected: true });
    expect(stripeFake.calls).toEqual([
      { method: "oauth.deauthorize", params: { client_id: "ca_test_sollos_integrations", stripe_user_id: "acct_from_ac_mine" }, opts: undefined },
    ]);
    const mine = await orgStripe(c.org);
    expect(mine).toMatchObject({ stripe_account_id: null, stripe_charges_enabled: false });
    expect(mine.stripe_disconnected_at).not.toBeNull();
    expect((await orgStripe(other.org)).stripe_account_id).toBe("acct_from_ac_theirs");
  });
});

describe.skipIf(!hasPostgrest)("Billing: subscribe and manage", { timeout: 120_000 }, () => {
  const subscribe = (body: string) =>
    billingCheckout.POST(new NextRequest(`${SITE}/api/stripe/checkout`, { method: "POST", body, headers: { "content-type": "application/json" } }));

  it("an owner buys a plan for her own company, with only the trial days she has left, whatever the body says", async () => {
    const c = await company("Buyer Co");
    const other = await company("Bystander Co");
    const started = new Date(Date.now() - 5 * 86_400_000).toISOString();
    await api.sql("update public.organizations set trial_started_at = $2::timestamptz where id = $1", [c.org, started]);

    const res = (await as(c.owner, () => subscribe(JSON.stringify({ plan: "team", organization_id: other.org, price: "price_free" })))) as Response;
    expect(res.status, api.log()).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const customer = stripeFake.calls.find((k) => k.method === "customers.create")!;
    expect(customer.params).toEqual({ email: emailOf.get(c.owner.userId), name: undefined, metadata: { organization_id: c.org } });
    expect(customer.opts).toEqual({ idempotencyKey: `org_customer_create_${c.org}` });
    const session = stripeFake.calls.find((k) => k.method === "checkout.sessions.create")!;
    expect(session.params).toMatchObject({
      mode: "subscription",
      line_items: [{ price: "price_test_team", quantity: 1 }],
      metadata: { organization_id: c.org },
      subscription_data: { trial_period_days: remainingTrialDays(started, Date.now()), metadata: { organization_id: c.org } },
      success_url: `${SITE}/app/settings/billing?checkout=success`,
    });
    const [sub] = await api.sql<{ stripe_customer_id: string }>("select stripe_customer_id from public.subscriptions where organization_id = $1", [c.org]);
    expect(sub.stripe_customer_id).toMatch(/^cus_test_/);
    expect(await api.sql("select 1 from public.subscriptions where organization_id = $1", [other.org])).toHaveLength(0);

    // The next press reuses the customer; a spent trial buys with no free days.
    stripeFake.calls.length = 0;
    await api.sql("update public.organizations set trial_started_at = now() - interval '30 days' where id = $1", [c.org]);
    await as(c.admin, () => subscribe(JSON.stringify({ plan: "starter" })));
    expect(stripeFake.calls.map((k) => k.method)).toEqual(["checkout.sessions.create"]);
    expect((stripeFake.calls[0].params.subscription_data as Record<string, unknown>).trial_period_days).toBeUndefined();
  });

  it("refuses a plan that isn't for sale, a body that isn't JSON, a manager, and a suspended, flagged or deleted company", async () => {
    const c = await company("Picky Co");
    for (const body of [JSON.stringify({ plan: "enterprise" }), JSON.stringify({ plan: "free" }), "not json"]) {
      expect(((await as(c.owner, () => subscribe(body))) as Response).status, body).toBe(400);
    }
    expect(await as(c.manager, () => subscribe(JSON.stringify({ plan: "team" })))).toEqual({ redirected: "/app" });
    const outcomes: string[] = [];
    for (const col of ["suspended_at", "abuse_flagged_at", "deleted_at"]) {
      const banned = await company(`Banned ${col}`);
      await api.sql(`update public.organizations set ${col} = now() where id = $1`, [banned.org]);
      const res = await as(banned.owner, () => subscribe(JSON.stringify({ plan: "team" })));
      // The sign-in guard may already send her away; either way no card goes through.
      outcomes.push(`${col}: ${res instanceof Response ? res.status : (res as { redirected: string }).redirected}`);
    }
    expect(outcomes).toEqual(["suspended_at: /suspended", "abuse_flagged_at: 403", "deleted_at: 403"]);
    expect(stripeFake.calls).toEqual([]);
  });

  it("the billing portal opens on her company's own Stripe customer; with none yet it says so; a manager can't", async () => {
    const c = await company("Portal Co");
    const other = await company("Other Portal Co");
    await api.sql("insert into public.subscriptions (organization_id, stripe_customer_id, status) values ($1, 'cus_mine_portal', 'active'), ($2, 'cus_theirs_portal', 'active')", [c.org, other.org]);
    const fresh = await company("Fresh Co");

    const res = (await as(c.owner, () => billingPortal.POST())) as Response;
    expect(res.status).toBe(200);
    expect((await res.json()) as { url: string }).toEqual({ url: expect.stringMatching(/^https:\/\/billing\.stripe\.test\//) });
    expect(stripeFake.calls).toEqual([
      { method: "billingPortal.sessions.create", params: { customer: "cus_mine_portal", return_url: `${SITE}/app/settings/billing` }, opts: undefined },
    ]);
    expect(((await as(fresh.owner, () => billingPortal.POST())) as Response).status).toBe(400);
    expect(await as(c.manager, () => billingPortal.POST())).toEqual({ redirected: "/app" });
    expect(stripeFake.calls).toHaveLength(1);
  });
});

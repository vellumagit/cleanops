/**
 * The doors a client uses without signing in, and the office's "payment
 * link" button, pressed the way the browser presses them against a real
 * database behind the real PostgREST.
 *
 *   Pay by card on /i/<token>     Stripe Checkout or a Square payment link
 *   the office's payment link     api/invoices/<id>/stripe-checkout
 *   Download PDF                  api/i/<token>/pdf and api/e/<token>/pdf
 *   Resend's webhook              bounces and complaints onto the do-not-email list
 *
 * Stand-ins: the Stripe SDK (a fake that records what it was asked), Square's
 * REST API (a fetch stand-in for its host only), both PDF renderers, and the
 * rate-limit buckets (real limits, fresh buckets per test).
 *
 * What each owes: the amount charged is what is still owed on the invoice,
 * never a number from the request; a paid, void or refunded invoice can't be
 * paid again; a token opens only its own invoice or estimate and a wrong or
 * short one opens nothing; an unsigned webhook writes nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

// ── Stand-ins ────────────────────────────────────────────────────────────────

type Call = { method: string; params: Record<string, unknown>; opts?: Record<string, unknown> };
const stripeFake = vi.hoisted(() => ({ calls: [] as Call[], seq: 0 }));
vi.mock("stripe", () => {
  class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: Record<string, unknown>, opts?: Record<string, unknown>) => {
          stripeFake.calls.push({ method: "checkout.sessions.create", params, opts });
          const id = `cs_test_${++stripeFake.seq}`;
          return { id, url: `https://checkout.stripe.test/c/pay/${id}` };
        },
      },
    };
  }
  return { default: FakeStripe };
});

type SquareCall = { path: string; method: string; body: Record<string, unknown>; auth: string | null };
const squareFake = vi.hoisted(() => ({ calls: [] as SquareCall[], seq: 0 }));

const pdfFake = vi.hoisted(() => ({
  invoice: [] as Array<Record<string, unknown>>,
  estimate: [] as Array<{ publicToken: string }>,
  fail: false,
}));
vi.mock("@/lib/invoice-pdf", () => ({
  renderInvoicePdf: async (data: Record<string, unknown>) => {
    pdfFake.invoice.push(data);
    if (pdfFake.fail) throw new Error("stand-in renderer down");
    return Buffer.from("%PDF-1.4\n% stand-in invoice\n");
  },
}));
vi.mock("@/lib/estimate-pdf", () => ({
  renderEstimatePdf: async (args: { publicToken: string }) => {
    pdfFake.estimate.push(args);
    if (pdfFake.fail) throw new Error("stand-in Chromium down");
    return Buffer.from("%PDF-1.4\n% stand-in estimate\n");
  },
}));

const limits = vi.hoisted(() => ({ epoch: 0 }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...real,
    checkRateLimit: (key: string, max?: number, windowMs?: number) => real.checkRateLimit(`${limits.epoch}:${key}`, max, windowMs),
  };
});
vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: async () => true,
  sendOrgEmail: async () => true,
}));

// Test values only; none of these is a real secret.
const SITE = "http://localhost:3000";
process.env.NEXT_PUBLIC_SITE_URL = SITE;
process.env.STRIPE_ENABLED = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_sollos_public_not_real";
process.env.STRIPE_CONNECT_CLIENT_ID = "ca_test_sollos_public_not_real";
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_test_sollos_public_connect";
process.env.INTEGRATION_ENCRYPTION_KEY = `base64:${randomBytes(32).toString("base64")}`;
process.env.SQUARE_APPLICATION_ID = "sandbox-sq0idb-sollos-public";
process.env.SQUARE_APPLICATION_SECRET = "sandbox-sq0csb-sollos-public";
process.env.SQUARE_ENVIRONMENT = "sandbox";
const RESEND_SECRET = `whsec_${randomBytes(24).toString("base64")}`;
process.env.RESEND_WEBHOOK_SECRET = RESEND_SECRET;

const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const m = /^https:\/\/connect\.squareup(?:sandbox)?\.com(\/[^?]*)/.exec(url);
  if (!m) return realFetch(input, init);
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  squareFake.calls.push({ path: m[1], method: init?.method ?? "GET", body, auth: new Headers(init?.headers).get("authorization") });
  const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (m[1] === "/v2/online-checkout/payment-links") {
    const id = `PLINK${++squareFake.seq}`;
    return json(200, { payment_link: { id, url: `https://square.link/u/${id}`, order_id: `ORDER${squareFake.seq}` } });
  }
  if (m[1] === "/oauth2/token" && body.grant_type === "refresh_token") {
    return json(200, {
      access_token: "sq-access-token-fresh",
      refresh_token: "sq-refresh-token-fresh",
      token_type: "bearer",
      expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      merchant_id: "MERCHANT_REFRESHED",
      short_lived: false,
    });
  }
  return json(404, { errors: [{ code: "NOT_FOUND", detail: `stand-in has no ${m[1]}` }] });
});

const pay = await import("@/app/i/[token]/pay-actions");
const { POST: officeCheckout } = await import("@/app/api/invoices/[id]/stripe-checkout/route");
const { GET: invoicePdf } = await import("@/app/api/i/[token]/pdf/route");
const { GET: estimatePdf } = await import("@/app/api/e/[token]/pdf/route");
const { POST: resendWebhook } = await import("@/app/api/webhooks/resend/route");
const { encryptSecret, decryptSecret } = await import("@/lib/crypto");

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
  pdfFake.invoice.length = 0;
  pdfFake.estimate.length = 0;
  pdfFake.fail = false;
  limits.epoch += 1;
});

/** A client pressing Pay on the public page: no session. The redirect is the answer. */
async function press(action: (f: FormData) => Promise<unknown>, fields: Record<string, string>): Promise<string> {
  request.cookies = [];
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  try {
    await action(f);
    return "(no redirect)";
  } catch (err) {
    const r = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
    if (r) return r[1];
    throw err;
  } finally {
    await settle();
  }
}

/** Signed in as this member; a redirect is an answer too. */
async function as<T>(m: Member, run: () => Promise<T>): Promise<T | { redirected: string }> {
  request.cookies = api.sessionCookies(m.userId);
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

let seq = 0;

async function company(name = "Pay Co", opts: { stripeAccount?: string | null; feeBps?: number; tipping?: boolean; currency?: "CAD" | "USD" } = {}) {
  const org = await addOrg(api.sql, name);
  await api.sql(
    `update public.organizations
        set timezone = 'America/Edmonton', stripe_account_id = $2, stripe_charges_enabled = $3,
            stripe_application_fee_bps = $4, tipping_settings = $5::jsonb, currency_code = $6
      where id = $1`,
    [
      org,
      opts.stripeAccount === undefined ? `acct_test_${++seq}` : opts.stripeAccount,
      opts.stripeAccount !== null,
      opts.feeBps ?? 100,
      JSON.stringify({ enabled: Boolean(opts.tipping), presets: [15, 18, 20] }),
      opts.currency ?? "CAD",
    ],
  );
  const [row] = await api.sql<{ name: string; stripe_account_id: string | null }>("select name, stripe_account_id from public.organizations where id = $1", [org]);
  return {
    org,
    name: row.name,
    account: row.stripe_account_id,
    client: await addClient(api.sql, org, "Hilda Daubner"),
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    manager: await addMember(api.sql, org, "manager", "Olha"),
  };
}
type Co = Awaited<ReturnType<typeof company>>;

async function invoice(c: Co, cents = 20000, over: { number?: string } = {}): Promise<{ id: string; token: string }> {
  const [row] = await api.sql<{ id: string; public_token: string }>(
    `insert into public.invoices (organization_id, client_id, status, amount_cents, sent_at, due_date, number)
     values ($1, $2, 'sent', $3, now(), current_date + 14, $4) returning id, public_token`,
    [c.org, c.client, cents, over.number ?? null],
  );
  expect(row.public_token, "the trigger gives every invoice a link token").toMatch(/^[A-Za-z0-9_-]{16,}$/);
  return { id: row.id, token: row.public_token };
}

const cash = (c: Co, inv: string, cents: number) =>
  api.sql("insert into public.invoice_payments (organization_id, invoice_id, amount_cents, method) values ($1, $2, $3, 'cash')", [c.org, inv, cents]);

async function squareConnection(c: Co, opts: { token?: string; expiresAt?: string } = {}) {
  await api.sql(
    `insert into public.integration_connections
       (organization_id, provider, external_account_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, status, metadata, connected_by)
     values ($1, 'square', $2, $3, $4, $5::timestamptz, 'active', '{"location_id":"LOC_MAIN"}'::jsonb, $6)`,
    [
      c.org,
      `MERCHANT_${++seq}`,
      encryptSecret(opts.token ?? "sq-access-token-live"),
      encryptSecret("sq-refresh-token-original"),
      opts.expiresAt ?? new Date(Date.now() + 20 * 86_400_000).toISOString(),
      c.owner.membershipId,
    ],
  );
}

const sessionCalls = () => stripeFake.calls.filter((k) => k.method === "checkout.sessions.create");
type LineItem = { price_data: { unit_amount: number; currency: string; product_data: { name: string } } };

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("Pay by card (Stripe) on the invoice page", { timeout: 120_000 }, () => {
  it("charges what is still owed, to the business's account, whatever the form says", async () => {
    const c = await company("Stripe Pay Co", { feeBps: 100 });
    const inv = await invoice(c, 20000);
    await cash(c, inv.id, 5000);

    const to = await press(pay.startStripeCheckoutAction, { token: inv.token, amount_cents: "1", amount: "0.01", unit_amount: "1" });
    expect(to, api.log()).toMatch(/^https:\/\/checkout\.stripe\.test\/c\/pay\/cs_test_\d+$/);
    const [call] = sessionCalls();
    const items = call.params.line_items as LineItem[];
    expect(items).toHaveLength(1);
    expect(items[0].price_data).toMatchObject({ unit_amount: 15000, currency: "cad" });
    expect(call.params.payment_intent_data).toMatchObject({
      application_fee_amount: 150,
      transfer_data: { destination: c.account },
      on_behalf_of: c.account,
      metadata: { invoice_id: inv.id, organization_id: c.org, tip_cents: "0" },
    });
    expect(call.params.success_url).toBe(`${SITE}/pay/${inv.id}/success?token=${inv.token}&provider=stripe`);
    expect(String(call.opts?.idempotencyKey)).toContain(`_${inv.id}_15000_0`);
    const [stored] = await api.sql<{ stripe_payment_url: string }>("select stripe_payment_url from public.invoices where id = $1", [inv.id]);
    expect(stored.stripe_payment_url, "the untipped session is the invoice's payment link").toBe(to);
  });

  it("adds a tip as its own line only when the business takes tips, with no platform fee on it", async () => {
    const off = await company("No Tips Co", { tipping: false, feeBps: 200 });
    const offInv = await invoice(off, 10000);
    await press(pay.startStripeCheckoutAction, { token: offInv.token, tip_cents: "1500" });
    expect((sessionCalls()[0].params.line_items as LineItem[]).map((l) => l.price_data.unit_amount), "a forged tip is dropped").toEqual([10000]);

    stripeFake.calls.length = 0;
    const on = await company("Tips Co", { tipping: true, feeBps: 200 });
    const onInv = await invoice(on, 10000);
    await press(pay.startStripeCheckoutAction, { token: onInv.token, tip_cents: "1500" });
    const [call] = sessionCalls();
    expect((call.params.line_items as LineItem[]).map((l) => l.price_data.unit_amount)).toEqual([10000, 1500]);
    expect((call.params.payment_intent_data as { application_fee_amount: number }).application_fee_amount).toBe(200);
    const [stored] = await api.sql<{ u: string | null }>("select stripe_payment_url as u from public.invoices where id = $1", [onInv.id]);
    expect(stored.u, "a tipped session belongs to one payer, not the invoice").toBeNull();
  });

  it("refuses a short or unknown link, a settled invoice, and a business with no Stripe, without asking Stripe", async () => {
    const c = await company("Refuse Co");
    const paid = await invoice(c, 8000);
    await cash(c, paid.id, 8000);
    const voided = await invoice(c, 8000);
    await api.sql("update public.invoices set voided_at = now(), status = 'void' where id = $1", [voided.id]);
    const refunded = await invoice(c, 8000);
    await api.sql(
      "insert into public.invoice_payments (organization_id, invoice_id, amount_cents, refunded_cents, method, provider, provider_payment_id) values ($1, $2, 8000, 8000, 'card', 'stripe', $3)",
      [c.org, refunded.id, `pi_refunded_${++seq}`],
    );
    const zero = await invoice(c, 0);
    const none = await company("No Stripe Co", { stripeAccount: null });
    const unconnected = await invoice(none, 8000);

    expect(await press(pay.startStripeCheckoutAction, { token: "short" })).toBe("/?pay_error=bad_token");
    expect(await press(pay.startStripeCheckoutAction, { token: "" })).toBe("/?pay_error=bad_token");
    expect(await press(pay.startStripeCheckoutAction, { token: "NoSuchTokenAtAll1" })).toBe("/?pay_error=not_found");
    expect(await press(pay.startStripeCheckoutAction, { token: paid.token })).toBe(`/i/${paid.token}?pay_error=already_settled`);
    expect(await press(pay.startStripeCheckoutAction, { token: voided.token })).toBe(`/i/${voided.token}?pay_error=already_settled`);
    expect(await press(pay.startStripeCheckoutAction, { token: refunded.token })).toBe(`/i/${refunded.token}?pay_error=already_settled`);
    expect(await press(pay.startStripeCheckoutAction, { token: zero.token })).toBe(`/i/${zero.token}?pay_error=zero_amount`);
    expect(await press(pay.startStripeCheckoutAction, { token: unconnected.token })).toBe(`/i/${unconnected.token}?pay_error=not_connected`);
    expect(stripeFake.calls).toEqual([]);
  });

  it("an eleventh press within a minute is turned away", async () => {
    const c = await company("Hammer Co");
    const inv = await invoice(c, 5000);
    for (let i = 0; i < 10; i++) await press(pay.startStripeCheckoutAction, { token: inv.token });
    expect(sessionCalls()).toHaveLength(10);
    expect(await press(pay.startStripeCheckoutAction, { token: inv.token })).toBe(`/i/${inv.token}?pay_error=rate_limited`);
    expect(sessionCalls()).toHaveLength(10);
  });
});

describe.skipIf(!hasPostgrest)("Pay by card (Square) on the invoice page", { timeout: 120_000 }, () => {
  it("makes a payment link for what is still owed, in the business's currency, at its location, with its own token", async () => {
    const c = await company("Square Pay Co", { currency: "USD", tipping: true });
    await squareConnection(c, { token: "sq-access-token-usd" });
    const inv = await invoice(c, 12000, { number: "INV-0042" });
    await cash(c, inv.id, 2000);

    const to = await press(pay.startSquareCheckoutAction, { token: inv.token, amount_cents: "1" });
    expect(to, api.log()).toMatch(/^https:\/\/square\.link\/u\/PLINK\d+$/);
    const links = squareFake.calls.filter((k) => k.path === "/v2/online-checkout/payment-links");
    expect(links).toHaveLength(1);
    expect(links[0].auth).toBe("Bearer sq-access-token-usd");
    expect(links[0].body).toMatchObject({
      idempotency_key: `sollos-invoice-${inv.id}-10000`,
      quick_pay: { price_money: { amount: 10000, currency: "USD" }, location_id: "LOC_MAIN" },
      checkout_options: { redirect_url: `${SITE}/pay/${inv.id}/success?token=${inv.token}&provider=square`, allow_tipping: true },
    });
    expect(String((links[0].body.quick_pay as { name: string }).name)).toContain("INV-0042");
    const [stored] = await api.sql<{ square_payment_link_url: string; square_order_id: string }>(
      "select square_payment_link_url, square_order_id from public.invoices where id = $1",
      [inv.id],
    );
    expect(stored.square_payment_link_url).toBe(to);
    expect(stored.square_order_id).toMatch(/^ORDER\d+$/);
  });

  it("refuses a short or unknown link, a settled invoice, and a business with no Square, without asking Square", async () => {
    const c = await company("Square Refuse Co");
    await squareConnection(c);
    const paid = await invoice(c, 8000);
    await cash(c, paid.id, 8000);
    const voided = await invoice(c, 8000);
    await api.sql("update public.invoices set voided_at = now(), status = 'void' where id = $1", [voided.id]);
    const none = await company("No Square Co");
    const unconnected = await invoice(none, 8000);

    expect(await press(pay.startSquareCheckoutAction, { token: "1234567" })).toBe("/?pay_error=bad_token");
    expect(await press(pay.startSquareCheckoutAction, { token: "NoSuchTokenAtAll2" })).toBe("/?pay_error=not_found");
    expect(await press(pay.startSquareCheckoutAction, { token: paid.token })).toBe(`/i/${paid.token}?pay_error=already_settled`);
    expect(await press(pay.startSquareCheckoutAction, { token: voided.token })).toBe(`/i/${voided.token}?pay_error=already_settled`);
    expect(await press(pay.startSquareCheckoutAction, { token: unconnected.token })).toBe(`/i/${unconnected.token}?pay_error=not_connected`);
    expect(squareFake.calls).toEqual([]);
  });

  // FIX-LATER: getValidAccessToken saves a refreshed Square token with connected_by = "" (not a uuid); the insert fails after the old connection was already switched off, so Square disconnects itself on the first payment after the 30-day token runs out.
  it.fails("a connection whose 30-day token has run out is refreshed and kept, and the client still gets a payment link", async () => {
    const c = await company("Stale Square Co");
    await squareConnection(c, { token: "sq-access-token-stale", expiresAt: new Date(Date.now() - 86_400_000).toISOString() });
    const inv = await invoice(c, 9000);

    const to = await press(pay.startSquareCheckoutAction, { token: inv.token });
    expect(squareFake.calls.map((k) => k.path)).toContain("/oauth2/token");
    const conns = await api.sql<{ status: string; access_token_ciphertext: string | null; token_expires_at: string }>(
      "select status::text as status, access_token_ciphertext, token_expires_at from public.integration_connections where organization_id = $1 and provider = 'square' and status = 'active'",
      [c.org],
    );
    expect(conns, "still connected after the refresh").toHaveLength(1);
    expect(decryptSecret(conns[0].access_token_ciphertext)).toBe("sq-access-token-fresh");
    expect(to).toMatch(/^https:\/\/square\.link\/u\/PLINK\d+$/);
  });
});

describe.skipIf(!hasPostgrest)("the office's payment link button", { timeout: 120_000 }, () => {
  const post = (id: string) => officeCheckout(new NextRequest(`${SITE}/api/invoices/${id}/stripe-checkout`, { method: "POST" }), { params: Promise.resolve({ id }) });

  it("an owner gets a Checkout link for the balance of her own invoice; a paid one says so", async () => {
    const c = await company("Office Link Co");
    const inv = await invoice(c, 30000);
    await cash(c, inv.id, 10000);

    const res = (await as(c.owner, () => post(inv.id))) as Response;
    expect(res.status, api.log()).toBe(200);
    const body = (await res.json()) as { url: string; sessionId: string };
    expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const [call] = sessionCalls();
    expect((call.params.line_items as LineItem[])[0].price_data.unit_amount).toBe(20000);
    expect(call.params.success_url).toBe(`${SITE}/pay/${inv.id}/success`);

    await cash(c, inv.id, 20000);
    const paid = (await as(c.owner, () => post(inv.id))) as Response;
    expect(paid.status).toBe(400);
    expect(sessionCalls()).toHaveLength(1);
  });

  it("a manager is sent away, and another company's invoice is not found", async () => {
    const c = await company("Office Guard Co");
    const other = await company("Other Office Co");
    const theirs = await invoice(other, 10000);
    const mine = await invoice(c, 10000);

    expect(await as(c.manager, () => post(mine.id))).toEqual({ redirected: "/app" });
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    expect(await as(anna, () => post(mine.id))).toEqual({ redirected: "/field" });
    const res = (await as(c.owner, () => post(theirs.id))) as Response;
    expect(res.status).toBe(404);
    expect(stripeFake.calls).toEqual([]);
    const [row] = await api.sql<{ u: string | null }>("select stripe_payment_url as u from public.invoices where id = $1", [theirs.id]);
    expect(row.u).toBeNull();
  });
});

describe.skipIf(!hasPostgrest)("Download PDF", { timeout: 120_000 }, () => {
  const getInvoicePdf = (token: string) => invoicePdf(new NextRequest(`${SITE}/api/i/${token}/pdf`), { params: Promise.resolve({ token }) });
  const getEstimatePdf = (token: string) => estimatePdf(new NextRequest(`${SITE}/api/e/${token}/pdf`), { params: Promise.resolve({ token }) });

  it("an invoice's link renders that invoice and nothing of anyone else's; a wrong or short link renders nothing", async () => {
    const c = await company("Pdf Co");
    const other = await company("Other Pdf Co");
    const inv = await invoice(c, 10000, { number: "INV 0007" });
    await api.sql(
      `insert into public.invoice_line_items (organization_id, invoice_id, label, quantity, unit_price_cents, sort_order)
       values ($1, $2, 'Deep clean', 2, 4000, 1), ($1, $2, 'Inside oven', 1, 2000, 2)`,
      [c.org, inv.id],
    );
    await invoice(other, 99900, { number: "THEIRS-1" });

    const res = await getInvoicePdf(inv.token);
    expect(res.status, api.log()).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="invoice-inv-0007.pdf"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).toString("utf8")).toContain("%PDF");
    expect(pdfFake.invoice).toHaveLength(1);
    expect(pdfFake.invoice[0]).toMatchObject({
      invoiceNumber: "INV 0007",
      orgName: c.name,
      totalCents: 10000,
      lineItems: [
        { label: "Deep clean", quantity: 2, unitPriceCents: 4000 },
        { label: "Inside oven", quantity: 1, unitPriceCents: 2000 },
      ],
    });
    expect(JSON.stringify(pdfFake.invoice[0])).not.toContain("THEIRS-1");

    for (const bad of ["short", "NoSuchTokenAtAll3", `${inv.token}x`, inv.token.slice(0, -1)]) {
      expect((await getInvoicePdf(bad)).status, bad).toBe(404);
    }
    expect(pdfFake.invoice).toHaveLength(1);
  });

  it("an estimate's link renders that estimate under the client's name; a wrong link or a failed render says so", async () => {
    const c = await company("Estimate Pdf Co");
    await api.sql("update public.clients set name = 'Hilda Daubner-Smith' where id = $1", [c.client]);
    const token = `estpdf${Date.now()}`.slice(0, 16).padEnd(16, "x");
    await api.sql(
      "insert into public.estimates (organization_id, client_id, status, total_cents, service_description, public_token) values ($1, $2, 'sent', 25000, 'Deep clean', $3)",
      [c.org, c.client, token],
    );

    const res = await getEstimatePdf(token);
    expect(res.status, api.log()).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="estimate-hilda-daubner-smith.pdf"');
    expect(pdfFake.estimate).toEqual([{ publicToken: token }]);

    expect((await getEstimatePdf("1234567")).status).toBe(404);
    expect((await getEstimatePdf("NoSuchEstimate01")).status).toBe(404);
    expect(pdfFake.estimate).toHaveLength(1);

    pdfFake.fail = true;
    const failed = await getEstimatePdf(token);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "PDF generation failed. Try again in a moment." });
  });
});

describe.skipIf(!hasPostgrest)("Resend's bounce and complaint webhook", { timeout: 120_000 }, () => {
  function signed(body: string, opts: { secret?: string; ts?: number; id?: string } = {}) {
    const id = opts.id ?? `msg_${++seq}`;
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    const secret = (opts.secret ?? RESEND_SECRET).replace(/^whsec_/, "");
    const sig = createHmac("sha256", Buffer.from(secret, "base64")).update(`${id}.${ts}.${body}`).digest("base64");
    return { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` };
  }
  const post = (body: string, headers: Record<string, string>) =>
    resendWebhook(new NextRequest(`${SITE}/api/webhooks/resend`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } }));
  const event = (type: string, to: string[] | string, emailId = `email_${++seq}_${Date.now()}`) =>
    JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: emailId, to, subject: "Your invoice" } });
  const suppressed = (email: string) =>
    api.sql<{ reason: string; provider_event_id: string | null }>("select reason, provider_event_id from public.email_suppressions where email = $1", [email]);

  it("turns away a post that isn't signed, is signed wrongly, or is old, and writes nothing", async () => {
    const email = `nosig${++seq}@example.com`;
    const body = event("email.bounced", [email]);
    expect((await post(body, {})).status).toBe(401);
    expect((await post(body, signed(body, { secret: `whsec_${randomBytes(24).toString("base64")}` }))).status).toBe(401);
    expect((await post(body, signed(`${body} `))).status, "signed for a different body").toBe(401);
    expect((await post(body, signed(body, { ts: Math.floor(Date.now() / 1000) - 600 }))).status, "a replay ten minutes late").toBe(401);
    // With no secret configured nothing is trusted, not even a "signed" post.
    delete process.env.RESEND_WEBHOOK_SECRET;
    try {
      expect((await post(body, signed(body))).status).toBe(500);
    } finally {
      process.env.RESEND_WEBHOOK_SECRET = RESEND_SECRET;
    }
    expect(await suppressed(email)).toEqual([]);
  });

  it("a signed bounce or complaint puts the address on the list once; other events are acknowledged and ignored", async () => {
    const bounced = `Bounce${++seq}@Example.com`;
    const body = event("email.bounced", [bounced]);
    const res = await post(body, signed(body));
    expect(res.status, api.log()).toBe(200);
    expect(await res.json()).toEqual({ ok: true, suppressed: 1 });
    expect((await suppressed(bounced.toLowerCase())).map((r) => r.reason)).toEqual(["bounced"]);

    expect((await post(body, signed(body))).status, "Resend delivers again").toBe(200);
    expect(await suppressed(bounced.toLowerCase())).toHaveLength(1);

    const complained = `spam${++seq}@example.com`;
    const complaint = event("email.complained", complained);
    expect((await post(complaint, signed(complaint))).status).toBe(200);
    expect((await suppressed(complained)).map((r) => r.reason)).toEqual(["complained"]);

    const fine = `fine${++seq}@example.com`;
    const delivered = event("email.delivered", [fine]);
    const ack = await post(delivered, signed(delivered));
    expect(await ack.json()).toEqual({ ok: true, ignored: "email.delivered" });
    expect(await suppressed(fine)).toEqual([]);
  });

  it("a bounce that names two addresses puts both on the list, as the reply says it did", async () => {
    const a = `first${++seq}@example.com`;
    const b = `second${seq}@example.com`;
    const body = event("email.bounced", [a, b]);
    const res = await post(body, signed(body));
    expect(await res.json()).toEqual({ ok: true, suppressed: 2 });
    expect(await suppressed(a)).toHaveLength(1);
    expect(await suppressed(b)).toHaveLength(1);
  });
});

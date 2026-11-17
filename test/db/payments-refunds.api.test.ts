/**
 * Money going back to a client, and the review link on a paid invoice,
 * pressed as the office presses them against a real database behind the real
 * PostgREST. The card processors are stand-ins: the Stripe SDK is replaced by
 * a small fake that keeps its own ledger per charge, and Square's REST API is
 * answered by a fetch stand-in for its host only.
 *
 *   refund a Stripe card payment    partial, then full, then "again"
 *   refund a Square card payment    partial, then full with the tip, then "again"
 *   the review link                 a paid invoice gets one, once
 *
 * What each owes: a refund never goes past what is left on the payment and
 * can't be issued twice; only an owner or admin can send money back; another
 * company's payment is out of reach; the books follow the processor at once
 * (the payment's refunded amount and the invoice's status), not only when a
 * webhook arrives.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

// ── Stand-ins ────────────────────────────────────────────────────────────────

type StripeCall = { method: string; params: Record<string, unknown>; opts?: Record<string, unknown> };
const stripeFake = vi.hoisted(() => ({
  calls: [] as StripeCall[],
  /** Per payment intent: what was charged (invoice + tip) and refunded so far. */
  charges: new Map<string, { amount: number; refunded: number }>(),
  seq: 0,
}));

vi.mock("stripe", () => {
  class FakeStripe {
    refunds = {
      create: async (params: Record<string, unknown>, opts?: Record<string, unknown>) => {
        stripeFake.calls.push({ method: "refunds.create", params, opts });
        const pi = String(params.payment_intent);
        const ch = stripeFake.charges.get(pi);
        if (!ch) throw new Error(`No such payment_intent: '${pi}'`);
        const left = ch.amount - ch.refunded;
        if (left <= 0) throw new Error(`Charge for ${pi} has already been refunded.`);
        const amount = typeof params.amount === "number" ? params.amount : left;
        if (amount > left) throw new Error(`Refund amount is greater than unrefunded amount on charge (${left})`);
        ch.refunded += amount;
        return { id: `re_test_${++stripeFake.seq}`, object: "refund", amount, charge: `ch_for_${pi}`, status: "succeeded" };
      },
    };
    charges = {
      retrieve: async (id: string) => {
        stripeFake.calls.push({ method: "charges.retrieve", params: { id } });
        const ch = stripeFake.charges.get(id.replace(/^ch_for_/, ""));
        return { id, object: "charge", amount: ch?.amount ?? 0, amount_refunded: ch?.refunded ?? 0 };
      },
    };
  }
  return { default: FakeStripe };
});

type SquareCall = { url: string; method: string; body: Record<string, unknown>; auth: string | null };
const squareFake = vi.hoisted(() => ({ calls: [] as SquareCall[] }));

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  isEmailConfigured: () => true,
  sendEmail: async () => true,
  sendOrgEmail: async () => true,
  sendOrgEmailDetailed: async () => ({ ok: true }),
}));

// Test values only; none of these is a real secret.
process.env.STRIPE_ENABLED = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_sollos_refunds_not_real";
process.env.INTEGRATION_ENCRYPTION_KEY = `base64:${randomBytes(32).toString("base64")}`;
process.env.SQUARE_APPLICATION_ID = "sandbox-sq0idb-sollos-test";
process.env.SQUARE_APPLICATION_SECRET = "sandbox-sq0csb-sollos-test";
process.env.SQUARE_ENVIRONMENT = "sandbox";

const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^https:\/\/connect\.squareup(sandbox)?\.com\//.test(url)) return realFetch(input, init);
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  const headers = new Headers(init?.headers);
  squareFake.calls.push({ url, method: init?.method ?? "GET", body, auth: headers.get("authorization") });
  const json = (status: number, b: unknown) =>
    new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.endsWith("/v2/refunds")) {
    return json(200, { refund: { id: `sq_refund_${squareFake.calls.length}`, status: "PENDING" } });
  }
  if (url.endsWith("/oauth2/token") && body.grant_type === "refresh_token") {
    return json(200, {
      access_token: "sq-access-token-refreshed",
      refresh_token: "sq-refresh-token-refreshed",
      token_type: "bearer",
      expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      merchant_id: "MERCHANT_REFRESHED",
      short_lived: false,
    });
  }
  return json(404, { errors: [{ code: "NOT_FOUND", detail: `stand-in has no ${url}` }] });
});

const invoices = await import("@/app/app/invoices/actions");
const { encryptSecret } = await import("@/lib/crypto");
const { reviewLinkToken, storedReviewToken } = await import("@/lib/review-token");

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

/** Signed in as this member; a redirect is an answer too. */
async function as<T>(m: Member, press: () => Promise<T>): Promise<T | { redirected: string }> {
  request.cookies = api.sessionCookies(m.userId);
  try {
    return await press();
  } catch (err) {
    const r = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
    if (r) return { redirected: r[1] };
    throw err;
  } finally {
    await settle();
  }
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

let seq = 0;

async function company(name = "Refund Co") {
  const org = await addOrg(api.sql, name);
  await api.sql("update public.organizations set timezone = 'America/Edmonton' where id = $1", [org]);
  return {
    org,
    client: await addClient(api.sql, org, "Hilda Daubner"),
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    admin: await addMember(api.sql, org, "admin", "Admin"),
    manager: await addMember(api.sql, org, "manager", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
}
type Co = Awaited<ReturnType<typeof company>>;

async function invoice(c: Co, cents = 10000): Promise<string> {
  const [row] = await api.sql<{ id: string }>(
    `insert into public.invoices (organization_id, client_id, status, amount_cents, sent_at, due_date)
     values ($1, $2, 'sent', $3, now(), current_date + 14) returning id`,
    [c.org, c.client, cents],
  );
  return row.id;
}

/** A card payment as the webhook records it: the invoice portion, with the tip (if any) on its own rows. */
async function cardPayment(
  c: Co,
  inv: string,
  provider: "stripe" | "square",
  cents: number,
  opts: { tip?: number; fee?: number } = {},
): Promise<{ id: string; pi: string }> {
  const pi = `${provider === "stripe" ? "pi" : "sqpay"}_test_${++seq}_${Date.now()}`;
  const [row] = await api.sql<{ id: string }>(
    `insert into public.invoice_payments (organization_id, invoice_id, amount_cents, method, provider, provider_payment_id, provider_fee_cents, received_at)
     values ($1, $2, $3, 'card', $4::public.integration_provider, $5, $6, now()) returning id`,
    [c.org, inv, cents, provider, pi, opts.fee ?? null],
  );
  if (opts.tip) {
    await api.sql(
      `insert into public.invoice_tips (organization_id, invoice_id, membership_id, amount_cents, provider, provider_payment_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [c.org, inv, c.anna.membershipId, opts.tip, provider, pi],
    );
  }
  if (provider === "stripe") stripeFake.charges.set(pi, { amount: cents + (opts.tip ?? 0), refunded: 0 });
  return { id: row.id, pi };
}

async function squareConnection(c: Co, accessToken: string, expiresAt = new Date(Date.now() + 20 * 86_400_000).toISOString()) {
  await api.sql(
    `insert into public.integration_connections
       (organization_id, provider, external_account_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, status, metadata, connected_by)
     values ($1, 'square', $2, $3, $4, $5::timestamptz, 'active', '{"location_id":"LOC_TEST"}'::jsonb, $6)`,
    [c.org, `MERCHANT_${++seq}`, encryptSecret(accessToken), encryptSecret(`refresh-${accessToken}`), expiresAt, c.owner.membershipId],
  );
}

const paymentRow = async (id: string) =>
  (await api.sql<{ refunded_cents: number; amount_cents: number }>("select refunded_cents, amount_cents from public.invoice_payments where id = $1", [id]))[0];
const invoiceStatus = async (id: string) =>
  (await api.sql<{ s: string }>("select status::text as s from public.invoices where id = $1", [id]))[0].s;
const refundAudits = (inv: string) =>
  api.sql<{ after: Record<string, unknown>; actor_id: string }>(
    "select after, actor_id from public.audit_log where entity = 'invoice' and entity_id = $1 and after ? 'refund_issued_cents' order by created_at",
    [inv],
  );
const refundForm = (paymentId: string, invoiceId: string, amount: string | null) =>
  form({ payment_id: paymentId, invoice_id: invoiceId, mode: amount === null ? "full" : "partial", amount_dollars: amount ?? "" });

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("refund a Stripe card payment", { timeout: 120_000 }, () => {
  it("a partial refund goes back through Stripe from the business's account, and the books follow at once", async () => {
    const c = await company();
    const inv = await invoice(c, 10000);
    const pay = await cardPayment(c, inv, "stripe", 10000, { fee: 150 });
    expect(await invoiceStatus(inv)).toBe("paid");

    const res = await as(c.owner, () => invoices.refundStripePaymentAction({}, refundForm(pay.id, inv, "40.00")));
    expect(res, api.log()).toEqual({ ok: true });
    const issued = stripeFake.calls.filter((k) => k.method === "refunds.create");
    expect(issued).toHaveLength(1);
    expect(issued[0].params).toMatchObject({
      payment_intent: pay.pi,
      amount: 4000,
      // The connected account funds it, and the platform fee comes back too.
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: { sollos_invoice_id: inv, sollos_requested_by: c.owner.membershipId },
    });
    expect((await paymentRow(pay.id)).refunded_cents).toBe(4000);
    expect(await invoiceStatus(inv)).toBe("partially_paid");
    const audits = await refundAudits(inv);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_id: c.owner.membershipId, after: { refund_issued_cents: 4000, full_refund: false, payment_id: pay.id } });
    const [told] = await api.sql<{ n: number }>(
      "select count(*)::int as n from public.notifications where organization_id = $1 and title = 'Refund issued'",
      [c.org],
    );
    expect(told.n, "the owners hear about money leaving").toBeGreaterThan(0);
  });

  it("never past what is left, never twice: a full refund empties it and a second one is refused without calling Stripe", async () => {
    const c = await company();
    const inv = await invoice(c, 10000);
    const pay = await cardPayment(c, inv, "stripe", 10000, { tip: 1500 });

    await as(c.owner, () => invoices.refundStripePaymentAction({}, refundForm(pay.id, inv, "40.00")));
    stripeFake.calls.length = 0;

    const tooMuch = await as(c.owner, () => invoices.refundStripePaymentAction({}, refundForm(pay.id, inv, "70.00")));
    expect(tooMuch).toEqual({ error: "Only 60.00 of the invoice portion is left to refund. To also return a tip, use a full refund." });
    expect(stripeFake.calls, "refused before Stripe is asked").toEqual([]);

    const full = await as(c.admin, () => invoices.refundStripePaymentAction({}, refundForm(pay.id, inv, null)));
    expect(full).toEqual({ ok: true });
    const [fullCall] = stripeFake.calls.filter((k) => k.method === "refunds.create");
    expect(fullCall.params.amount, "a full refund lets Stripe compute the rest, tip included").toBeUndefined();
    expect(stripeFake.charges.get(pay.pi)).toEqual({ amount: 11500, refunded: 11500 });
    expect((await paymentRow(pay.id)).refunded_cents).toBe(10000);
    expect(await invoiceStatus(inv)).toBe("refunded");
    expect(await api.sql("select 1 from public.invoice_tips where provider_payment_id = $1", [pay.pi]), "the unpaid tip comes back off the cleaner's tab").toHaveLength(0);

    stripeFake.calls.length = 0;
    expect(await as(c.owner, () => invoices.refundStripePaymentAction({}, refundForm(pay.id, inv, null)))).toEqual({
      error: "This payment has already been fully refunded.",
    });
    expect(await as(c.owner, () => invoices.refundStripePaymentAction({}, refundForm(pay.id, inv, "1.00")))).toMatchObject({
      error: expect.stringContaining("Only 0.00"),
    });
    expect(stripeFake.calls).toEqual([]);
  });

  it("only an owner or admin can send money back; a manager or cleaner is refused before Stripe is asked", async () => {
    const c = await company();
    const inv = await invoice(c, 8000);
    const pay = await cardPayment(c, inv, "stripe", 8000);
    for (const who of [c.manager, c.anna]) {
      const res = await as(who, () => invoices.refundStripePaymentAction({}, refundForm(pay.id, inv, null)));
      expect(res).toEqual({ error: "Only owners and admins can issue refunds." });
    }
    expect(stripeFake.calls).toEqual([]);
    expect((await paymentRow(pay.id)).refunded_cents).toBe(0);
    expect(await invoiceStatus(inv)).toBe("paid");
  });

  it("another company's payment, a payment typed in by hand, and a nonsense amount are all refused", async () => {
    const c = await company();
    const other = await company("Other Co");
    const theirInv = await invoice(other, 9000);
    const theirs = await cardPayment(other, theirInv, "stripe", 9000);
    const mine = await invoice(c, 5000);
    const [cash] = await api.sql<{ id: string }>(
      "insert into public.invoice_payments (organization_id, invoice_id, amount_cents, method) values ($1, $2, 5000, 'cash') returning id",
      [c.org, mine],
    );
    const card = await cardPayment(c, await invoice(c, 5000), "stripe", 5000);

    expect(await as(c.owner, () => invoices.refundStripePaymentAction({}, refundForm(theirs.id, theirInv, null)))).toEqual({ error: "Payment not found." });
    expect(await as(c.owner, () => invoices.refundStripePaymentAction({}, refundForm(cash.id, mine, null)))).toMatchObject({
      error: expect.stringContaining("Only card payments can be refunded here"),
    });
    for (const bad of ["0", "-5", "abc", ""]) {
      expect(await as(c.owner, () => invoices.refundStripePaymentAction({}, refundForm(card.id, mine, bad)))).toEqual({ error: "Enter an amount to refund." });
    }
    expect(await as(c.owner, () => invoices.refundStripePaymentAction({}, form({ payment_id: "", invoice_id: mine, mode: "full" })))).toEqual({
      error: "Missing payment.",
    });
    expect(stripeFake.calls).toEqual([]);
    expect((await paymentRow(theirs.id)).refunded_cents).toBe(0);
    expect(await invoiceStatus(theirInv)).toBe("paid");
  });
});

describe.skipIf(!hasPostgrest)("refund a Square card payment", { timeout: 120_000 }, () => {
  it("partial then full: each goes to Square with the business's own token, the tip comes back only on the full one", async () => {
    const c = await company();
    await squareConnection(c, "sq-access-token-alpha");
    const inv = await invoice(c, 10000);
    const pay = await cardPayment(c, inv, "square", 10000, { tip: 2000 });

    const partial = await as(c.owner, () => invoices.refundSquarePaymentAction({}, refundForm(pay.id, inv, "30.00")));
    expect(partial, api.log()).toEqual({ ok: true });
    expect(squareFake.calls).toHaveLength(1);
    expect(squareFake.calls[0]).toMatchObject({
      method: "POST",
      auth: "Bearer sq-access-token-alpha",
      body: { payment_id: pay.pi, amount_money: { amount: 3000, currency: "CAD" } },
    });
    expect((await paymentRow(pay.id)).refunded_cents).toBe(3000);
    expect(await invoiceStatus(inv)).toBe("partially_paid");

    const over = await as(c.owner, () => invoices.refundSquarePaymentAction({}, refundForm(pay.id, inv, "80.00")));
    expect(over).toEqual({ error: "Only $70.00 of the invoice portion remains refundable. To also return the tip, use a full refund." });
    expect(squareFake.calls).toHaveLength(1);

    const full = await as(c.admin, () => invoices.refundSquarePaymentAction({}, refundForm(pay.id, inv, null)));
    expect(full).toEqual({ ok: true });
    expect(squareFake.calls).toHaveLength(2);
    expect(squareFake.calls[1].body.amount_money, "the rest of the invoice portion plus the tip").toEqual({ amount: 9000, currency: "CAD" });
    expect(squareFake.calls[1].body.idempotency_key).not.toBe(squareFake.calls[0].body.idempotency_key);
    expect((await paymentRow(pay.id)).refunded_cents).toBe(10000);
    expect(await invoiceStatus(inv)).toBe("refunded");
    expect(await api.sql("select 1 from public.invoice_tips where provider_payment_id = $1", [pay.pi])).toHaveLength(0);
    expect((await refundAudits(inv)).map((a) => a.after.refund_issued_cents)).toEqual([3000, 9000]);

    expect(await as(c.owner, () => invoices.refundSquarePaymentAction({}, refundForm(pay.id, inv, null)))).toEqual({
      error: "This payment is already fully refunded.",
    });
    expect(squareFake.calls, "not a third time").toHaveLength(2);
  });

  it("the same refund pressed twice before the first is booked asks Square with the same key, so it lands once", async () => {
    const c = await company();
    await squareConnection(c, "sq-access-token-beta");
    const inv = await invoice(c, 6000);
    const pay = await cardPayment(c, inv, "square", 6000);
    // Square dedupes on the idempotency key; the key is built from the payment,
    // what was refunded before, and the amount. Two presses from the same
    // starting point must carry the same key.
    const before = await paymentRow(pay.id);
    await as(c.owner, () => invoices.refundSquarePaymentAction({}, refundForm(pay.id, inv, "10.00")));
    await api.sql("update public.invoice_payments set refunded_cents = $2 where id = $1", [pay.id, before.refunded_cents]);
    await as(c.owner, () => invoices.refundSquarePaymentAction({}, refundForm(pay.id, inv, "10.00")));
    expect(squareFake.calls).toHaveLength(2);
    expect(squareFake.calls[0].body.idempotency_key).toBe(squareFake.calls[1].body.idempotency_key);
  });

  it("only an owner or admin; never another company's payment; never a Stripe or hand-typed payment; not without a connection", async () => {
    const c = await company();
    const other = await company("Other Square Co");
    await squareConnection(other, "sq-access-token-theirs");
    const theirInv = await invoice(other, 7000);
    const theirs = await cardPayment(other, theirInv, "square", 7000);
    const mineInv = await invoice(c, 7000);
    const mine = await cardPayment(c, mineInv, "square", 7000);
    const stripePay = await cardPayment(c, await invoice(c, 7000), "stripe", 7000);

    for (const who of [c.manager, c.anna]) {
      const res = await as(who, () => invoices.refundSquarePaymentAction({}, refundForm(mine.id, mineInv, null)));
      expect(res).toEqual({ error: "Only owners and admins can issue refunds." });
    }
    expect(await as(c.owner, () => invoices.refundSquarePaymentAction({}, refundForm(theirs.id, theirInv, null)))).toEqual({ error: "Payment not found." });
    expect(await as(c.owner, () => invoices.refundSquarePaymentAction({}, refundForm(stripePay.id, mineInv, null)))).toEqual({
      error: "This isn't a Square payment.",
    });
    // No Square connection on this company yet.
    expect(await as(c.owner, () => invoices.refundSquarePaymentAction({}, refundForm(mine.id, mineInv, null)))).toEqual({
      error: "Square isn't connected — reconnect it in Settings first.",
    });
    expect(squareFake.calls, "Square never asked").toEqual([]);
    expect((await paymentRow(theirs.id)).refunded_cents).toBe(0);
    expect((await paymentRow(mine.id)).refunded_cents).toBe(0);
  });

  // FIX-LATER: issueSquareRefund always asks Square for a CAD refund; a USD company's Square payments are taken in USD (createInvoiceCheckoutLink uses the org currency), and Square refuses a refund whose currency doesn't match the payment.
  it.fails("a US-dollar company's refund is asked for in US dollars, the currency the client paid in", async () => {
    const c = await company("Dollar Co");
    await api.sql("update public.organizations set currency_code = 'USD', timezone = 'America/New_York' where id = $1", [c.org]);
    await squareConnection(c, "sq-access-token-usd");
    const inv = await invoice(c, 10000);
    const pay = await cardPayment(c, inv, "square", 10000);

    await as(c.owner, () => invoices.refundSquarePaymentAction({}, refundForm(pay.id, inv, "10.00")));
    expect(squareFake.calls).toHaveLength(1);
    expect(squareFake.calls[0].body.amount_money).toEqual({ amount: 1000, currency: "USD" });
  });

  // FIX-LATER: the same refreshed-token save as the payment link (connected_by = "" is not a uuid): getValidAccessToken throws out of issueSquareRefund, which has no catch, so the owner gets the error page and the company's Square connection is left switched off.
  it.fails("a refund on a connection whose 30-day token has run out refreshes the token and is issued, not a crash", async () => {
    const c = await company("Stale Token Co");
    await squareConnection(c, "sq-access-token-stale", new Date(Date.now() - 86_400_000).toISOString());
    const inv = await invoice(c, 5000);
    const pay = await cardPayment(c, inv, "square", 5000);

    const res = await as(c.owner, () => invoices.refundSquarePaymentAction({}, refundForm(pay.id, inv, "5.00")));
    expect(res).toEqual({ ok: true });
    expect(squareFake.calls.find((k) => k.url.endsWith("/v2/refunds"))?.auth).toBe("Bearer sq-access-token-refreshed");
    const active = await api.sql("select 1 from public.integration_connections where organization_id = $1 and provider = 'square' and status = 'active'", [c.org]);
    expect(active, "still connected").toHaveLength(1);
  });
});

describe.skipIf(!hasPostgrest)("whose invoice a refund is written against", { timeout: 120_000 }, () => {
  // FIX-LATER: both refund actions log the refund against the invoice_id posted with the form, never checked against the payment's own invoice (updateInvoicePaymentAction refuses exactly this mismatch), so a crafted post files the refund under any invoice id and the real invoice's history never shows it.
  it.fails("the audit entry names the payment's own invoice, not whichever invoice id came with the form", async () => {
    const c = await company("Audit Co");
    const other = await company("Audit Other Co");
    const real = await invoice(c, 10000);
    const pay = await cardPayment(c, real, "stripe", 10000);
    const elsewhere = await invoice(other, 10000);

    expect(await as(c.owner, () => invoices.refundStripePaymentAction({}, refundForm(pay.id, elsewhere, "10.00")))).toEqual({ ok: true });
    expect((await paymentRow(pay.id)).refunded_cents).toBe(1000);
    expect(await refundAudits(elsewhere), "nothing filed under another company's invoice").toHaveLength(0);
    expect((await refundAudits(real)).map((a) => a.after.refund_issued_cents)).toEqual([1000]);
  });
});

describe.skipIf(!hasPostgrest)("the review link on a paid invoice", { timeout: 120_000 }, () => {
  const reviewToken = async (id: string) =>
    (await api.sql<{ t: string | null }>("select review_token as t from public.invoices where id = $1", [id]))[0].t;

  it("is issued once for a paid invoice, stored only as the hash of the signed link, and logged once", async () => {
    const c = await company();
    const inv = await invoice(c, 5000);
    await cardPayment(c, inv, "stripe", 5000);
    expect(await invoiceStatus(inv)).toBe("paid");

    await as(c.owner, () => invoices.generateReviewTokenAction(form({ id: inv })));
    const stored = await reviewToken(inv);
    expect(stored).toBe(storedReviewToken(reviewLinkToken("invoice", inv)));
    expect(stored).not.toContain(inv);

    await as(c.manager, () => invoices.generateReviewTokenAction(form({ id: inv })));
    expect(await reviewToken(inv), "the same link, not a new one").toBe(stored);
    const audits = await api.sql("select 1 from public.audit_log where entity_id = $1 and after ? 'review_token_generated'", [inv]);
    expect(audits).toHaveLength(1);
  });

  it("not for an unpaid invoice, not by a cleaner, and never on another company's invoice", async () => {
    const c = await company();
    const other = await company("Other Review Co");
    const unpaid = await invoice(c, 5000);
    const paid = await invoice(c, 5000);
    await cardPayment(c, paid, "stripe", 5000);
    const theirs = await invoice(other, 5000);
    await cardPayment(other, theirs, "stripe", 5000);

    await as(c.owner, () => invoices.generateReviewTokenAction(form({ id: unpaid })));
    await as(c.anna, () => invoices.generateReviewTokenAction(form({ id: paid })));
    await as(c.owner, () => invoices.generateReviewTokenAction(form({ id: theirs })));
    expect(await reviewToken(unpaid)).toBeNull();
    expect(await reviewToken(paid), "a cleaner can't mint her own review link").toBeNull();
    expect(await reviewToken(theirs)).toBeNull();
  });
});

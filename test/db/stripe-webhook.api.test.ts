/**
 * A client paying an invoice by card, as the payment processors report it:
 * the two Stripe webhooks and the Square webhook, called the way the
 * processors call them, with events signed by test secrets, against a real
 * database behind the real PostgREST.
 *
 * Invoice checkouts are destination charges, so in production the paid and
 * refunded events land on the PLATFORM endpoint (api/stripe/webhook); the
 * Connect endpoint (api/integrations/stripe/webhook) sees charges made
 * directly on a company's own account. Both write through the same recorder.
 *
 * What each owes the books: a paid checkout marks the invoice paid with one
 * payment on record; the same event delivered again, or the second event
 * the processor sends for the same payment, adds nothing; a tip paid with
 * the invoice is the cleaner's, not the invoice's; money paid on a voided
 * invoice is recorded but the invoice stays void; a refund brings the
 * invoice down to what is still held, and a refund event that arrives late
 * never undoes a bigger one; an event naming another company cannot touch
 * this company's invoice; an event the processor did not sign is turned
 * away; and the owner is told, once, about each refund and about money
 * paid on a void invoice.
 */
import { createHmac } from "node:crypto";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg } from "./harness";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));

// Test values only; none of these is a real secret.
const CONNECT_SECRET = "whsec_test_sollos_connect";
const PLATFORM_SECRET = "whsec_test_sollos_platform";
const SQUARE_KEY = "square_test_sollos_signature_key";

let api: Api;
let restoreEnv: () => void;
let connect: typeof import("@/app/api/integrations/stripe/webhook/route");
let platform: typeof import("@/app/api/stripe/webhook/route");
let square: typeof import("@/app/api/integrations/square/webhook/route");
const stripe = new Stripe("sk_test_sollos_not_real");

beforeAll(async () => {
  process.env.STRIPE_ENABLED = "true";
  process.env.STRIPE_CONNECT_CLIENT_ID ??= "ca_test_sollos_not_real";
  process.env.STRIPE_SECRET_KEY ??= "sk_test_sollos_not_real";
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = PLATFORM_SECRET;
  process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = SQUARE_KEY;
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  connect = await import("@/app/api/integrations/stripe/webhook/route");
  platform = await import("@/app/api/stripe/webhook/route");
  square = await import("@/app/api/integrations/square/webhook/route");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

let n = 0;
const next = () => `${++n}_${Date.now()}`;

async function company(opts: { stripeAccount?: string; squareMerchant?: string; squareOrder?: string } = {}) {
  const org = await addOrg(api.sql, "Card Co");
  await api.sql("update public.organizations set timezone = 'UTC', stripe_account_id = $2 where id = $1", [org, opts.stripeAccount ?? null]);
  await addMember(api.sql, org, "owner", "Owner");
  const client = await addClient(api.sql, org);
  const [inv] = await api.sql<{ id: string }>(
    "insert into public.invoices (organization_id, client_id, status, amount_cents, sent_at, due_date, square_order_id) values ($1, $2, 'sent', 14000, now(), current_date + 14, $3) returning id",
    [org, client, opts.squareOrder ?? null],
  );
  if (opts.squareMerchant) {
    await api.sql(
      "insert into public.integration_connections (organization_id, provider, external_account_id) values ($1, 'square', $2)",
      [org, opts.squareMerchant],
    );
  }
  return { org, invoice: inv.id };
}

// ── Stripe events ──────────────────────────────────────────────────────────

type Pay = { invoice: string; pi: string; org?: string; account?: string; amount?: number; tip?: number; fee?: number };

function stripeEvent(type: string, object: Record<string, unknown>, account?: string) {
  return {
    id: `evt_test_${next()}`,
    object: "event",
    type,
    ...(account ? { account } : {}),
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object },
  };
}

const metadata = (p: Pay) => ({
  invoice_id: p.invoice,
  ...(p.org ? { organization_id: p.org } : {}),
  ...(p.tip ? { tip_cents: String(p.tip) } : {}),
});

const checkoutEvent = (p: Pay) =>
  stripeEvent(
    "checkout.session.completed",
    {
      id: `cs_test_${next()}`,
      object: "checkout.session",
      mode: "payment",
      payment_status: "paid",
      status: "complete",
      currency: "cad",
      amount_total: p.amount ?? 14000,
      payment_intent: p.pi,
      metadata: metadata(p),
    },
    p.account,
  );

const paymentIntentEvent = (p: Pay) =>
  stripeEvent(
    "payment_intent.succeeded",
    {
      id: p.pi,
      object: "payment_intent",
      status: "succeeded",
      currency: "cad",
      amount: p.amount ?? 14000,
      amount_received: p.amount ?? 14000,
      application_fee_amount: p.fee ?? null,
      metadata: metadata(p),
    },
    p.account,
  );

/** Stripe's amount_refunded is the CUMULATIVE total refunded on the charge. */
const refundEvent = (pi: string, amountRefunded: number, account?: string) =>
  stripeEvent(
    "charge.refunded",
    { id: `ch_test_${next()}`, object: "charge", payment_intent: pi, amount: 14000, amount_refunded: amountRefunded, refunded: true },
    account,
  );

async function deliverStripe(endpoint: "connect" | "platform", event: object, opts: { badSignature?: boolean } = {}) {
  const { NextRequest } = await import("next/server");
  const payload = JSON.stringify(event);
  const secret = opts.badSignature ? "whsec_someone_else" : endpoint === "connect" ? CONNECT_SECRET : PLATFORM_SECRET;
  // The typings list every option as required; Stripe fills the rest in.
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret } as Parameters<typeof stripe.webhooks.generateTestHeaderString>[0]);
  const url = endpoint === "connect" ? "http://localhost/api/integrations/stripe/webhook" : "http://localhost/api/stripe/webhook";
  const req = new NextRequest(url, {
    method: "POST",
    body: payload,
    headers: { "stripe-signature": signature, "content-type": "application/json", "x-forwarded-for": `10.0.${n % 250}.1` },
  });
  return (endpoint === "connect" ? connect : platform).POST(req);
}

// ── Square events ──────────────────────────────────────────────────────────

function squarePaymentEvent(p: { merchant: string; order: string; payment: string; total?: number; tip?: number; refunded?: number; type?: string }) {
  return {
    event_id: `sq_evt_${next()}`,
    merchant_id: p.merchant,
    type: p.type ?? "payment.updated",
    data: {
      type: "payment",
      id: p.payment,
      object: {
        payment: {
          id: p.payment,
          status: "COMPLETED",
          order_id: p.order,
          total_money: { amount: p.total ?? 14000, currency: "CAD" },
          ...(p.tip ? { tip_money: { amount: p.tip } } : {}),
          ...(p.refunded ? { refunded_money: { amount: p.refunded } } : {}),
          card_details: { card: { last_4: "4242" } },
          created_at: new Date().toISOString(),
        },
      },
    },
  };
}

async function deliverSquare(event: object, opts: { badSignature?: boolean } = {}) {
  const { NextRequest } = await import("next/server");
  const body = JSON.stringify(event);
  const notificationUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost"}/api/integrations/square/webhook`;
  const signature = createHmac("sha256", opts.badSignature ? "someone_else" : SQUARE_KEY).update(notificationUrl + body).digest("base64");
  const req = new NextRequest("http://localhost/api/integrations/square/webhook", {
    method: "POST",
    body,
    headers: { "x-square-hmacsha256-signature": signature, "content-type": "application/json" },
  });
  return square.POST(req);
}

// ── The books ──────────────────────────────────────────────────────────────

const books = async (invoice: string) =>
  (
    await api.sql<{ status: string; payments: number; paid: number }>(
      `select i.status::text as status,
              (select count(*)::int from public.invoice_payments p where p.invoice_id = i.id) as payments,
              (select coalesce(sum(amount_cents - refunded_cents), 0)::int from public.invoice_payments p where p.invoice_id = i.id) as paid
         from public.invoices i where i.id = $1`,
      [invoice],
    )
  )[0];

const tipsOn = async (invoice: string) =>
  (
    await api.sql<{ tips: number }>("select coalesce(sum(amount_cents), 0)::int as tips from public.invoice_tips where invoice_id = $1", [invoice])
  )[0].tips;

/** What the owners were told, by title. */
const toldOwner = async (org: string, title: string) =>
  (
    await api.sql<{ n: number }>("select count(*)::int as n from public.notifications where organization_id = $1 and title = $2", [org, title])
  )[0].n;

const UNPAID = { status: "sent", payments: 0, paid: 0 };
const PAID = { status: "paid", payments: 1, paid: 14000 };

describe.skipIf(!hasPostgrest)("card payments on the platform Stripe endpoint (where invoice checkouts land)", () => {
  it("the payment event first, then the checkout event: paid once, with the processing fee on record", async () => {
    const c = await company();
    const pay = { invoice: c.invoice, org: c.org, pi: `pi_test_${next()}`, fee: 420 };
    const res = await deliverStripe("platform", paymentIntentEvent(pay));
    expect(res.status).toBeLessThan(300);
    await deliverStripe("platform", checkoutEvent(pay));
    expect(await books(c.invoice)).toEqual(PAID);
    const [{ fee }] = await api.sql<{ fee: number | null }>("select provider_fee_cents as fee from public.invoice_payments where invoice_id = $1", [c.invoice]);
    expect(fee).toBe(420);
  });

  it("the checkout event first, then the payment event: still one payment, and the fee fills in", async () => {
    const c = await company();
    const pay = { invoice: c.invoice, org: c.org, pi: `pi_test_${next()}`, fee: 420 };
    await deliverStripe("platform", checkoutEvent(pay));
    await deliverStripe("platform", paymentIntentEvent(pay));
    expect(await books(c.invoice)).toEqual(PAID);
    const [{ fee }] = await api.sql<{ fee: number | null }>("select provider_fee_cents as fee from public.invoice_payments where invoice_id = $1", [c.invoice]);
    expect(fee).toBe(420);
  });

  it("an event saying it is for another company cannot pay this company's invoice", async () => {
    const mine = await company();
    const theirs = await company();
    await deliverStripe("platform", checkoutEvent({ invoice: mine.invoice, org: theirs.org, pi: `pi_test_${next()}` }));
    expect(await books(mine.invoice)).toEqual(UNPAID);
  });

  it("a partial refund, then the rest: partly paid, then refunded", async () => {
    const c = await company();
    const pi = `pi_test_${next()}`;
    await deliverStripe("platform", checkoutEvent({ invoice: c.invoice, org: c.org, pi }));
    await deliverStripe("platform", refundEvent(pi, 4000));
    expect(await books(c.invoice)).toEqual({ status: "partially_paid", payments: 1, paid: 10000 });
    await deliverStripe("platform", refundEvent(pi, 14000));
    expect(await books(c.invoice)).toEqual({ status: "refunded", payments: 1, paid: 0 });
    expect(await toldOwner(c.org, "Refund issued"), "one notice per refund").toBe(2);
  });

  it("refund events out of order (the full refund first, the earlier partial late): the invoice stays refunded", async () => {
    // Stripe does not promise order, and a delivery that failed once is
    // retried later with its original payload. The in-app refund also
    // writes the full amount straight away, ahead of either webhook.
    const c = await company();
    const pi = `pi_test_${next()}`;
    await deliverStripe("platform", checkoutEvent({ invoice: c.invoice, org: c.org, pi }));
    await deliverStripe("platform", refundEvent(pi, 14000));
    await deliverStripe("platform", refundEvent(pi, 4000));
    expect(await books(c.invoice)).toEqual({ status: "refunded", payments: 1, paid: 0 });
  });

  it("a full refund of a payment with a tip: the invoice is refunded and the unpaid tip is taken back, once", async () => {
    const c = await company();
    const pi = `pi_test_${next()}`;
    await deliverStripe("platform", checkoutEvent({ invoice: c.invoice, org: c.org, pi, amount: 16000, tip: 2000 }));
    expect(await books(c.invoice)).toEqual(PAID);
    expect(await tipsOn(c.invoice)).toBe(2000);
    // The in-app refund reconciles straight away and the webhook follows
    // with the same cumulative number.
    await deliverStripe("platform", refundEvent(pi, 16000));
    await deliverStripe("platform", refundEvent(pi, 16000));
    expect(await books(c.invoice)).toEqual({ status: "refunded", payments: 1, paid: 0 });
    expect(await tipsOn(c.invoice)).toBe(0);
    expect(await toldOwner(c.org, "Refund issued"), "told once, not once per writer").toBe(1);
  });

  it("an event not signed by Stripe is turned away, and nothing is recorded", async () => {
    const c = await company();
    const res = await deliverStripe("platform", checkoutEvent({ invoice: c.invoice, org: c.org, pi: `pi_test_${next()}` }), { badSignature: true });
    expect(res.status).toBe(400);
    expect(await books(c.invoice)).toEqual(UNPAID);
  });
});

describe.skipIf(!hasPostgrest)("card payments on the Connect Stripe endpoint (charges on a company's own account)", () => {
  it("a paid checkout: the invoice is paid, with one payment on record", async () => {
    const account = `acct_test_${next()}`;
    const c = await company({ stripeAccount: account });
    const res = await deliverStripe("connect", checkoutEvent({ account, invoice: c.invoice, pi: `pi_test_${next()}` }));
    expect(res.status).toBeLessThan(300);
    expect(await books(c.invoice)).toEqual(PAID);
  });

  it("the same event delivered twice, and Stripe's second event for the same payment: still one payment", async () => {
    const account = `acct_test_${next()}`;
    const c = await company({ stripeAccount: account });
    const pay = { account, invoice: c.invoice, pi: `pi_test_${next()}` };
    const event = checkoutEvent(pay);
    await deliverStripe("connect", event);
    await deliverStripe("connect", event);
    await deliverStripe("connect", paymentIntentEvent(pay));
    expect(await books(c.invoice)).toEqual(PAID);
  });

  it("a tip paid with the invoice: the invoice is credited its own amount, the tip is recorded apart", async () => {
    const account = `acct_test_${next()}`;
    const c = await company({ stripeAccount: account });
    await deliverStripe("connect", checkoutEvent({ account, invoice: c.invoice, pi: `pi_test_${next()}`, amount: 16000, tip: 2000 }));
    expect(await books(c.invoice)).toEqual(PAID);
    expect(await tipsOn(c.invoice)).toBe(2000);
  });

  it("paid on a voided invoice (a checkout link made before the void): the money is on record, the invoice stays void", async () => {
    const account = `acct_test_${next()}`;
    const c = await company({ stripeAccount: account });
    await api.sql("update public.invoices set status = 'void', voided_at = now() where id = $1", [c.invoice]);
    await deliverStripe("connect", checkoutEvent({ account, invoice: c.invoice, pi: `pi_test_${next()}` }));
    expect(await books(c.invoice)).toEqual({ status: "void", payments: 1, paid: 14000 });
    expect(await toldOwner(c.org, "Payment on a voided invoice")).toBe(1);
  });

  it("an event from another company's Stripe account cannot pay this company's invoice", async () => {
    const mine = await company({ stripeAccount: `acct_test_${next()}` });
    const theirAccount = `acct_test_${next()}`;
    await company({ stripeAccount: theirAccount });
    await deliverStripe("connect", checkoutEvent({ account: theirAccount, invoice: mine.invoice, pi: `pi_test_${next()}` }));
    expect(await books(mine.invoice)).toEqual(UNPAID);
  });

  it("an event not signed by Stripe is turned away, and nothing is recorded", async () => {
    const account = `acct_test_${next()}`;
    const c = await company({ stripeAccount: account });
    const res = await deliverStripe("connect", checkoutEvent({ account, invoice: c.invoice, pi: `pi_test_${next()}` }), { badSignature: true });
    expect(res.status).toBe(400);
    expect(await books(c.invoice)).toEqual(UNPAID);
  });
});

describe.skipIf(!hasPostgrest)("card payments through Square", () => {
  it("a completed payment: paid once, even when Square sends it twice and as both 'created' and 'updated'", async () => {
    const merchant = `sq_merchant_${next()}`;
    const order = `sq_order_${next()}`;
    const c = await company({ squareMerchant: merchant, squareOrder: order });
    const payment = `sq_pay_${next()}`;
    const event = squarePaymentEvent({ merchant, order, payment });
    const res = await deliverSquare(event);
    expect(res.status).toBeLessThan(300);
    await deliverSquare(event);
    await deliverSquare(squarePaymentEvent({ merchant, order, payment, type: "payment.created" }));
    expect(await books(c.invoice)).toEqual(PAID);
  });

  it("a tip on a Square payment is recorded apart from the invoice", async () => {
    const merchant = `sq_merchant_${next()}`;
    const order = `sq_order_${next()}`;
    const c = await company({ squareMerchant: merchant, squareOrder: order });
    await deliverSquare(squarePaymentEvent({ merchant, order, payment: `sq_pay_${next()}`, total: 16000, tip: 2000 }));
    expect(await books(c.invoice)).toEqual(PAID);
    expect(await tipsOn(c.invoice)).toBe(2000);
  });

  it("refunded from Square: the invoice follows", async () => {
    const merchant = `sq_merchant_${next()}`;
    const order = `sq_order_${next()}`;
    const c = await company({ squareMerchant: merchant, squareOrder: order });
    const payment = `sq_pay_${next()}`;
    await deliverSquare(squarePaymentEvent({ merchant, order, payment }));
    await deliverSquare(squarePaymentEvent({ merchant, order, payment, refunded: 14000 }));
    expect(await books(c.invoice)).toEqual({ status: "refunded", payments: 1, paid: 0 });
  });

  it("a payment from another company's Square account cannot pay this company's invoice", async () => {
    const order = `sq_order_${next()}`;
    const mine = await company({ squareMerchant: `sq_merchant_${next()}`, squareOrder: order });
    const theirMerchant = `sq_merchant_${next()}`;
    await company({ squareMerchant: theirMerchant });
    await deliverSquare(squarePaymentEvent({ merchant: theirMerchant, order, payment: `sq_pay_${next()}` }));
    expect(await books(mine.invoice)).toEqual(UNPAID);
  });

  it("an event not signed by Square is turned away, and nothing is recorded", async () => {
    const merchant = `sq_merchant_${next()}`;
    const order = `sq_order_${next()}`;
    const c = await company({ squareMerchant: merchant, squareOrder: order });
    const res = await deliverSquare(squarePaymentEvent({ merchant, order, payment: `sq_pay_${next()}` }), { badSignature: true });
    expect(res.status).toBe(401);
    expect(await books(c.invoice)).toEqual(UNPAID);
  });
});

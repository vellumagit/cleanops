/**
 * The money and schedule flows at the same moment, on a real server
 * (vitest.load.config.ts): what happens when two things that each work
 * alone land together.
 *
 *   - Stripe's two events for one card payment, and the same event twice,
 *     arriving at the same instant.
 *   - The in-app refund's own reconcile and a late webhook writing different
 *     refund totals at once.
 *   - An owner voiding an invoice while the client's card payment lands.
 *   - Two "this and all future" moves of one series saved at once.
 */
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "../db/api";
import { addBooking, addClient, addMember, addOrg, type Member } from "../db/harness";
import { hasRealPostgres } from "../db/real-postgres";
import { as, form } from "./helpers";

vi.mock("next/headers", async () => (await import("../db/next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("../db/next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("../db/next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("../db/next-stubs")).nextServer(),
}));

const ROUNDS = 10;
const PLATFORM_SECRET = "whsec_test_sollos_platform";
const ready = hasPostgrest && hasRealPostgres;
const stripe = new Stripe("sk_test_sollos_not_real");
let api: Api;
let restoreEnv: () => void;
let platform: typeof import("@/app/api/stripe/webhook/route");

beforeAll(async () => {
  process.env.STRIPE_ENABLED = "true";
  process.env.STRIPE_SECRET_KEY ??= "sk_test_sollos_not_real";
  process.env.STRIPE_WEBHOOK_SECRET = PLATFORM_SECRET;
  if (!ready) return;
  api = await startApi();
  if (api.kind !== "postgres") throw new Error("the load tests must run on a real server (pnpm test:load)");
  restoreEnv = api.useAsSupabase();
  platform = await import("@/app/api/stripe/webhook/route");
});

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

let n = 0;
const next = () => `${++n}_${Date.now()}`;

async function cardCompany() {
  const org = await addOrg(api.sql, "Race Card Co");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  const owner = await addMember(api.sql, org, "owner", "Owner");
  return { org, owner, client: await addClient(api.sql, org) };
}

async function sentInvoice(c: { org: string; client: string }) {
  const [inv] = await api.sql<{ id: string }>(
    "insert into public.invoices (organization_id, client_id, status, amount_cents, sent_at, due_date) values ($1, $2, 'sent', 14000, now(), current_date + 14) returning id",
    [c.org, c.client],
  );
  return inv.id;
}

function stripeEvent(type: string, object: Record<string, unknown>) {
  return { id: `evt_race_${next()}`, object: "event", type, api_version: "2024-06-20", created: Math.floor(Date.now() / 1000), livemode: false, data: { object } };
}
const checkout = (org: string, invoice: string, pi: string) =>
  stripeEvent("checkout.session.completed", {
    id: `cs_race_${next()}`, object: "checkout.session", mode: "payment", payment_status: "paid", status: "complete",
    currency: "cad", amount_total: 14000, payment_intent: pi, metadata: { invoice_id: invoice, organization_id: org },
  });
const succeeded = (org: string, invoice: string, pi: string) =>
  stripeEvent("payment_intent.succeeded", {
    id: pi, object: "payment_intent", status: "succeeded", currency: "cad", amount: 14000, amount_received: 14000,
    application_fee_amount: 420, metadata: { invoice_id: invoice, organization_id: org },
  });
const refunded = (pi: string, cumulative: number) =>
  stripeEvent("charge.refunded", { id: `ch_race_${next()}`, object: "charge", payment_intent: pi, amount: 14000, amount_refunded: cumulative, refunded: true });

async function deliver(event: object) {
  const { NextRequest } = await import("next/server");
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: PLATFORM_SECRET } as Parameters<typeof stripe.webhooks.generateTestHeaderString>[0]);
  return platform.POST(
    new NextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": signature, "content-type": "application/json", "x-forwarded-for": `10.1.${n % 250}.${n % 200}` },
    }),
  );
}

const books = async (invoice: string) =>
  (
    await api.sql<{ status: string; voided: boolean; payments: number; held: number }>(
      `select i.status::text as status, i.voided_at is not null as voided,
              (select count(*)::int from public.invoice_payments p where p.invoice_id = i.id) as payments,
              (select coalesce(sum(amount_cents - refunded_cents), 0)::int from public.invoice_payments p where p.invoice_id = i.id) as held
         from public.invoices i where i.id = $1`,
      [invoice],
    )
  )[0];

describe.skipIf(!ready)("money and schedule flows at the same moment, on a real server", () => {
  it(`Stripe's two events for one payment, and one event twice, at the same instant, ${ROUNDS} invoices at once: each paid once`, async () => {
    const c = await cardCompany();
    const invoices = await Promise.all(Array.from({ length: ROUNDS }, () => sentInvoice(c)));
    await Promise.all(
      invoices.flatMap((invoice) => {
        const pi = `pi_race_${next()}`;
        const first = checkout(c.org, invoice, pi);
        return [deliver(first), deliver(first), deliver(succeeded(c.org, invoice, pi))];
      }),
    );
    const results = await Promise.all(invoices.map(books));
    expect(results).toEqual(invoices.map(() => ({ status: "paid", voided: false, payments: 1, held: 14000 })));
  });

  it(`the in-app refund's reconcile and a late webhook writing different totals at once, ${ROUNDS} times: the full refund stands`, async () => {
    const c = await cardCompany();
    const paid = await Promise.all(
      Array.from({ length: ROUNDS }, async () => {
        const invoice = await sentInvoice(c);
        const pi = `pi_race_${next()}`;
        await deliver(checkout(c.org, invoice, pi));
        return { invoice, pi };
      }),
    );
    await Promise.all(paid.flatMap(({ pi }) => [deliver(refunded(pi, 14000)), deliver(refunded(pi, 4000))]));
    const results = await Promise.all(paid.map(({ invoice }) => books(invoice)));
    expect(results).toEqual(paid.map(() => ({ status: "refunded", voided: false, payments: 1, held: 0 })));
  });

  it(`an owner voids an invoice as the client's card payment lands, ${ROUNDS} times: never half of each`, async () => {
    const c = await cardCompany();
    const { voidInvoiceAction } = await import("@/app/app/invoices/actions");
    const invoices = await Promise.all(Array.from({ length: ROUNDS }, () => sentInvoice(c)));
    await Promise.all(
      invoices.flatMap((invoice) => [
        as(api, c.owner, () => voidInvoiceAction(form({ id: invoice }))),
        deliver(checkout(c.org, invoice, `pi_race_${next()}`)),
      ]),
    );
    for (const invoice of invoices) {
      const b = await books(invoice);
      // The money is always on record. Voided first: the invoice stays void
      // (and the owner is told to refund). Paid first: the void is refused.
      expect(b.payments, invoice.slice(0, 8)).toBe(1);
      expect(b.status, `${invoice.slice(0, 8)} ${JSON.stringify(b)}`).toBe(b.voided ? "void" : "paid");
    }
  });

  it("two 'this and all future' moves of one series saved at once, in five series: one wins whole, no day doubled", async () => {
    const DAY = 86_400_000;
    const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    let base = today + 7 * DAY;
    while (new Date(base).getUTCDay() !== 4) base += DAY;
    const { updateBookingAction } = await import("@/app/app/bookings/actions");

    const series = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const org = await addOrg(api.sql, "Race Series Co");
        await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
        const client = await addClient(api.sql, org);
        const owner = await addMember(api.sql, org, "owner", "Owner");
        const admin = await addMember(api.sql, org, "admin", "Admin");
        const anna = await addMember(api.sql, org, "employee", "Anna");
        const [service] = await api.sql<{ id: string }>("insert into public.service_types (organization_id, name) values ($1, 'Standard clean') returning id", [org]);
        const [s] = await api.sql<{ id: string }>(
          `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes, assigned_to, total_cents)
           values ($1, $2, 'weekly', '09:00', $3, 120, $4, 14000) returning id`,
          [org, client, ymd(base), anna.membershipId],
        );
        const visits: string[] = [];
        for (let w = 0; w < 4; w++) {
          const id = await addBooking(api.sql, org, client, { scheduledAt: `${ymd(base + w * 7 * DAY)}T09:00:00.000Z`, durationMinutes: 120, status: "confirmed" });
          await api.sql("update public.bookings set series_id = $2, assigned_to = $3, total_cents = 14000, service_type_id = $4 where id = $1", [id, s.id, anna.membershipId, service.id]);
          await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status) values ($1, $2, $3, true, 'accepted')", [org, id, anna.membershipId]);
          visits.push(id);
        }
        return { org, client, owner, admin, anna, service: service.id, series: s.id, visits };
      }),
    );

    const move = (s: (typeof series)[number], who: Member, toDay: string) =>
      as(api, who, () =>
        updateBookingAction(
          s.visits[1],
          {},
          form({
            client_id: s.client, assigned_to: s.anna.membershipId, scheduled_at: `${toDay}T09:00`, duration_minutes: "120",
            service_type: "standard", service_type_id: s.service, service_type_label: "Standard clean", status: "confirmed",
            total_cents: "140", splits: "[]", notify_client: "0", update_scope: "this_and_future", series_id: s.series,
            series_scheduled_at: `${ymd(base + 7 * DAY)}T09:00:00.000Z`, series_update_schedule: "1", series_pattern: "weekly",
            series_start_time: "09:00", series_starts_at: ymd(base + 7 * DAY), series_ends_at: "",
          }),
        ),
      );
    const wednesday = ymd(base + 6 * DAY);
    const friday = ymd(base + 8 * DAY);
    await Promise.all(series.flatMap((s) => [move(s, s.owner, wednesday), move(s, s.admin, friday)]));

    for (const s of series) {
      const rows = await api.sql<{ date: string; dow: number }>(
        `select to_char(scheduled_at, 'YYYY-MM-DD') as date, extract(dow from scheduled_at)::int as dow
           from public.bookings where series_id = $1 and status <> 'cancelled' order by scheduled_at`,
        [s.series],
      );
      const [edited] = await api.sql<{ dow: number }>("select extract(dow from scheduled_at)::int as dow from public.bookings where id = $1", [s.visits[1]]);
      expect([3, 5], "the edited visit is on one of the two days asked for").toContain(edited.dow);
      expect(rows[0].date, "the visit before it is untouched").toBe(ymd(base));
      const later = rows.filter((r) => r.date > ymd(base + 8 * DAY));
      expect(later.length).toBeGreaterThanOrEqual(2);
      expect(later.map((r) => r.dow), `${s.series.slice(0, 8)}: every later visit follows the winner`).toEqual(later.map(() => edited.dow));
      expect(new Set(rows.map((r) => r.date)).size, "no day doubled").toBe(rows.length);
    }
  });
});

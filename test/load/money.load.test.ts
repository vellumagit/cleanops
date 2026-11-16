/**
 * Money and crews, when two people act at the same moment.
 *
 * Each of these is a click that is fine alone and wrong twice at once: two
 * people billing the same jobs, two payments landing together, two cleaners
 * claiming the last spot, a pay period prepared twice, two crews saved on
 * one job. On a real server (vitest.load.config.ts).
 *
 * A race that passes once may only have missed its window, so each runs
 * ROUNDS copies at the same time; where the window can be forced open, the
 * test steps two database connections by hand instead.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "../db/api";
import { addBooking, addClient, addMember, type Member } from "../db/harness";
import { hasRealPostgres } from "../db/real-postgres";
import { as, company, daysAgoYmd, form, job, people, sleep, timing } from "./helpers";

vi.mock("next/headers", async () => (await import("../db/next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("../db/next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("../db/next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("../db/next-stubs")).nextServer(),
}));

const ROUNDS = 10;
const ready = hasPostgrest && hasRealPostgres;
let api: Api;
let restoreEnv: () => void;
let invoices: typeof import("@/app/app/invoices/actions");
let bookings: typeof import("@/app/app/bookings/actions");
let payroll: typeof import("@/app/app/payroll/actions");
let claim: typeof import("@/app/claim/[token]/actions");

beforeAll(async () => {
  if (!ready) return;
  api = await startApi();
  if (api.kind !== "postgres") throw new Error("the load tests must run on a real server (pnpm test:load)");
  restoreEnv = api.useAsSupabase();
  invoices = await import("@/app/app/invoices/actions");
  bookings = await import("@/app/app/bookings/actions");
  payroll = await import("@/app/app/payroll/actions");
  claim = await import("@/app/claim/[token]/actions");
});

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

const rounds = <T>(fn: (round: number) => Promise<T>) => Promise.all(Array.from({ length: ROUNDS }, (_, i) => fn(i)));
const short = (r: unknown) => JSON.stringify(r).slice(0, 180);

/** Live invoices that bill this job, by any of the three records (billed-bookings.ts). */
async function liveInvoicesFor(jobId: string): Promise<number> {
  const [{ n }] = await api.sql<{ n: number }>(
    `select count(distinct i.id)::int as n
       from public.invoices i
      where i.status <> 'void'
        and (i.booking_id = $1
             or exists (select 1 from public.invoice_line_items li where li.invoice_id = i.id and li.booking_id = $1)
             or exists (select 1 from public.bookings b where b.id = $1 and b.billing_invoice_id = i.id))`,
    [jobId],
  );
  return n;
}

async function sentInvoice(org: string, client: string, cents: number): Promise<string> {
  const [inv] = await api.sql<{ id: string }>(
    `insert into public.invoices (organization_id, client_id, status, amount_cents, sent_at, due_date)
     values ($1, $2, 'sent', $3, now(), current_date + 14) returning id`,
    [org, client, cents],
  );
  return inv.id;
}

describe.skipIf(!ready)("two people at the same moment, on a real server", () => {
  it(`Bill for a period submitted twice at once, ${ROUNDS} times over: every job ends up on one live invoice`, async () => {
    const c = await company(api, "Bill Co");
    const [admin] = await people(api, c.org, 1, "Admin", "admin");
    const outcomes = await rounds(async (i) => {
      const client = await addClient(api.sql, c.org, `Billed ${i}`);
      const jobs = [3, 2].map(() => "");
      for (const [k, daysBack] of [3, 2].entries()) {
        jobs[k] = await job(api, c.org, client, [], { startedMinutesAgo: daysBack * 24 * 60, minutes: 120, status: "completed", totalCents: 14000 });
      }
      const submit = (who: Member) =>
        as(api, who, () =>
          invoices.createPeriodInvoiceAction(
            {},
            form({
              client_id: client,
              line_items_json: JSON.stringify(
                jobs.map((id, k) => ({ label: `Standard clean ${k + 1}`, quantity: "1", unit_price_dollars: "140.00", booking_id: id })),
              ),
              absorb_invoice_ids: "[]",
            }),
          ),
        );
      const answers = await Promise.all([submit(c.owner), submit(admin)]);
      return { jobs, answers: answers.map((a) => a.result) };
    });

    for (const o of outcomes) {
      const counts = await Promise.all(o.jobs.map(liveInvoicesFor));
      expect(counts, `live invoices per job; the two submissions answered:\n  ${o.answers.map(short).join("\n  ")}`).toEqual([1, 1]);
      // One made the invoice; the other was told, in words, that nothing was created.
      const made = o.answers.filter((a) => typeof a === "string" && a.startsWith("redirected to /app/invoices/")).length;
      expect(made, o.answers.map(short).join(" | ")).toBe(1);
    }
  });

  it("two payments on one invoice, the second saved while the first is still open: the invoice ends up paid", async () => {
    const c = await company(api, "Pay Co");
    const id = await sentInvoice(c.org, c.client, 20000);
    // Stepped by hand on two connections, so the overlap is certain.
    const one = await api.real!.pool.connect();
    const two = await api.real!.pool.connect();
    const insert = `insert into public.invoice_payments (organization_id, invoice_id, amount_cents, method, received_at) values ($1, $2, 10000, 'cash', now())`;
    const steps: string[] = [];
    try {
      await one.query("begin");
      await two.query("begin");
      await one.query(insert, [c.org, id]);
      const second = two.query(insert, [c.org, id]).then(
        () => "saved",
        (err: { code?: string }) => `refused ${err.code}`,
      );
      steps.push(`second, while the first is open: ${await Promise.race([second, sleep(1500).then(() => "waiting")])}`);
      await one.query("commit");
      steps.push(`second, after the first commits: ${await second}`);
      await two.query("commit");
    } finally {
      one.release();
      two.release();
    }
    const [row] = await api.sql<{ status: string; paid: number }>(
      `select status::text as status,
              (select coalesce(sum(amount_cents), 0)::int from public.invoice_payments where invoice_id = $1) as paid
         from public.invoices where id = $1`,
      [id],
    );
    expect(row, steps.join("; ")).toEqual({ status: "paid", paid: 20000 });
  });

  it(`two payments recorded through the app on one invoice at once, ${ROUNDS} times over: each ends up paid`, async () => {
    const c = await company(api, "Pay App Co");
    const [admin] = await people(api, c.org, 1, "Admin", "admin");
    const outcomes = await rounds(async (i) => {
      const id = await sentInvoice(c.org, c.client, 20000);
      // Two genuinely different payments (cash and a cheque): the same
      // amount, method and time would be refused as a double-click.
      const pay = (who: Member, method: string, ref: string) =>
        as(api, who, () =>
          invoices.recordInvoicePaymentAction(
            id,
            {},
            form({ amount_dollars: "100.00", method, reference: `${ref} ${i}`, received_at: daysAgoYmd(0), notes: "" }),
          ),
        );
      const answers = await Promise.all([pay(c.owner, "cash", "first half"), pay(admin, "check", "second half")]);
      return { id, answers: answers.map((a) => a.result) };
    });
    for (const o of outcomes) {
      const [row] = await api.sql<{ status: string; paid: number }>(
        `select status::text as status,
                (select coalesce(sum(amount_cents), 0)::int from public.invoice_payments where invoice_id = $1) as paid
           from public.invoices where id = $1`,
        [o.id],
      );
      expect(row, o.answers.map(short).join(" | ")).toEqual({ status: "paid", paid: 20000 });
    }
  });

  it(`two cleaners claim the one open spot at the same instant, ${ROUNDS} times over: exactly one gets each`, async () => {
    const c = await company(api, "Claim Co");
    const outcomes = await rounds(async (i) => {
      const [vira, olha] = await people(api, c.org, 2, `Claimer ${i}`);
      const at = new Date(Date.now() + (2 + i) * 86_400_000).toISOString();
      const spot = await addBooking(api.sql, c.org, c.client, { scheduledAt: at, durationMinutes: 120, status: "confirmed" });
      const [offer] = await api.sql<{ id: string }>(
        `insert into public.job_offers (organization_id, booking_id, posted_by, pay_cents, status, positions_needed, positions_filled)
         values ($1, $2, $3, 0, 'open', 1, 0) returning id`,
        [c.org, spot, c.owner.membershipId],
      );
      const tokens = [`loadclaim${i}a${Date.now()}`, `loadclaim${i}b${Date.now()}`];
      for (const [k, who] of [vira, olha].entries()) {
        await api.sql(
          `insert into public.job_offer_dispatches (organization_id, offer_id, membership_id, claim_token) values ($1, $2, $3, $4)`,
          [c.org, offer.id, who.membershipId, tokens[k]],
        );
      }
      const answers = await Promise.all(tokens.map((t) => claim.claimOfferAction(t)));
      return { offer: offer.id, answers };
    });
    for (const o of outcomes) {
      const winners = o.answers.filter((r) => (r as { ok?: boolean }).ok).length;
      const [row] = await api.sql<{ filled: number; crew: number }>(
        `select o.positions_filled as filled,
                (select count(*)::int from public.booking_assignees a where a.booking_id = o.booking_id) as crew
           from public.job_offers o where o.id = $1`,
        [o.offer],
      );
      expect({ winners, ...row }, short(o.answers)).toEqual({ winners: 1, filled: 1, crew: 1 });
    }
  });

  it(`the same pay period prepared twice at once, in ${ROUNDS} companies at once: every shift is paid exactly once`, async () => {
    const outcomes = await rounds(async (i) => {
      const c = await company(api, `Payroll Co ${i}`);
      const [admin] = await people(api, c.org, 1, "Admin", "admin");
      const anna = await addMember(api.sql, c.org, "employee", "Anna Employee");
      const vira = await addMember(api.sql, c.org, "employee", "Vira Contractor");
      await api.sql("update public.memberships set pay_rate_cents = 2000, engagement = 'employee' where id = $1", [anna.membershipId]);
      await api.sql("update public.memberships set pay_rate_cents = 1800, engagement = 'subcontractor' where id = $1", [vira.membershipId]);
      for (const [who, rate, eng] of [
        [anna, 2000, "employee"],
        [vira, 1800, "subcontractor"],
      ] as const) {
        for (const d of [6, 5, 4]) {
          const start = new Date(`${daysAgoYmd(d)}T15:00:00Z`);
          await api.sql(
            `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, engagement_snapshot)
             values ($1, $2, $3, $4, $5, $6)`,
            [c.org, who.membershipId, start.toISOString(), new Date(start.getTime() + 3 * 3_600_000).toISOString(), rate, eng],
          );
        }
      }
      const prepare = (who: Member) =>
        as(api, who, () => payroll.preparePeriodAction(form({ period_start: daysAgoYmd(10), period_end: daysAgoYmd(1) })));
      const answers = await Promise.all([prepare(c.owner), prepare(admin)]);
      return { org: c.org, answers: answers.map((a) => a.result) };
    });
    for (const o of outcomes) {
      const [row] = await api.sql<{ unpaid: number; payroll_runs: number; statements: number; payroll_items: number; statement_items: number }>(
        `select (select count(*)::int from public.time_entries where organization_id = $1 and payroll_run_id is null and subcontractor_run_id is null) as unpaid,
                (select count(*)::int from public.payroll_runs where organization_id = $1) as payroll_runs,
                (select count(*)::int from public.subcontractor_pay_runs where organization_id = $1) as statements,
                (select count(*)::int from public.payroll_items where organization_id = $1) as payroll_items,
                (select count(*)::int from public.subcontractor_pay_items where organization_id = $1) as statement_items`,
        [o.org],
      );
      expect(row, o.answers.map(short).join(" | ")).toEqual({ unpaid: 0, payroll_runs: 1, statements: 1, payroll_items: 1, statement_items: 1 });
    }
  });

  it(`two managers save different crews on one job at the same moment, ${ROUNDS} jobs at once: each job ends up with one of them, whole`, async () => {
    const c = await company(api, "Crew Co");
    const managers = await people(api, c.org, 2, "Manager", "manager");
    const t0 = performance.now();
    const outcomes = await rounds(async (i) => {
      const [a, b, d] = await people(api, c.org, 3, `Crew ${i}`);
      const at = new Date(Date.now() + (3 + i) * 86_400_000).toISOString();
      const id = await job(api, c.org, c.client, [a], { at, minutes: 120 });
      const save = (who: Member, lead: Member) =>
        as(api, who, () => bookings.assignBookingCrewAction({}, form({ id, primary_id: lead.membershipId, update_scope: "this_only" })));
      const answers = await Promise.all([save(managers[0], b), save(managers[1], d)]);
      return { id, choices: [[b.membershipId], [d.membershipId]], answers };
    });
    console.log(timing(`${ROUNDS * 2} crew saves, two per job`, outcomes.flatMap((o) => o.answers.map((a) => a.ms)), performance.now() - t0));
    for (const o of outcomes) {
      const crew = await api.sql<{ membership_id: string }>(
        "select membership_id from public.booking_assignees where booking_id = $1 order by membership_id",
        [o.id],
      );
      const [{ assigned_to }] = await api.sql<{ assigned_to: string | null }>("select assigned_to from public.bookings where id = $1", [o.id]);
      const ids = crew.map((r) => r.membership_id);
      const detail = `crew ${JSON.stringify(ids)}, lead ${assigned_to}; answers: ${o.answers.map((a) => short(a.result)).join(" | ")}`;
      // One of the two saves, whole: never both, never neither, never a lead who isn't on the crew.
      expect(o.choices, detail).toContainEqual(ids);
      expect(assigned_to, detail).toBe(ids[0]);
    }
  });
});

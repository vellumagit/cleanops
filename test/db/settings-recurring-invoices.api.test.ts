/**
 * Settings → Recurring invoices, pressed the way the office presses them, and
 * the nightly job that turns each standing series into a real invoice, against
 * a real database behind the real PostgREST. Outbound email is caught.
 *
 *   the series form     make, edit, pause, resume, delete
 *   the nightly job     one invoice per period, never twice; paused, future
 *                       and switched-off series wait; a client on a billing
 *                       cycle is held and the office told
 *
 * These make real money documents for Svit, so the checks that matter: a
 * series bills the client it names in this company and nobody else, each
 * period is billed once, the date the office picks is the date it runs in
 * the company's own calendar, and a save that saved nothing says so.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

type Sent = { to: string; subject: string; html?: string };
const outbox = vi.hoisted(() => ({ email: [] as Sent[] }));
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
  sendEmail: async (a: Sent) => {
    outbox.email.push(a);
    return true;
  },
  sendOrgEmail: async (_o: string, a: Sent) => {
    outbox.email.push(a);
    return true;
  },
  sendOrgEmailDetailed: async (_o: string, a: Sent) => {
    outbox.email.push(a);
    return { ok: true };
  },
}));

const series = await import("@/app/app/settings/recurring-invoices/actions");
const { GET: recurringCron } = await import("@/app/api/cron/recurring-invoices/route");

let api: Api;
let restoreEnv: () => void;
const CRON_SECRET = "recurring-invoices-test-cron-secret";

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  process.env.CRON_SECRET = CRON_SECRET;
}, 240_000);

afterAll(async () => {
  vi.useRealTimers();
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  outbox.email.length = 0;
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

async function runCron(auth = `Bearer ${CRON_SECRET}`) {
  const res = await recurringCron(new NextRequest("http://localhost/api/cron/recurring-invoices", { headers: { authorization: auth } }));
  await settle();
  return res;
}

const ON = { auto_recurring_invoices: { enabled: true } };

async function company(settings: Record<string, unknown> = ON) {
  const org = await addOrg(api.sql, "Standing Co");
  await api.sql(
    `update public.organizations
        set timezone = 'America/Regina', automations_enabled = true, automation_settings = $2::jsonb,
            created_at = now() - interval '60 days'
      where id = $1`,
    [org, JSON.stringify(settings)],
  );
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    olha: await addMember(api.sql, org, "manager", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
}
type Co = Awaited<ReturnType<typeof company>>;

const seriesForm = (client: string, over: Record<string, string> = {}) =>
  form({
    client_id: client,
    name: "Monthly retainer",
    cadence: "monthly",
    amount_dollars: "450.00",
    due_days: "14",
    next_run_at: "2026-12-01",
    notes: "",
    line_items: "",
    ...over,
  });

type SeriesRow = {
  id: string;
  client_id: string;
  name: string;
  cadence: string;
  amount_cents: number;
  due_days: number;
  active: boolean;
  next_run_at: string;
  local_day: string;
  last_invoice_id: string | null;
  created_by: string | null;
  notes: string | null;
};
const seriesRows = (org: string) =>
  api.sql<SeriesRow>(
    `select id, client_id, name, cadence, amount_cents, due_days, active, next_run_at::text as next_run_at,
            to_char(next_run_at at time zone 'America/Regina', 'YYYY-MM-DD') as local_day,
            last_invoice_id, created_by, notes
       from public.invoice_series where organization_id = $1 order by created_at`,
    [org],
  );
const seriesRow = async (id: string) =>
  (
    await api.sql<SeriesRow>(
      `select id, client_id, name, cadence, amount_cents, due_days, active, next_run_at::text as next_run_at,
              to_char(next_run_at at time zone 'America/Regina', 'YYYY-MM-DD') as local_day,
              last_invoice_id, created_by, notes
         from public.invoice_series where id = $1`,
      [id],
    )
  )[0];

/** A standing series as it sits in the table, by default due an hour ago. */
async function standing(c: Co, client: string, over: Record<string, unknown> = {}) {
  const cols: Record<string, unknown> = {
    name: "Office retainer",
    cadence: "monthly",
    amount_cents: 45000,
    due_days: 14,
    next_run_at: new Date(Date.now() - 3_600_000).toISOString(),
    active: true,
    line_items: [],
    notes: null,
    ...over,
  };
  const keys = Object.keys(cols);
  const cast = (k: string) => (k === "line_items" ? "::jsonb" : k === "next_run_at" ? "::timestamptz" : "");
  const [row] = await api.sql<{ id: string }>(
    `insert into public.invoice_series (organization_id, client_id, ${keys.join(", ")})
     values ($1, $2, ${keys.map((k, i) => `$${i + 3}${cast(k)}`).join(", ")}) returning id`,
    [c.org, client, ...keys.map((k) => (k === "line_items" ? JSON.stringify(cols[k]) : cols[k]))],
  );
  return row.id;
}

const invoicesFor = (client: string) =>
  api.sql<{ id: string; organization_id: string; status: string; amount_cents: number; due_date: string; notes: string | null; number: string | null }>(
    `select id, organization_id, status::text as status, amount_cents, due_date::text as due_date, notes, number
       from public.invoices where client_id = $1 order by created_at`,
    [client],
  );
const linesFor = (invoice: string) =>
  api.sql<{ label: string; quantity: string; unit_price_cents: number }>(
    "select label, quantity::text as quantity, unit_price_cents from public.invoice_line_items where invoice_id = $1 order by sort_order",
    [invoice],
  );

describe.skipIf(!hasPostgrest)("the recurring invoice form", { timeout: 90_000 }, () => {
  it("the office makes a series for its own client, and a cleaner can't", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Acme Offices");

    const res = await as(c.owner, () => series.createRecurringInvoiceAction({}, seriesForm(client, { amount_dollars: "1,250.50" })));
    expect(res, api.log()).toEqual({ redirected: "/app/settings/recurring-invoices" });
    const [made] = await seriesRows(c.org);
    expect(made).toMatchObject({
      client_id: client,
      name: "Monthly retainer",
      cadence: "monthly",
      amount_cents: 125050,
      due_days: 14,
      active: true,
      created_by: c.owner.membershipId,
      last_invoice_id: null,
    });

    // A manager runs the money side unless someone switched it off for her.
    expect(await as(c.olha, () => series.createRecurringInvoiceAction({}, seriesForm(client, { name: "Olha's series" })))).toEqual({
      redirected: "/app/settings/recurring-invoices",
    });
    expect(await as(c.anna, () => series.createRecurringInvoiceAction({}, seriesForm(client, { name: "Anna's series" })))).toEqual({
      errors: { _form: "Not authorized." },
    });
    expect((await seriesRows(c.org)).map((s) => s.name)).toEqual(["Monthly retainer", "Olha's series"]);
  });

  it("refuses a form it can't bill from, and keeps what was typed", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Typo Client");
    const bad = (await as(c.owner, () => series.createRecurringInvoiceAction({}, seriesForm(client, { line_items: "[{oops" })))) as {
      errors?: Record<string, string>;
      values?: Record<string, string>;
    };
    expect(bad.errors?.line_items).toBe("Line items is not valid JSON");
    expect(bad.values?.name).toBe("Monthly retainer");
    const notArray = (await as(c.owner, () => series.createRecurringInvoiceAction({}, seriesForm(client, { line_items: '{"label":"x"}' })))) as {
      errors?: Record<string, string>;
    };
    expect(notArray.errors?.line_items).toBe("Line items must be a JSON array");
    const noClient = (await as(c.owner, () => series.createRecurringInvoiceAction({}, seriesForm("")))) as { errors?: Record<string, string> };
    expect(noClient.errors?.client_id).toBe("Pick a client");
    const noDate = (await as(c.owner, () => series.createRecurringInvoiceAction({}, seriesForm(client, { next_run_at: "" })))) as {
      errors?: Record<string, string>;
    };
    expect(noDate.errors?.next_run_at).toBe("Pick a start date");
    expect(await seriesRows(c.org)).toEqual([]);
  });

  it("never makes a series for another company's client", async () => {
    const c = await company();
    const other = await company();
    const theirs = await addClient(api.sql, other.org, "Their Client");
    const res = await as(c.owner, () => series.createRecurringInvoiceAction({}, seriesForm(theirs)));
    const made = await api.sql("select 1 from public.invoice_series where client_id = $1", [theirs]);
    // A series like this stops the nightly job (see the last test): keep it out of later runs.
    await api.sql("update public.invoice_series set active = false where client_id = $1", [theirs]);
    expect(made, "no series pointing at their client").toHaveLength(0);
    expect(res).toMatchObject({ errors: expect.any(Object) });
  });

  it("a manager with Invoices & estimates switched off can't make a standing invoice", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Narrowed Client");
    await api.sql(`update public.memberships set capabilities = '{"invoicing": false}'::jsonb where id = $1`, [c.olha.membershipId]);
    const res = await as(c.olha, () => series.createRecurringInvoiceAction({}, seriesForm(client)));
    expect(await seriesRows(c.org), "nothing saved").toEqual([]);
    expect(res).toMatchObject({ errors: { _form: expect.any(String) } });
  });

  it("the first invoice date the office picks is that date in the company's own calendar", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Calendar Client");
    await as(c.owner, () => series.createRecurringInvoiceAction({}, seriesForm(client, { next_run_at: "2026-12-01" })));
    const [made] = await seriesRows(c.org);
    expect(made.local_day, `stored as ${made.next_run_at}`).toBe("2026-12-01");
  });

  it("an edit lands for the office, and never on another company's series", async () => {
    const c = await company();
    const other = await company();
    const client = await addClient(api.sql, c.org, "Edit Client");
    const id = await standing(c, client, { next_run_at: "2026-12-01T06:00:00Z" });
    const theirClient = await addClient(api.sql, other.org, "Their Edit Client");
    const theirs = await standing(other, theirClient, { next_run_at: "2026-12-01T06:00:00Z" });

    const res = await as(c.olha, () =>
      series.updateRecurringInvoiceAction(
        id,
        {},
        seriesForm(client, { name: "Quarterly deep clean", cadence: "quarterly", amount_dollars: "900", due_days: "30", notes: "Net 30" }),
      ),
    );
    expect(res, api.log()).toEqual({ redirected: "/app/settings/recurring-invoices" });
    expect(await seriesRow(id)).toMatchObject({ name: "Quarterly deep clean", cadence: "quarterly", amount_cents: 90000, due_days: 30, notes: "Net 30" });

    expect(await as(c.anna, () => series.updateRecurringInvoiceAction(id, {}, seriesForm(client, { name: "Anna" })))).toEqual({
      errors: { _form: "Not authorized." },
    });
    await as(c.owner, () => series.updateRecurringInvoiceAction(theirs, {}, seriesForm(client, { name: "Hijacked", amount_dollars: "1" })));
    expect(await seriesRow(theirs)).toMatchObject({ name: "Office retainer", amount_cents: 45000, client_id: theirClient });
    expect((await seriesRow(id)).name).toBe("Quarterly deep clean");
  });

  it("a save that matched no series says so instead of going back to the list as if saved", async () => {
    const c = await company();
    const other = await company();
    const client = await addClient(api.sql, c.org, "Gone Client");
    const theirs = await standing(other, await addClient(api.sql, other.org, "Their Gone"), { next_run_at: "2026-12-01T06:00:00Z" });
    const res = await as(c.owner, () => series.updateRecurringInvoiceAction(theirs, {}, seriesForm(client)));
    expect(res).toMatchObject({ errors: { _form: expect.any(String) } });
  });

  it("pause and resume flip only this company's series, and a double press doesn't undo itself", async () => {
    const c = await company();
    const other = await company();
    const id = await standing(c, await addClient(api.sql, c.org, "Pause Client"), { next_run_at: "2026-12-01T06:00:00Z" });
    const theirs = await standing(other, await addClient(api.sql, other.org, "Their Pause"), { next_run_at: "2026-12-01T06:00:00Z" });

    // Two clicks on the same "Pause" button both carry active=true.
    await as(c.olha, () => series.toggleRecurringInvoiceAction(form({ id, active: "true" })));
    await as(c.olha, () => series.toggleRecurringInvoiceAction(form({ id, active: "true" })));
    expect((await seriesRow(id)).active).toBe(false);
    await as(c.owner, () => series.toggleRecurringInvoiceAction(form({ id, active: "false" })));
    expect((await seriesRow(id)).active).toBe(true);

    await as(c.anna, () => series.toggleRecurringInvoiceAction(form({ id, active: "true" })));
    expect((await seriesRow(id)).active, "a cleaner can't pause billing").toBe(true);
    await as(c.owner, () => series.toggleRecurringInvoiceAction(form({ id: theirs, active: "true" })));
    expect((await seriesRow(theirs)).active, "another company's series is out of reach").toBe(true);
  });

  it("the owner deletes a series, and nothing of another company's goes with it", async () => {
    const c = await company();
    const other = await company();
    const id = await standing(c, await addClient(api.sql, c.org, "Delete Client"), { next_run_at: "2026-12-01T06:00:00Z" });
    const theirs = await standing(other, await addClient(api.sql, other.org, "Their Delete"), { next_run_at: "2026-12-01T06:00:00Z" });

    await as(c.anna, () => series.deleteRecurringInvoiceAction(form({ id })));
    expect(await seriesRow(id), "a cleaner can't").toBeTruthy();
    await as(c.owner, () => series.deleteRecurringInvoiceAction(form({ id: theirs })));
    expect(await seriesRow(theirs)).toBeTruthy();
    await as(c.owner, () => series.deleteRecurringInvoiceAction(form({ id })));
    expect(await seriesRow(id)).toBeUndefined();
  });
});

describe.skipIf(!hasPostgrest)("the nightly recurring invoice job", { timeout: 120_000 }, () => {
  it("is shut to anyone without the cron secret", async () => {
    expect((await runCron("")).status).toBe(401);
    expect((await runCron("Bearer not-the-secret-at-all")).status).toBe(401);
  });

  it("makes one invoice for a due series, with its lines and notes, and not again on a second run", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Due Client");
    const before = new Date(Math.floor((Date.now() - 3_600_000) / 1000) * 1000);
    const id = await standing(c, client, {
      next_run_at: before.toISOString(),
      notes: "Thank you for your business",
      line_items: [
        { label: "Office cleaning retainer", quantity: 1, unit_price_cents: 40000 },
        { label: "Supplies", quantity: 2, unit_price_cents: 2500 },
      ],
    });

    const res = await runCron();
    expect(res.status, api.log()).toBe(200);
    const [inv, ...more] = await invoicesFor(client);
    expect(more, "one invoice").toEqual([]);
    expect(inv).toMatchObject({ organization_id: c.org, status: "draft", amount_cents: 45000, notes: "Thank you for your business" });
    expect(inv.number).toMatch(/^INV-/);
    // Fourteen days on, counted from the day it ran (UTC or the company's: the
    // date-boundary case is pinned on its own below).
    const day = (d: Date, tz: string) => d.toLocaleDateString("en-CA", { timeZone: tz });
    const in14 = new Date(Date.now() + 14 * 86_400_000);
    expect([day(in14, "UTC"), day(in14, "America/Regina")]).toContain(inv.due_date);
    expect(await linesFor(inv.id)).toEqual([
      { label: "Office cleaning retainer", quantity: "1.00", unit_price_cents: 40000 },
      { label: "Supplies", quantity: "2.00", unit_price_cents: 2500 },
    ]);

    const after = await seriesRow(id);
    expect(after.last_invoice_id).toBe(inv.id);
    const nextMonth = new Date(before);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    expect(new Date(after.next_run_at).toISOString()).toBe(nextMonth.toISOString());

    expect((await runCron()).status).toBe(200);
    expect(await invoicesFor(client), "the second run doesn't bill the period again").toHaveLength(1);
  });

  it("a series with no lines bills one line for the full amount", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Plain Client");
    await standing(c, client, { name: "Plain retainer", amount_cents: 30000 });
    await runCron();
    const [inv] = await invoicesFor(client);
    expect(await linesFor(inv.id)).toEqual([{ label: "Plain retainer", quantity: "1.00", unit_price_cents: 30000 }]);
  });

  it("leaves a paused series, a future one, and a company that switched it off alone", async () => {
    const c = await company();
    const paused = await addClient(api.sql, c.org, "Paused Client");
    const future = await addClient(api.sql, c.org, "Future Client");
    await standing(c, paused, { active: false });
    await standing(c, future, { next_run_at: new Date(Date.now() + 86_400_000).toISOString() });
    const off = await company({ auto_recurring_invoices: { enabled: false } });
    const offClient = await addClient(api.sql, off.org, "Switched Off Client");
    const offSeries = await standing(off, offClient);
    const offBefore = (await seriesRow(offSeries)).next_run_at;

    expect((await runCron()).status).toBe(200);
    expect(await invoicesFor(paused)).toEqual([]);
    expect(await invoicesFor(future)).toEqual([]);
    expect(await invoicesFor(offClient)).toEqual([]);
    expect((await seriesRow(offSeries)).next_run_at, "its period waits for it to be switched on").toBe(offBefore);
    await api.sql("update public.invoice_series set active = false where id = $1", [offSeries]);
  });

  it("holds a client already on a billing cycle, and tells the office once for the period", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Cycle Client");
    await api.sql("update public.clients set billing_cadence = 'monthly' where id = $1", [client]);
    await standing(c, client, { name: "Cycle retainer" });

    await runCron();
    await runCron();
    expect(await invoicesFor(client), "the cycle already bills them").toEqual([]);
    const held = await api.sql<{ r: string | null; body: string }>(
      "select recipient_membership_id as r, body from public.notifications where organization_id = $1 and title = 'Standing invoice held — client is on a billing cycle'",
      [c.org],
    );
    expect(held.length).toBeGreaterThan(0);
    expect(held.map((h) => h.r), "not the cleaners").not.toContain(c.anna.membershipId);
    expect(new Set(held.map((h) => h.r)).size, "once per person for the period, not once per run").toBe(held.length);
    expect(held[0].body).toContain("Cycle retainer");
  });

  it("a series written the way the form's example shows bills lines that add up to the invoice", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Example Client");
    const example = '[{"description":"Office cleaning retainer","quantity":1,"unit_cents":50000}]';
    const made = await as(c.owner, () =>
      series.createRecurringInvoiceAction({}, seriesForm(client, { amount_dollars: "500", next_run_at: "2026-11-01", line_items: example })),
    );
    expect(made).toEqual({ redirected: "/app/settings/recurring-invoices" });
    await runCron();
    const [inv] = await invoicesFor(client);
    const lines = await linesFor(inv.id);
    const sum = lines.reduce((s, l) => s + Number(l.quantity) * l.unit_price_cents, 0);
    expect(lines.map((l) => l.label)).toEqual(["Office cleaning retainer"]);
    expect(sum, "the lines add up to what the invoice charges").toBe(inv.amount_cents);
  });

  it("a series on the last day of the month stays on the last day after a short month", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Month End Client");
    const id = await standing(c, client, { next_run_at: "2026-01-31T06:00:00Z" });
    await runCron(); // January's: next is February's last day
    expect(new Date((await seriesRow(id)).next_run_at).toISOString()).toBe("2026-02-28T06:00:00.000Z");
    await runCron(); // February's: next should be March 31
    const next = new Date((await seriesRow(id)).next_run_at);
    await api.sql("update public.invoice_series set active = false where id = $1", [id]);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    expect(next.getUTCDate(), `next run ${next.toISOString()}`).toBe(lastDay);
  });

  it("counts the due date from the company's day the invoice was made, not UTC's", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Late Run Client");
    // Due at midnight Dec 1 in Regina; the job runs at 10 pm Dec 1 Regina time.
    await standing(c, client, { next_run_at: "2026-12-01T06:00:00Z", due_days: 14 });
    // Only this company's series in this run: earlier tests' series that would
    // fall due by then aren't what this one is about.
    await api.sql(
      "update public.invoice_series set active = false where organization_id <> $1 and next_run_at <= '2026-12-02T04:00:00Z'",
      [c.org],
    );
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-12-02T04:00:00Z") });
    try {
      expect((await runCron()).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    const [inv] = await invoicesFor(client);
    expect(inv.due_date, "Dec 1 + 14 days in the company's calendar").toBe("2026-12-15");
  });

  it("a series whose invoice can't be made gives its period back and doesn't stop other companies' invoices", async () => {
    const stranger = await company();
    const c = await company();
    const good = await company();
    // A series pointing at another company's client: the invoice insert is
    // refused by the database (client_org_guard).
    const bad = await standing(c, await addClient(api.sql, stranger.org, "Stranger Client"), {
      next_run_at: new Date(Date.now() - 7_200_000).toISOString(),
    });
    const badBefore = (await seriesRow(bad)).next_run_at;
    const goodClient = await addClient(api.sql, good.org, "Good Client");
    await standing(good, goodClient);

    const res = await runCron();
    const badAfter = (await seriesRow(bad)).next_run_at;
    // Whatever happened, keep this series out of the way of later runs.
    await api.sql("update public.invoice_series set active = false where id = $1", [bad]);
    expect(await invoicesFor(goodClient), "another company's invoice still goes out").toHaveLength(1);
    expect(res.status).toBe(200);
    expect(badAfter, "the failed period is given back to retry").toBe(badBefore);
  });
});

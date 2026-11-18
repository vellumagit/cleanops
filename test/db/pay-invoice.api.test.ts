/**
 * Pay invoices: one person's pay for one pay period, as an invoice from that
 * person to the company, for both sides' records.
 *
 *   /api/pay-invoice/employee/{payroll item}       a pay period run
 *   /api/pay-invoice/contractor/{statement line}   a contractor statement
 *
 * What it owes:
 *   - the total is the pay run's own figure, to the cent, always;
 *   - every shift the run paid is a line: its day and times in the company's
 *     zone, its client, its hours, its rate, its amount;
 *   - bonuses, time off and add-ons are lines too;
 *   - the person it is for can open it once the run is final, the office can
 *     open it at any stage, and nobody else can tell it exists.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));

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
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

async function as<T>(who: Member | null, press: () => Promise<T>): Promise<T> {
  request.cookies = who ? api.sessionCookies(who.userId) : [];
  try {
    return await press();
  } finally {
    await settle();
  }
}

/** Open a pay invoice as someone, the way a browser would. */
async function open(who: Member | null, kind: string, itemId: string) {
  const { GET } = await import("@/app/api/pay-invoice/[kind]/[itemId]/route");
  const res = await as(who, () =>
    GET(new NextRequest(`https://sollos.example.test/api/pay-invoice/${kind}/${itemId}`), { params: Promise.resolve({ kind, itemId }) }),
  );
  const bytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get("content-type"), name: res.headers.get("content-disposition"), bytes };
}

type Co = { org: string; owner: Member; admin: Member; manager: Member; anna: Member; bea: Member; vira: Member; client: string };
async function company(name = "Invoice Co"): Promise<Co> {
  const org = await addOrg(api.sql, name);
  await api.sql("update public.organizations set timezone = 'America/Regina', name = $2 where id = $1", [org, name]);
  const c: Co = {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    admin: await addMember(api.sql, org, "admin", "Admin"),
    manager: await addMember(api.sql, org, "manager", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    bea: await addMember(api.sql, org, "employee", "Bea"),
    vira: await addMember(api.sql, org, "employee", "Vira"),
    client: "",
  };
  for (const [m, display, rate, engagement] of [
    [c.anna, "Anna Employee", 2000, "employee"],
    [c.bea, "Bea Employee", 1800, "employee"],
    [c.vira, "Vira Karpynska", 2500, "subcontractor"],
  ] as const) {
    await api.sql("update public.memberships set display_name = $2, pay_rate_cents = $3, engagement = $4 where id = $1", [m.membershipId, display, rate, engagement]);
  }
  c.client = await addClient(api.sql, org, "Client");
  await api.sql("update public.clients set name = 'Hilda Daubner' where id = $1", [c.client]);
  return c;
}

/** A finished shift starting at `localStart` in Regina (UTC-6), `hours` long, optionally on a booking. */
async function shift(c: Co, who: Member, localStart: string, hours: number, opts: { rate?: number | null; engagement?: string; booking?: string } = {}) {
  const start = new Date(`${localStart}:00-06:00`);
  const [row] = await api.sql<{ id: string }>(
    `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, engagement_snapshot, booking_id)
     values ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7) returning id`,
    [c.org, who.membershipId, start.toISOString(), new Date(start.getTime() + hours * 3_600_000).toISOString(), opts.rate === undefined ? null : opts.rate, opts.engagement ?? "employee", opts.booking ?? null],
  );
  return row.id;
}

/** An employee pay run for Nov 1 to 15, and the payroll item of each person in it. */
async function payRun(c: Co) {
  const { createPayrollRunForOrg } = await import("@/lib/payroll-run-create");
  const res = await createPayrollRunForOrg({ organizationId: c.org, createdByMembershipId: c.owner.membershipId, periodStart: "2026-11-01", periodEnd: "2026-11-15" });
  expect(res, api.log().slice(-600)).toMatchObject({ ok: true });
  if (!res.ok) throw new Error("no run");
  const items = await api.sql<{ id: string; employee_id: string; total_cents: number }>("select id, employee_id, total_cents from public.payroll_items where payroll_run_id = $1", [res.id]);
  const of = (m: Member) => items.find((i) => i.employee_id === m.membershipId)!;
  return { runId: res.id, of };
}

describe.skipIf(!hasPostgrest)("an employee's pay invoice", { timeout: 120_000 }, () => {
  it("lists every shift with its client, day, times, hours, rate and amount, then bonus and time off, and totals to the pay run's own figure", async () => {
    const { loadPayInvoice } = await import("@/lib/pay-invoice");
    const c = await company();
    const booking = await addBooking(api.sql, c.org, c.client);
    await api.sql("update public.bookings set service_type_label = 'Deep clean' where id = $1", [booking]);
    // Two shifts: one on a client's job at the rate frozen on it, one with no job.
    await shift(c, c.anna, "2026-11-03T09:00", 2.5, { rate: 2000, booking });
    // 11 PM on the 14th in Regina is the 15th in UTC: the invoice says the 14th.
    await shift(c, c.anna, "2026-11-14T23:00", 1, { rate: 2200 });
    await api.sql(
      "insert into public.bonuses (organization_id, employee_id, period_start, period_end, amount_cents, reason, bonus_type, status) values ($1, $2, '2026-10-15', '2026-11-14', 5000, 'Avg 4.90 across 8 reviews', 'review', 'pending')",
      [c.org, c.anna.membershipId],
    );
    await api.sql(
      "insert into public.pto_requests (organization_id, employee_id, start_date, end_date, hours, status) values ($1, $2, '2026-11-10', '2026-11-10', 8, 'approved')",
      [c.org, c.anna.membershipId],
    );
    const run = await payRun(c);
    const item = run.of(c.anna);
    // 2.5h x $20 + 1h x $22 + $50 bonus + 8h x $20 time off.
    expect(item.total_cents).toBe(5000 + 2200 + 5000 + 16000);

    const inv = (await loadPayInvoice("employee", item.id))!;
    expect(inv).toMatchObject({
      kind: "employee",
      companyName: "Invoice Co",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-15",
      runStatus: "draft",
      totalCents: item.total_cents,
    });
    expect(inv.number).toMatch(/^PAY-20261115-[0-9A-F]{6}$/);
    // The name on the invoice is the one the pay run recorded.
    expect(inv.workerName).toBe((await api.sql<{ n: string }>("select employee_name as n from public.payroll_items where id = $1", [item.id]))[0].n);
    expect(inv.workerName.length).toBeGreaterThan(0);
    expect(inv.lines).toEqual([
      { date: "Nov 3, 2026", description: "Hilda Daubner - Deep clean", detail: "9:00 AM - 11:30 AM", hours: 2.5, rateCents: 2000, amountCents: 5000 },
      { date: "Nov 14, 2026", description: "Shift", detail: "11:00 PM - 12:00 AM", hours: 1, rateCents: 2200, amountCents: 2200 },
      { date: "Nov 14, 2026", description: "Bonus (review)", detail: "Avg 4.90 across 8 reviews", hours: null, rateCents: null, amountCents: 5000 },
      { date: "", description: "Paid time off", detail: "Nov 10, 2026", hours: 8, rateCents: 2000, amountCents: 16000 },
    ]);
    expect(inv.lines.reduce((s, l) => s + l.amountCents, 0), "the lines add up to the total").toBe(inv.totalCents);
  });

  it("still totals to what the run paid when a rate changed after the run priced a shift that had none frozen on it", async () => {
    const { loadPayInvoice } = await import("@/lib/pay-invoice");
    const c = await company();
    await shift(c, c.bea, "2026-11-05T09:00", 4, { rate: null }); // priced by the run at Bea's $18
    const run = await payRun(c);
    const item = run.of(c.bea);
    expect(item.total_cents).toBe(7200);
    await api.sql("update public.memberships set pay_rate_cents = 2100 where id = $1", [c.bea.membershipId]);

    const inv = (await loadPayInvoice("employee", item.id))!;
    expect(inv.totalCents).toBe(7200);
    expect(inv.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(7200);
    expect(inv.lines.at(-1)).toMatchObject({ description: "Adjustment to match the pay run", amountCents: 7200 - 8400 });
  });

  it("opens as a PDF for the owner and an admin at any stage; for the person only once the run is final; never for a teammate, a manager, another company or a signed-out visitor", async () => {
    const c = await company();
    const other = await company("Other Invoice Co");
    await shift(c, c.anna, "2026-11-03T09:00", 2, { rate: 2000 });
    await shift(c, c.bea, "2026-11-03T09:00", 2, { rate: 1800 });
    const run = await payRun(c);
    const annas = run.of(c.anna).id;

    for (const office of [c.owner, c.admin]) {
      const res = await open(office, "employee", annas);
      expect(res.status, office.userId).toBe(200);
      expect(res.type).toBe("application/pdf");
      expect(res.bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(res.name).toMatch(/invoice-PAY-20261115-[0-9A-F]{6}\.pdf/);
    }
    // A draft the office is still reviewing is not hers to open yet.
    expect((await open(c.anna, "employee", annas)).status).toBe(404);
    await api.sql("update public.payroll_runs set status = 'finalized', finalized_at = now() where id = $1", [run.runId]);
    expect((await open(c.anna, "employee", annas)).status).toBe(200);
    await api.sql("update public.payroll_runs set status = 'paid', paid_at = now() where id = $1", [run.runId]);
    expect((await open(c.anna, "employee", annas)).status).toBe(200);

    for (const [who, why] of [
      [c.bea, "a teammate"],
      [c.manager, "a manager (employee payroll is owner and admin only)"],
      [other.owner, "another company's owner"],
    ] as const) {
      expect((await open(who, "employee", annas)).status, why).toBe(404);
    }
    expect((await open(null, "employee", annas)).status).toBe(401);
    // An id that isn't one, an unknown kind, and an id that doesn't exist all read the same.
    expect((await open(c.owner, "employee", "not-a-uuid")).status).toBe(404);
    expect((await open(c.owner, "payslip", annas)).status).toBe(404);
    expect((await open(c.owner, "employee", "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    // An employee item is not reachable through the contractor door.
    expect((await open(c.owner, "contractor", annas)).status).toBe(404);
  });

  it("a period with many shifts runs onto more pages rather than dropping lines", async () => {
    const { loadPayInvoice } = await import("@/lib/pay-invoice");
    const { PDFDocument } = await import("pdf-lib");
    const c = await company();
    for (let d = 1; d <= 15; d++) {
      const day = String(d).padStart(2, "0");
      await shift(c, c.anna, `2026-11-${day}T08:00`, 2, { rate: 2000 });
      await shift(c, c.anna, `2026-11-${day}T11:00`, 2, { rate: 2000 });
      await shift(c, c.anna, `2026-11-${day}T14:00`, 2, { rate: 2000 });
    }
    const run = await payRun(c);
    const item = run.of(c.anna);
    const inv = (await loadPayInvoice("employee", item.id))!;
    expect(inv.lines).toHaveLength(45);
    expect(inv.totalCents).toBe(45 * 4000);
    const res = await open(c.owner, "employee", item.id);
    expect(res.status).toBe(200);
    const pdf = await PDFDocument.load(res.bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });
});

describe.skipIf(!hasPostgrest)("a contractor's invoice", { timeout: 120_000 }, () => {
  async function statement(c: Co) {
    const { generateSubcontractorRunAction } = await import("@/app/app/payroll/contractors/run-actions");
    const made = await as(c.owner, () => generateSubcontractorRunAction(form({ period_start: "2026-11-01", period_end: "2026-11-15" })));
    expect(made, api.log().slice(-600)).toMatchObject({ ok: true });
    const [item] = await api.sql<{ id: string; total_cents: number; run_id: string }>(
      "select i.id, i.total_cents, i.run_id from public.subcontractor_pay_items i where i.organization_id = $1 and i.membership_id = $2",
      [c.org, c.vira.membershipId],
    );
    return item;
  }

  it("lists her shifts and her travel and reimbursements, and totals to the statement's own figure", async () => {
    const { loadPayInvoice } = await import("@/lib/pay-invoice");
    const c = await company();
    const booking = await addBooking(api.sql, c.org, c.client);
    await shift(c, c.vira, "2026-11-04T09:00", 3, { rate: 2500, engagement: "subcontractor", booking });
    await shift(c, c.vira, "2026-11-11T13:00", 2, { rate: 2500, engagement: "subcontractor" });
    await api.sql(
      "insert into public.pay_addons (organization_id, membership_id, kind, amount_cents, work_date, note) values ($1, $2, 'travel', 1500, '2026-11-04', 'Drive to Okotoks')",
      [c.org, c.vira.membershipId],
    );
    const item = await statement(c);

    const inv = (await loadPayInvoice("contractor", item.id))!;
    expect(inv).toMatchObject({ kind: "contractor", companyName: "Invoice Co", totalCents: item.total_cents, totalHours: 5 });
    expect(inv.number).toMatch(/^SUB-20261115-[0-9A-F]{6}$/);
    expect(inv.workerName).toBe((await api.sql<{ n: string }>("select payee_name as n from public.subcontractor_pay_items where id = $1", [item.id]))[0].n);
    expect(inv.lines.reduce((s, l) => s + l.amountCents, 0), "the lines add up to the total").toBe(item.total_cents);
    expect(inv.lines.filter((l) => l.hours != null).map((l) => [l.date, l.hours, l.rateCents, l.amountCents])).toEqual([
      ["Nov 4, 2026", 3, 2500, 7500],
      ["Nov 11, 2026", 2, 2500, 5000],
    ]);
    expect(inv.lines[0].description).toContain("Hilda Daubner");
    expect(item.total_cents).toBe(14000);
    expect(inv.lines.find((l) => l.description === "Travel")).toMatchObject({ date: "Nov 4, 2026", detail: "Drive to Okotoks", amountCents: 1500 });
    expect(inv.lines.some((l) => l.description.startsWith("Adjustment"))).toBe(false);
  });

  it("opens for the contractor herself, the owner, and a manager with the subcontractor switch on; not for a manager with it off, a teammate or another company", async () => {
    const c = await company();
    const other = await company("Other Sub Co");
    await shift(c, c.vira, "2026-11-04T09:00", 3, { rate: 2500, engagement: "subcontractor" });
    const item = await statement(c);

    for (const who of [c.owner, c.vira, c.manager]) {
      const res = await open(who, "contractor", item.id);
      expect(res.status, who.userId).toBe(200);
      expect(res.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    }
    await api.sql(`update public.memberships set capabilities = '{"subcontractors": false}'::jsonb where id = $1`, [c.manager.membershipId]);
    expect((await open(c.manager, "contractor", item.id)).status, "switch off").toBe(404);
    expect((await open(c.anna, "contractor", item.id)).status, "a teammate").toBe(404);
    expect((await open(other.owner, "contractor", item.id)).status, "another company").toBe(404);
    // A contractor line is not reachable through the employee door.
    expect((await open(c.owner, "employee", item.id)).status).toBe(404);
  });
});

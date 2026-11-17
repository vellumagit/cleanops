/**
 * Paying subcontractors, the way Svit pays its crew: 17 of its cleaners are
 * subcontractors, it runs no employee payroll, and its pay schedule is
 * twice a month. One statement so far (Oct 1 to 15, $2,782.60, paid); the
 * next two are due. Run as the owner who presses the buttons, against a real
 * database behind the real PostgREST and the stand-in file storage.
 *
 *   Generate statement   the period's subcontractor hours, priced, stamped
 *   payouts, bills       money sent, invoices received
 *   tips                 settled to the cleaner, or kept by the business
 *   pay schedule         what the "Up next" period is worked out from
 *
 * What a statement owes: every subcontractor hour in the period, at the rate
 * it was worked at, once; nobody's employee hours; nothing outside the
 * company's own calendar days; and no statement while a capped shift is
 * still waiting for someone to check it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
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

async function as<T>(who: Member, press: () => Promise<T>): Promise<T> {
  request.cookies = api.sessionCookies(who.userId);
  try {
    return await press();
  } finally {
    await settle();
  }
}
const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

type Company = { org: string; owner: Member; manager: Member; vira: Member; olha: Member; anna: Member };
async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Pay Co");
  await api.sql("update public.organizations set timezone = 'America/Regina' where id = $1", [org]);
  const c: Company = {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    manager: await addMember(api.sql, org, "manager", "Office"),
    vira: await addMember(api.sql, org, "employee", "Vira"),
    olha: await addMember(api.sql, org, "employee", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
  for (const [m, name, rate, engagement] of [
    [c.vira, "Vira Karpynska", 1800, "subcontractor"],
    [c.olha, "Olha Musnytska", 2000, "subcontractor"],
    [c.anna, "Anna Employee", 1700, "employee"],
  ] as const) {
    await api.sql("update public.memberships set display_name = $2, pay_rate_cents = $3, engagement = $4 where id = $1", [
      m.membershipId,
      name,
      rate,
      engagement,
    ]);
  }
  return c;
}

/** A finished shift starting at `localStart` in Regina (UTC-6), `hours` long. */
async function shift(c: Company, who: Member, localStart: string, hours: number, opts: { rate?: number; engagement?: string; review?: boolean } = {}) {
  const start = new Date(`${localStart}:00-06:00`);
  const [row] = await api.sql<{ id: string }>(
    `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, engagement_snapshot, needs_review)
     values ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7) returning id`,
    [
      c.org,
      who.membershipId,
      start.toISOString(),
      new Date(start.getTime() + hours * 3_600_000).toISOString(),
      opts.rate ?? null,
      opts.engagement ?? "subcontractor",
      opts.review ?? false,
    ],
  );
  return row.id;
}

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("Generate statement: a period's subcontractor hours", { timeout: 120_000 }, () => {
  it("prices every subcontractor hour in the company's own days once; not employee hours, not the days either side", async () => {
    const { generateSubcontractorRunAction } = await import("@/app/app/payroll/contractors/run-actions");
    const c = await company();
    const inside = [
      await shift(c, c.vira, "2026-11-03T09:00", 3, { rate: 1800 }),
      await shift(c, c.vira, "2026-11-10T09:00", 4, { rate: 1800 }),
      // 11 PM on the 15th is 5 AM UTC on the 16th: still the 15th here.
      await shift(c, c.olha, "2026-11-15T23:00", 0.5, { rate: 2000 }),
      await shift(c, c.olha, "2026-11-12T12:00", 4.5, { rate: 2000 }),
    ];
    const employeeHours = await shift(c, c.anna, "2026-11-04T09:00", 6, { rate: 1700, engagement: "employee" });
    const dayBefore = await shift(c, c.vira, "2026-10-31T18:00", 2, { rate: 1800 });
    const dayAfter = await shift(c, c.vira, "2026-11-16T09:00", 2, { rate: 1800 });
    const flagged = await shift(c, c.olha, "2026-11-14T09:00", 8, { rate: 2000, review: true });
    const period = { period_start: "2026-11-01", period_end: "2026-11-15" };

    // A capped shift nobody has checked holds the statement back, in words.
    const held = await as(c.owner, () => generateSubcontractorRunAction(form(period)));
    expect(held, api.log()).toMatchObject({ ok: false });
    expect((held as { error: string }).error).toContain("1 shift still needs review");
    expect(await api.sql("select 1 from public.subcontractor_pay_runs where organization_id = $1", [c.org])).toHaveLength(0);

    // Checked and corrected to two hours, it goes on.
    await api.sql(
      "update public.time_entries set needs_review = false, clock_out_at = clock_in_at + interval '2 hours' where id = $1",
      [flagged],
    );
    expect(await as(c.owner, () => generateSubcontractorRunAction(form(period)))).toEqual({ ok: true });

    const [run] = await api.sql<{ id: string; total_cents: number; status: string; period_start: string; period_end: string }>(
      "select id, total_cents, status, period_start::text, period_end::text from public.subcontractor_pay_runs where organization_id = $1",
      [c.org],
    );
    // Vira 7h x $18 = $126; Olha 7h x $20 = $140.
    expect(run).toMatchObject({ total_cents: 26600, status: "finalized", period_start: "2026-11-01", period_end: "2026-11-15" });
    const items = await api.sql<{ payee_name: string; minutes: number; total_cents: number }>(
      "select payee_name, minutes, total_cents from public.subcontractor_pay_items where run_id = $1 order by payee_name",
      [run.id],
    );
    expect(items).toEqual([
      { payee_name: "Olha Musnytska", minutes: 420, total_cents: 14000 },
      { payee_name: "Vira Karpynska", minutes: 420, total_cents: 12600 },
    ]);
    const stamp = async (id: string) =>
      (await api.sql<{ r: string | null }>("select subcontractor_run_id as r from public.time_entries where id = $1", [id]))[0].r;
    for (const id of [...inside, flagged]) expect(await stamp(id)).toBe(run.id);
    for (const id of [employeeHours, dayBefore, dayAfter]) expect(await stamp(id)).toBeNull();

    // Pressed again: nothing is paid twice.
    expect(await as(c.owner, () => generateSubcontractorRunAction(form(period)))).toEqual({
      ok: false,
      error: "No unpaid subcontractor hours in this period.",
    });
  });

  it("refuses a backwards or impossible period, and anyone but an owner or admin", async () => {
    const { generateSubcontractorRunAction } = await import("@/app/app/payroll/contractors/run-actions");
    const c = await company();
    await shift(c, c.vira, "2026-11-03T09:00", 3, { rate: 1800 });
    expect(await as(c.owner, () => generateSubcontractorRunAction(form({ period_start: "2026-11-15", period_end: "2026-11-01" })))).toEqual({
      ok: false,
      error: "Period end must be on or after start.",
    });
    expect(await as(c.owner, () => generateSubcontractorRunAction(form({ period_start: "2026-02-30", period_end: "2026-03-10" })))).toMatchObject({ ok: false });
    expect(await as(c.manager, () => generateSubcontractorRunAction(form({ period_start: "2026-11-01", period_end: "2026-11-15" })))).toEqual({
      ok: false,
      error: "Only owners and admins can generate statements.",
    });
    expect(await api.sql("select 1 from public.subcontractor_pay_runs where organization_id = $1", [c.org])).toHaveLength(0);
  });
});

describe.skipIf(!hasPostgrest)("payouts and bills on a subcontractor's page", { timeout: 120_000 }, () => {
  it("records and removes a payment; files, opens and deletes an invoice she sent; refuses another company's person and a file that isn't one", async () => {
    const { recordPayoutAction, deletePayoutAction, uploadBillAction, deleteBillAction, billDownloadUrlAction } = await import(
      "@/app/app/payroll/contractors/actions"
    );
    const c = await company();
    const payee = `m-${c.vira.membershipId}`;

    expect(await as(c.owner, () => recordPayoutAction(form({ payee, amount: "$126.00", paid_on: "2026-11-16", method: "e-transfer", reference: "ET-1" })))).toEqual({
      ok: true,
    });
    const [payout] = await api.sql<{ id: string; amount_cents: number; membership_id: string }>(
      "select id, amount_cents, membership_id from public.subcontractor_payouts where organization_id = $1",
      [c.org],
    );
    expect(payout).toMatchObject({ amount_cents: 12600, membership_id: c.vira.membershipId });
    expect(await as(c.owner, () => recordPayoutAction(form({ payee, amount: "0" })))).toEqual({
      ok: false,
      error: "Enter a payment amount greater than zero.",
    });
    const stranger = await addMember(api.sql, await addOrg(api.sql, "Elsewhere"), "employee");
    expect(await as(c.owner, () => recordPayoutAction(form({ payee: `m-${stranger.membershipId}`, amount: "50" })))).toEqual({
      ok: false,
      error: "Subcontractor not found.",
    });
    expect(await as(c.manager, () => recordPayoutAction(form({ payee, amount: "50" })))).toEqual({
      ok: false,
      error: "Only owners and admins can record payments.",
    });
    expect(await as(c.owner, () => deletePayoutAction(form({ id: payout.id })))).toEqual({ ok: true });
    expect(await api.sql("select 1 from public.subcontractor_payouts where id = $1", [payout.id])).toHaveLength(0);

    const pdf = new File([new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF")], "invoice-nov.pdf", {
      type: "application/pdf",
    });
    expect(await as(c.owner, () => uploadBillAction(form({ payee, file: pdf, amount: "126", bill_date: "2026-11-15", label: "November 1-15" })))).toEqual({
      ok: true,
    });
    const [bill] = await api.sql<{ id: string; file_path: string; amount_cents: number; label: string }>(
      "select id, file_path, amount_cents, label from public.subcontractor_bills where organization_id = $1",
      [c.org],
    );
    expect(bill).toMatchObject({ amount_cents: 12600, label: "November 1-15" });
    expect(api.storage.has(`subcontractor-bills/${bill.file_path}`)).toBe(true);
    const opened = await as(c.manager, () => billDownloadUrlAction(bill.id));
    expect((opened as { url?: string }).url).toBeTruthy();

    const fake = new File([new TextEncoder().encode("MZ not a pdf at all")], "invoice.pdf", { type: "application/pdf" });
    expect(await as(c.owner, () => uploadBillAction(form({ payee, file: fake })))).toEqual({ ok: false, error: "That file isn't a PDF." });

    expect(await as(c.owner, () => deleteBillAction(form({ id: bill.id })))).toEqual({ ok: true });
    expect(await api.sql("select 1 from public.subcontractor_bills where id = $1", [bill.id])).toHaveLength(0);
    expect(api.storage.has(`subcontractor-bills/${bill.file_path}`)).toBe(false);
  });
});

describe.skipIf(!hasPostgrest)("tips: to the cleaner, or kept", { timeout: 120_000 }, () => {
  it("settles one cleaner's unpaid tips and nobody else's; keeps the unattributed ones, or an invoice's; only for an owner or admin", async () => {
    const { markTipsPaidAction, keepTipsAction } = await import("@/app/app/payroll/actions");
    const c = await company();
    const client = await addClient(api.sql, c.org, "Hilda Daubner");
    const [inv] = await api.sql<{ id: string }>(
      "insert into public.invoices (organization_id, client_id, status, amount_cents) values ($1, $2, 'paid', 20000) returning id",
      [c.org, client],
    );
    const [inv2] = await api.sql<{ id: string }>(
      "insert into public.invoices (organization_id, client_id, status, amount_cents) values ($1, $2, 'paid', 20000) returning id",
      [c.org, client],
    );
    const tip = async (member: Member | null, cents: number, invoice = inv.id, paid = false) =>
      (
        await api.sql<{ id: string }>(
          `insert into public.invoice_tips (organization_id, invoice_id, membership_id, amount_cents, paid_out_at)
           values ($1, $2, $3, $4, case when $5 then now() - interval '3 days' end) returning id`,
          [c.org, invoice, member?.membershipId ?? null, cents, paid],
        )
      )[0].id;
    const viraNew = await tip(c.vira, 1000);
    const viraOld = await tip(c.vira, 500, inv.id, true);
    const olhas = await tip(c.olha, 800);
    const nobodys = await tip(null, 300);
    const onInvoice2 = await tip(c.olha, 400, inv2.id);
    const state = async (id: string) =>
      (await api.sql<{ paid: string | null; kept: boolean | null }>(
        "select paid_out_at::text as paid, kept_by_business as kept from public.invoice_tips where id = $1",
        [id],
      ))[0];
    const oldPaidAt = (await state(viraOld)).paid;

    await as(c.manager, () => markTipsPaidAction(form({ membership_id: c.vira.membershipId })));
    expect((await state(viraNew)).paid).toBeNull();

    await as(c.owner, () => markTipsPaidAction(form({ membership_id: c.vira.membershipId })));
    expect((await state(viraNew)).paid).not.toBeNull();
    expect((await state(viraOld)).paid).toBe(oldPaidAt);
    expect((await state(olhas)).paid).toBeNull();
    expect((await state(nobodys)).paid).toBeNull();

    await as(c.owner, () => keepTipsAction(form({ membership_id: "" })));
    expect(await state(nobodys)).toMatchObject({ kept: true });
    expect((await state(olhas)).paid).toBeNull();

    await as(c.owner, () => keepTipsAction(form({ invoice_id: inv2.id })));
    expect(await state(onInvoice2)).toMatchObject({ kept: true });
    expect((await state(olhas)).paid).toBeNull();
  });
});

describe.skipIf(!hasPostgrest)("pay schedule", { timeout: 120_000 }, () => {
  it("twice a month needs no date; every two weeks needs the date a period started; clearing goes back to manual", async () => {
    const { updatePayScheduleAction } = await import("@/app/app/payroll/actions");
    const c = await company();
    const read = async () =>
      (await api.sql<{ s: string | null; a: string | null }>("select pay_schedule as s, pay_anchor::text as a from public.organizations where id = $1", [c.org]))[0];

    expect(await as(c.owner, () => updatePayScheduleAction(form({ pay_schedule: "semimonthly", pay_anchor: "" })))).toEqual({ ok: true });
    expect(await read()).toEqual({ s: "semimonthly", a: null });
    expect(await as(c.owner, () => updatePayScheduleAction(form({ pay_schedule: "biweekly", pay_anchor: "" })))).toMatchObject({ ok: false });
    expect(await read()).toEqual({ s: "semimonthly", a: null });
    expect(await as(c.owner, () => updatePayScheduleAction(form({ pay_schedule: "biweekly", pay_anchor: "2026-11-02" })))).toEqual({ ok: true });
    expect(await read()).toEqual({ s: "biweekly", a: "2026-11-02" });
    expect(await as(c.owner, () => updatePayScheduleAction(form({ pay_schedule: "", pay_anchor: "" })))).toEqual({ ok: true });
    expect(await read()).toEqual({ s: null, a: null });
    expect(await as(c.manager, () => updatePayScheduleAction(form({ pay_schedule: "weekly", pay_anchor: "2026-11-02" })))).toEqual({
      ok: false,
      error: "Only owners and admins can set the pay schedule.",
    });
  });
});

/**
 * Pay adjustments: putting pay right after a pay period has been paid.
 *
 * A paid period is locked for good. Until 2026-11-19 a mistake found in one
 * had no way out: the refusal said "delete that pay period", which the app
 * then refused too. Now the refusal points at an adjustment, an amount for
 * one person (plus or minus) that the next prepared period picks up as its
 * own line. Run as the people who press it, on a real database.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addMember, addOrg, type Member } from "./harness";
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
let adjust: typeof import("@/app/app/payroll/adjustment-actions");
let runs: typeof import("@/lib/payroll-run-create");

beforeAll(async () => {
  process.env.INTEGRATION_ENCRYPTION_KEY ??= `base64:${randomBytes(32).toString("base64")}`;
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  adjust = await import("@/app/app/payroll/adjustment-actions");
  runs = await import("@/lib/payroll-run-create");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

const daysAgo = (d: number, hour = 15) => {
  const t = new Date(Date.now() - d * 86_400_000);
  t.setUTCHours(hour, 0, 0, 0);
  return t.toISOString();
};
const ymd = (iso: string) => iso.slice(0, 10);
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

type Co = { org: string; owner: Member; manager: Member; anna: Member };
async function company(): Promise<Co> {
  const org = await addOrg(api.sql, "Adjust Co");
  await api.sql("update public.organizations set timezone = 'UTC', automations_enabled = true where id = $1", [org]);
  const anna = await addMember(api.sql, org, "employee", "Anna");
  // $20 an hour.
  await api.sql("update public.memberships set pay_rate_cents = 2000, display_name = 'Anna Cleaner' where id = $1", [anna.membershipId]);
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Owner"),
    manager: await addMember(api.sql, org, "manager", "Manager"),
    anna,
  };
}

async function as<T>(who: Member, press: () => Promise<T>): Promise<T> {
  request.cookies = api.sessionCookies(who.userId);
  try {
    return await press();
  } finally {
    await settle();
  }
}

/** A finished two-hour shift for Anna, `d` days ago: $40. */
async function shift(c: Co, d: number) {
  const start = daysAgo(d);
  const [row] = await api.sql<{ id: string }>(
    `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at)
     values ($1, $2, $3, $4) returning id`,
    [c.org, c.anna.membershipId, start, new Date(new Date(start).getTime() + 120 * 60_000).toISOString()],
  );
  return row.id;
}

const prepare = (c: Co, from: number, to: number) =>
  runs.createPayrollRunForOrg({
    organizationId: c.org,
    createdByMembershipId: c.owner.membershipId,
    periodStart: ymd(daysAgo(from)),
    periodEnd: ymd(daysAgo(to)),
  });

const adjustments = (c: Co) =>
  api.sql<{ id: string; amount_cents: number; reason: string; run: string | null }>(
    "select id, amount_cents, reason, payroll_run_id as run from public.pay_adjustments where organization_id = $1 order by created_at",
    [c.org],
  );

const add = (c: Co, who: Member, over: Record<string, string> = {}) =>
  as(who, () =>
    adjust.createPayAdjustmentAction(
      form({ employee_id: c.anna.membershipId, direction: "add", amount: "30", reason: "Nov 12 shift was 4 hours, paid as 2", ...over }),
    ),
  );

describe.skipIf(!hasPostgrest)("adding a pay adjustment", { timeout: 120_000 }, () => {
  it("the owner adds one, plus or minus; a manager can't; a note is required", async () => {
    const c = await company();
    expect(await add(c, c.owner), api.log()).toEqual({ ok: true });
    expect(await add(c, c.owner, { direction: "take_back", amount: "$12.50", reason: "Paid twice for Nov 3" })).toEqual({ ok: true });
    expect((await adjustments(c)).map((a) => [a.amount_cents, a.reason, a.run])).toEqual([
      [3000, "Nov 12 shift was 4 hours, paid as 2", null],
      [-1250, "Paid twice for Nov 3", null],
    ]);

    expect(await add(c, c.manager)).toEqual({ ok: false, error: "Only owners and admins can adjust someone's pay." });
    expect(await add(c, c.anna)).toMatchObject({ ok: false });
    expect(await add(c, c.owner, { reason: "  " })).toMatchObject({ ok: false, error: expect.stringContaining("short note") });
    for (const amount of ["0", "-5", "abc", "20000"]) {
      expect(await add(c, c.owner, { amount }), amount).toMatchObject({ ok: false });
    }
    expect(await add(c, c.owner, { corrects_period_start: "2026-11-01", corrects_period_end: "" })).toMatchObject({ ok: false });
    expect(await adjustments(c), "nothing more saved").toHaveLength(2);
  });

  it("is refused for a subcontractor and for another company's person", async () => {
    const c = await company();
    const other = await company();
    await api.sql("update public.memberships set engagement = 'subcontractor' where id = $1", [c.anna.membershipId]);
    expect(await add(c, c.owner)).toMatchObject({ ok: false, error: expect.stringContaining("subcontractor") });
    expect(await add(c, c.owner, { employee_id: other.anna.membershipId })).toEqual({
      ok: false,
      error: "That person isn't in this company.",
    });
    expect(await adjustments(c)).toEqual([]);
    expect(await adjustments(other)).toEqual([]);
  });
});

describe.skipIf(!hasPostgrest)("the next pay period picks adjustments up", { timeout: 120_000 }, () => {
  it("underpaid: the amount is added as its own line, with the note on the pay statement", async () => {
    const c = await company();
    await shift(c, 3);
    await add(c, c.owner, { corrects_period_start: "2026-11-01", corrects_period_end: "2026-11-14" });

    const res = await prepare(c, 6, 1);
    expect(res, api.log()).toMatchObject({ ok: true, totalCents: 7000 });
    if (!res.ok) return;
    const [item] = await api.sql<{ id: string; regular_pay_cents: number; adjustment_cents: number; total_cents: number }>(
      "select id, regular_pay_cents, adjustment_cents, total_cents from public.payroll_items where payroll_run_id = $1",
      [res.id],
    );
    expect(item).toMatchObject({ regular_pay_cents: 4000, adjustment_cents: 3000, total_cents: 7000 });
    expect((await adjustments(c))[0].run, "stamped with the run").toBe(res.id);

    const { loadPayInvoice } = await import("@/lib/pay-invoice");
    const inv = (await loadPayInvoice("employee", item.id))!;
    const line = inv.lines.find((l) => l.description.startsWith("Pay adjustment"));
    expect(line, JSON.stringify(inv.lines)).toMatchObject({ amountCents: 3000, detail: "Nov 12 shift was 4 hours, paid as 2" });
    expect(line!.description).toContain("for ");
    expect(inv.lines.reduce((s, l) => s + l.amountCents, 0), "the lines add up to the total").toBe(7000);
    expect(inv.lines.some((l) => l.description === "Adjustment to match the pay run"), "no balancing line needed").toBe(false);

    // A second prepare does not pay it again.
    await shift(c, 0);
    const again = await prepare(c, 0, 0);
    expect(again).toMatchObject({ ok: true, totalCents: 4000 });
  });

  it("overpaid: the amount comes off; deleting the unpaid period releases it to wait again", async () => {
    const c = await company();
    await shift(c, 3);
    await add(c, c.owner, { direction: "take_back", amount: "10", reason: "Paid twice for Nov 3" });
    const res = await prepare(c, 6, 1);
    expect(res, api.log()).toMatchObject({ ok: true, totalCents: 3000 });
    if (!res.ok) return;
    const [item] = await api.sql<{ adjustment_cents: number; total_cents: number }>(
      "select adjustment_cents, total_cents from public.payroll_items where payroll_run_id = $1",
      [res.id],
    );
    expect(item).toEqual({ adjustment_cents: -1000, total_cents: 3000 });

    // On a period: it can't be removed from the Pay adjustments list.
    const [held] = await adjustments(c);
    expect(await as(c.owner, () => adjust.deletePayAdjustmentAction(form({ id: held.id })))).toMatchObject({ ok: false });

    await api.sql("delete from public.payroll_runs where id = $1", [res.id]);
    expect((await adjustments(c))[0].run, "released").toBeNull();
    expect(await as(c.owner, () => adjust.deletePayAdjustmentAction(form({ id: held.id })))).toEqual({ ok: true });
    expect(await adjustments(c)).toEqual([]);
  });

  it("someone with no hours this period still gets a positive adjustment", async () => {
    const c = await company();
    await add(c, c.owner);
    const res = await prepare(c, 6, 1);
    expect(res, api.log()).toMatchObject({ ok: true, totalCents: 3000 });
  });

  it("taking back more than they earned is refused by name, and nothing is stamped", async () => {
    const c = await company();
    const hours = await shift(c, 3);
    await add(c, c.owner, { direction: "take_back", amount: "50", reason: "Overpaid in October" });
    const res = await prepare(c, 6, 1);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("Anna Cleaner");
    expect(res.error).toContain("below zero");
    expect(await api.sql("select 1 from public.payroll_runs where organization_id = $1", [c.org])).toEqual([]);
    expect((await adjustments(c))[0].run).toBeNull();
    const [s] = await api.sql<{ run: string | null }>("select payroll_run_id as run from public.time_entries where id = $1", [hours]);
    expect(s.run).toBeNull();
  });
});

describe.skipIf(!hasPostgrest)("an entry in a PAID pay period", { timeout: 120_000 }, () => {
  it("says the period is locked and points at a pay adjustment, not at a delete that would be refused", async () => {
    const timesheets = await import("@/app/app/timesheets/actions");
    const c = await company();
    const paid = await shift(c, 3);
    const res = await prepare(c, 6, 1);
    if (!res.ok) throw new Error(res.error);

    const edit = () =>
      as(c.owner, () =>
        timesheets.updateTimeEntryAction(
          form({ id: paid, employee_id: c.anna.membershipId, booking_id: "", start_at: daysAgo(3).slice(0, 16), end_at: daysAgo(3, 20).slice(0, 16) }),
        ),
      );
    // Still a draft: the old advice is right, the period can be deleted.
    const draft = (await edit()) as { ok: boolean; error?: string; fix?: { href: string; label: string } };
    expect(draft.ok).toBe(false);
    expect(draft.error).toContain("Delete that pay period");

    await api.sql("update public.payroll_runs set status = 'paid', paid_at = now() where id = $1", [res.id]);
    const locked = (await edit()) as { ok: boolean; error?: string; fix?: { href: string; label: string } };
    expect(locked.ok).toBe(false);
    expect(locked.error).toContain("locked");
    expect(locked.error).not.toContain("Delete that pay period");
    expect(locked.fix).toEqual({ href: "/app/payroll#adjustments", label: "Add a pay adjustment" });
  });
});

/**
 * Add-ons on a contractor statement (2026-11-15).
 *
 * Svit asked for a way to pay travel and reimbursements. Bonuses reach only
 * the employee payroll run, and every Svit cleaner is a contractor, so a
 * parking receipt had nowhere to go. An add-on is an amount for one person on
 * one day; preparing the pay period puts it on her statement.
 *
 * The real actions against the real stack (test/db/api.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async () => (await import("./next-stubs")).nextServer());

let api: Api;
let restoreEnv: () => void;
let addons: typeof import("@/app/app/payroll/addon-actions");
let payroll: typeof import("@/app/app/payroll/actions");
let statements: typeof import("@/app/app/payroll/contractors/run-actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  addons = await import("@/app/app/payroll/addon-actions");
  payroll = await import("@/app/app/payroll/actions");
  statements = await import("@/app/app/payroll/contractors/run-actions");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

const DAY = 86_400_000;
const ymd = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);

type Company = { org: string; owner: Member; vira: Member; olha: Member };

async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Company");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  const owner = await addMember(api.sql, org, "owner", "Owner");
  const vira = await addMember(api.sql, org, "employee", "Vira");
  const olha = await addMember(api.sql, org, "employee", "Olha");
  for (const [m, name] of [
    [vira, "Vira Karpynska"],
    [olha, "Olha Musnytska"],
  ] as const) {
    await api.sql(
      "update public.memberships set display_name = $2, engagement = 'subcontractor', pay_rate_cents = 1800 where id = $1",
      [m.membershipId, name],
    );
  }
  return { org, owner, vira, olha };
}

/** A three-hour shift at noon UTC, `daysAgo` days back, at $18. */
async function shift(c: Company, who: Member, daysAgo: number) {
  const start = new Date(`${ymd(daysAgo)}T12:00:00Z`);
  await api.sql(
    `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, engagement_snapshot)
     values ($1, $2, $3::timestamptz, $4::timestamptz, 1800, 'subcontractor')`,
    [c.org, who.membershipId, start.toISOString(), new Date(start.getTime() + 3 * 3_600_000).toISOString()],
  );
}

async function as<T>(c: Company, act: () => Promise<T>): Promise<T> {
  request.cookies = api.sessionCookies(c.owner.userId);
  try {
    return await act();
  } finally {
    await settle();
  }
}

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const add = (c: Company, who: Member, fields: Partial<Record<"kind" | "amount" | "work_date" | "note", string>> = {}) =>
  as(c, () =>
    addons.createAddonAction(
      form({ membership_id: who.membershipId, kind: "reimbursement", amount: "25", work_date: ymd(5), note: "Parking", ...fields }),
    ),
  );

const prepare = (c: Company, start: string, end: string) =>
  as(c, () => payroll.preparePeriodAction(form({ period_start: start, period_end: end })));

const items = (c: Company) =>
  api.sql<{ membership_id: string; minutes: number; total_cents: number; addons_cents: number; reimbursement_cents: number }>(
    "select membership_id, minutes, total_cents, addons_cents, reimbursement_cents from public.subcontractor_pay_items where organization_id = $1",
    [c.org],
  );

describe.skipIf(!hasPostgrest)("add-ons on a contractor statement", () => {
  it("preparing the period puts the add-ons on the statement, on top of the hours, and stamps them", async () => {
    const c = await company();
    await shift(c, c.vira, 5);
    expect(await add(c, c.vira, { amount: "25", kind: "reimbursement" }), api.log()).toEqual({ ok: true });
    expect(await add(c, c.vira, { amount: "15.50", kind: "travel", note: "Drive to Sherwood Park" })).toEqual({ ok: true });

    const prepared = await prepare(c, ymd(10), ymd(1));
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);

    const [vira] = await items(c);
    // 3h at $18 = $54, plus $40.50 of add-ons.
    expect(vira).toMatchObject({ membership_id: c.vira.membershipId, minutes: 180, addons_cents: 4050, reimbursement_cents: 2500, total_cents: 9450 });
    const [run] = await api.sql<{ id: string; total_cents: number }>(
      "select id, total_cents from public.subcontractor_pay_runs where organization_id = $1",
      [c.org],
    );
    expect(run.total_cents).toBe(9450);
    const stamped = await api.sql<{ subcontractor_run_id: string | null }>(
      "select subcontractor_run_id from public.pay_addons where organization_id = $1",
      [c.org],
    );
    expect(stamped.every((r) => r.subcontractor_run_id === run.id)).toBe(true);
  });

  it("someone with an add-on and no hours still gets a line on the statement", async () => {
    const c = await company();
    await shift(c, c.vira, 5);
    await add(c, c.olha, { amount: "30", note: "Supplies from the store" });
    expect((await prepare(c, ymd(10), ymd(1))).ok).toBe(true);
    const olha = (await items(c)).find((i) => i.membership_id === c.olha.membershipId);
    expect(olha).toMatchObject({ minutes: 0, addons_cents: 3000, total_cents: 3000 });
  });

  it("an add-on outside the period waits for its own period", async () => {
    const c = await company();
    await shift(c, c.vira, 5);
    await add(c, c.vira, { work_date: ymd(20), amount: "10" });
    expect((await prepare(c, ymd(10), ymd(1))).ok).toBe(true);
    const [vira] = await items(c);
    expect(vira.addons_cents).toBe(0);
    const [left] = await api.sql<{ subcontractor_run_id: string | null }>(
      "select subcontractor_run_id from public.pay_addons where organization_id = $1",
      [c.org],
    );
    expect(left.subcontractor_run_id).toBeNull();
  });

  it("once the statement is prepared, an add-on for that period is refused with the way out, and one on it can't be removed", async () => {
    const c = await company();
    await shift(c, c.vira, 5);
    await add(c, c.vira);
    expect((await prepare(c, ymd(10), ymd(1))).ok).toBe(true);

    const late = await add(c, c.vira, { work_date: ymd(4), note: "Late receipt" });
    expect(late.ok).toBe(false);
    expect((late as { error: string }).error).toContain("already prepared");

    const [row] = await api.sql<{ id: string }>("select id from public.pay_addons where organization_id = $1", [c.org]);
    const removed = await as(c, () => addons.deleteAddonAction(form({ id: row.id })));
    expect(removed.ok).toBe(false);
    expect((removed as { error: string }).error).toContain("on a statement already");
  });

  it("deleting the statement releases its add-ons, which then can be removed or go on the next one", async () => {
    const c = await company();
    await shift(c, c.vira, 5);
    await add(c, c.vira);
    expect((await prepare(c, ymd(10), ymd(1))).ok).toBe(true);
    const [run] = await api.sql<{ id: string }>("select id from public.subcontractor_pay_runs where organization_id = $1", [c.org]);
    expect(await as(c, () => statements.deleteSubcontractorRunAction(form({ run_id: run.id }))), api.log()).toEqual({ ok: true });

    const [row] = await api.sql<{ id: string; subcontractor_run_id: string | null }>(
      "select id, subcontractor_run_id from public.pay_addons where organization_id = $1",
      [c.org],
    );
    expect(row.subcontractor_run_id).toBeNull();
    expect(await as(c, () => addons.deleteAddonAction(form({ id: row.id })))).toEqual({ ok: true });
    expect(await api.sql("select 1 from public.pay_addons where organization_id = $1", [c.org])).toEqual([]);
  });

  it("refuses someone paid through payroll, a future day, a bad amount, no note, and another company's person", async () => {
    const c = await company();
    await api.sql("update public.memberships set engagement = 'employee' where id = $1", [c.olha.membershipId]);
    const employee = await add(c, c.olha);
    expect((employee as { error: string }).error).toContain("as a bonus on the Bonuses page");

    expect(((await add(c, c.vira, { work_date: ymd(-2) })) as { error: string }).error).toContain("future");
    expect(((await add(c, c.vira, { amount: "0" })) as { error: string }).error).toContain("Enter an amount");
    expect(((await add(c, c.vira, { note: "  " })) as { error: string }).error).toContain("short note");

    const other = await company();
    const foreign = await as(c, () =>
      addons.createAddonAction(
        form({ membership_id: other.vira.membershipId, kind: "travel", amount: "5", work_date: ymd(3), note: "x" }),
      ),
    );
    expect((foreign as { error: string }).error).toContain("isn't in this company");
    expect(
      await api.sql("select 1 from public.pay_addons where organization_id = any($1::uuid[])", [[c.org, other.org]]),
    ).toHaveLength(0);
  });

  it("only owners and admins can add or remove", async () => {
    const c = await company();
    request.cookies = api.sessionCookies(c.vira.userId);
    try {
      const r = await addons.createAddonAction(
        form({ membership_id: c.vira.membershipId, kind: "travel", amount: "500", work_date: ymd(2), note: "Paying myself" }),
      );
      expect(r.ok).toBe(false);
    } finally {
      await settle();
    }
    expect(await api.sql("select 1 from public.pay_addons where organization_id = $1", [c.org])).toEqual([]);
  });

  it("add-ons can't be read with a signed-in person's own key", async () => {
    const c = await company();
    await add(c, c.vira);
    const res = await fetch(`${api.url}/rest/v1/pay_addons?select=id`, {
      headers: { apikey: api.anonKey, authorization: `Bearer ${api.tokenFor(c.vira.userId)}` },
    });
    const body = await res.json();
    expect(Array.isArray(body) ? body : []).toEqual([]);
  });
});

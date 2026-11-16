/**
 * A pay period from prepared to paid, through the app's own payroll actions,
 * against a real database behind the real PostgREST.
 *
 * What each step owes the people being paid: a run moves draft → finalized →
 * paid in that order only; deleting a draft frees its shifts to be paid
 * again; a finalized run is deleted only when the owner types DELETE; a paid
 * run is never deleted; a contractor's statement can be marked paid.
 */
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
let payroll: typeof import("@/app/app/payroll/actions");
let statements: typeof import("@/app/app/payroll/contractors/run-actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
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

const ymd = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

type Company = { org: string; owner: Member; anna: Member; vira: Member };

/** A company with an employee and a contractor, three finished shifts each, and the period prepared. */
async function preparedPeriod(): Promise<Company & { run: string; statement: string }> {
  const org = await addOrg(api.sql, "Pay Co");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  const owner = await addMember(api.sql, org, "owner", "Owner");
  const anna = await addMember(api.sql, org, "employee", "Anna");
  const vira = await addMember(api.sql, org, "employee", "Vira");
  await api.sql("update public.memberships set pay_rate_cents = 2000, engagement = 'employee' where id = $1", [anna.membershipId]);
  await api.sql("update public.memberships set pay_rate_cents = 1800, engagement = 'subcontractor' where id = $1", [vira.membershipId]);
  for (const [who, rate, eng] of [
    [anna, 2000, "employee"],
    [vira, 1800, "subcontractor"],
  ] as const) {
    for (const d of [6, 5, 4]) {
      const start = new Date(`${ymd(d)}T15:00:00Z`);
      await api.sql(
        `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, engagement_snapshot)
         values ($1, $2, $3, $4, $5, $6)`,
        [org, who.membershipId, start.toISOString(), new Date(start.getTime() + 3 * 3_600_000).toISOString(), rate, eng],
      );
    }
  }
  const c = { org, owner, anna, vira };
  await asOwner(c, () => payroll.preparePeriodAction(form({ period_start: ymd(10), period_end: ymd(1) })));
  const [run] = await api.sql<{ id: string }>("select id from public.payroll_runs where organization_id = $1", [org]);
  const [statement] = await api.sql<{ id: string }>("select id from public.subcontractor_pay_runs where organization_id = $1", [org]);
  expect(run && statement, "preparing the period made a pay run and a contractor statement").toBeTruthy();
  return { ...c, run: run.id, statement: statement.id };
}

async function asOwner<T>(c: { owner: Member }, work: () => Promise<T>): Promise<T | string> {
  request.cookies = api.sessionCookies(c.owner.userId);
  try {
    return await work();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("redirected to ")) return message;
    throw err;
  } finally {
    await settle();
  }
}

const runStatus = async (id: string) =>
  (await api.sql<{ status: string }>("select status::text as status from public.payroll_runs where id = $1", [id]))[0]?.status ?? "gone";
const unpaidShifts = async (c: Company) =>
  (
    await api.sql<{ n: number }>(
      "select count(*)::int as n from public.time_entries where employee_id = $1 and payroll_run_id is null",
      [c.anna.membershipId],
    )
  )[0].n;

describe.skipIf(!hasPostgrest)("a pay period, prepared to paid", () => {
  it("draft → finalized → paid, in that order only", async () => {
    const c = await preparedPeriod();
    expect(await runStatus(c.run)).toBe("draft");
    await asOwner(c, () => payroll.markPayrollPaidAction(form({ id: c.run })));
    expect(await runStatus(c.run), "a draft run was marked paid without being finalized").toBe("draft");

    await asOwner(c, () => payroll.finalizePayrollRunAction(form({ id: c.run })));
    expect(await runStatus(c.run)).toBe("finalized");
    await asOwner(c, () => payroll.markPayrollPaidAction(form({ id: c.run })));
    expect(await runStatus(c.run)).toBe("paid");
    expect(await unpaidShifts(c), "her shifts stay on the run that paid them").toBe(0);
  });

  it("deleting a draft run frees its shifts to be paid again", async () => {
    const c = await preparedPeriod();
    expect(await unpaidShifts(c)).toBe(0);
    await asOwner(c, () => payroll.deletePayrollRunAction(form({ id: c.run })));
    expect(await runStatus(c.run)).toBe("gone");
    expect(await unpaidShifts(c)).toBe(3);
  });

  it("a finalized run is deleted only when the owner types DELETE; a paid run never", async () => {
    const c = await preparedPeriod();
    await asOwner(c, () => payroll.finalizePayrollRunAction(form({ id: c.run })));
    await asOwner(c, () => payroll.deletePayrollRunAction(form({ id: c.run, confirm: "" })));
    expect(await runStatus(c.run)).toBe("finalized");
    await asOwner(c, () => payroll.deletePayrollRunAction(form({ id: c.run, confirm: "DELETE" })));
    expect(await runStatus(c.run)).toBe("gone");
    expect(await unpaidShifts(c)).toBe(3);

    const paid = await preparedPeriod();
    await asOwner(paid, () => payroll.finalizePayrollRunAction(form({ id: paid.run })));
    await asOwner(paid, () => payroll.markPayrollPaidAction(form({ id: paid.run })));
    await asOwner(paid, () => payroll.deletePayrollRunAction(form({ id: paid.run, confirm: "DELETE" })));
    expect(await runStatus(paid.run), "a paid run was deleted").toBe("paid");
  });

  it("a contractor's statement is marked paid", async () => {
    const c = await preparedPeriod();
    const res = await asOwner(c, () => statements.markSubcontractorRunPaidAction(form({ run_id: c.statement })));
    const [row] = await api.sql<{ status: string }>("select status::text as status from public.subcontractor_pay_runs where id = $1", [c.statement]);
    expect(row.status, JSON.stringify(res)).toBe("paid");
  });
});

/**
 * A pay rate change starts on a date (2026-11-15).
 *
 * Vira Karpynska's raise was typed in two weeks into the pay period. Every
 * shift freezes the rate at clock-in, so her ten shifts already worked stayed
 * at the old rate and no screen could move them. Three weeks earlier her
 * rate had been lowered with nothing asking.
 *
 * The real employee save against the real stack (test/db/api.ts).
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
let employees: typeof import("@/app/app/employees/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  employees = await import("@/app/app/employees/actions");
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

type Company = { org: string; owner: Member; vira: Member };

async function company(rateCents: number | null = 1700): Promise<Company> {
  const org = await addOrg(api.sql, "Company");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  const owner = await addMember(api.sql, org, "owner", "Owner");
  const vira = await addMember(api.sql, org, "employee", "Vira");
  await api.sql("update public.memberships set display_name = 'Vira Karpynska', pay_rate_cents = $2 where id = $1", [
    vira.membershipId,
    rateCents,
  ]);
  return { org, owner, vira };
}

/** A three-hour shift at noon UTC, `daysAgo` days back, frozen at `snapshot`. */
async function shift(c: Company, daysAgo: number, snapshot: number | null = 1700): Promise<string> {
  const start = new Date(`${ymd(daysAgo)}T12:00:00Z`);
  const [row] = await api.sql<{ id: string }>(
    `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot)
     values ($1, $2, $3::timestamptz, $4::timestamptz, $5) returning id`,
    [c.org, c.vira.membershipId, start.toISOString(), new Date(start.getTime() + 3 * 3_600_000).toISOString(), snapshot],
  );
  return row.id;
}

const frozen = async (id: string) =>
  (await api.sql<{ r: number | null }>("select pay_rate_cents_snapshot as r from public.time_entries where id = $1", [id]))[0].r;
const rateOf = async (c: Company) =>
  (await api.sql<{ r: number | null }>("select pay_rate_cents as r from public.memberships where id = $1", [c.vira.membershipId]))[0].r;
const history = (c: Company) =>
  api.sql<{
    old_rate_cents: number | null;
    new_rate_cents: number | null;
    effective_from: string;
    shifts_repriced: number;
    shifts_on_runs: number;
    owed_cents: number;
    changed_by: string | null;
  }>(
    "select old_rate_cents, new_rate_cents, effective_from::text, shifts_repriced, shifts_on_runs, owed_cents, changed_by from public.pay_rate_changes where membership_id = $1 order by created_at",
    [c.vira.membershipId],
  );

async function save(c: Company, fields: Record<string, string>) {
  request.cookies = api.sessionCookies(c.owner.userId);
  try {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return await employees.updateMemberAction(c.vira.membershipId, {}, form);
  } finally {
    await settle();
  }
}

describe.skipIf(!hasPostgrest)("a pay rate change that starts on a date", () => {
  it("from a date: unpaid shifts from that day take the new rate, earlier ones keep theirs, and the save says so", async () => {
    const c = await company();
    const before = await shift(c, 20);
    const onTheDay = await shift(c, 14);
    const after = await shift(c, 3);

    const res = await save(c, { pay_rate: "18.00", pay_rate_from_mode: "date", pay_rate_from: ymd(14) });
    expect(res.errors, api.log()).toBeUndefined();
    expect(res.notice).toBe("2 unpaid shifts for Vira Karpynska are now at $18.00/hr.");

    expect(await rateOf(c)).toBe(1800);
    expect(await frozen(before)).toBe(1700);
    expect(await frozen(onTheDay)).toBe(1800);
    expect(await frozen(after)).toBe(1800);

    const rows = await history(c);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      old_rate_cents: 1700,
      new_rate_cents: 1800,
      shifts_repriced: 2,
      shifts_on_runs: 0,
      changed_by: c.owner.membershipId,
    });
    expect(rows[0].effective_from.startsWith(ymd(14))).toBe(true);
  });

  it("from now: the rate changes, nothing already worked moves, and the change is still in the history", async () => {
    const c = await company();
    const worked = await shift(c, 2);

    const res = await save(c, { pay_rate: "18.00", pay_rate_from_mode: "now", pay_rate_from: "" });
    expect(res.errors, api.log()).toBeUndefined();
    expect(res.notice).toBeUndefined();
    expect(await rateOf(c)).toBe(1800);
    expect(await frozen(worked)).toBe(1700);
    expect(await history(c)).toHaveLength(1);
  });

  it("a shift already on a pay run is not touched, and the save says what it would add", async () => {
    const c = await company();
    const paid = await shift(c, 5);
    const unpaid = await shift(c, 4);
    const [run] = await api.sql<{ id: string }>(
      `insert into public.payroll_runs (organization_id, period_start, period_end, status)
       values ($1, $2::date, $3::date, 'draft') returning id`,
      [c.org, ymd(10), ymd(1)],
    );
    await api.sql("update public.time_entries set payroll_run_id = $2 where id = $1", [paid, run.id]);

    const res = await save(c, { pay_rate: "18.00", pay_rate_from_mode: "date", pay_rate_from: ymd(10) });
    expect(res.errors, api.log()).toBeUndefined();
    expect(await frozen(paid)).toBe(1700);
    expect(await frozen(unpaid)).toBe(1800);
    expect(res.notice).toContain("1 unpaid shift for Vira Karpynska is now at $18.00/hr.");
    expect(res.notice).toContain("1 shift is already on a pay run and was not changed.");
    expect(res.notice).toContain("would add $3.00");
    expect((await history(c))[0]).toMatchObject({ shifts_repriced: 1, shifts_on_runs: 1, owed_cents: 300 });
  });

  it("a lower rate is refused until it is ticked on purpose, and nothing is written", async () => {
    const c = await company(1800);
    const worked = await shift(c, 2, 1800);

    const refused = await save(c, { pay_rate: "17.00", pay_rate_from_mode: "now", pay_rate_from: "" });
    expect(refused.errors?.pay_rate).toContain("lowers the rate from $18.00 to $17.00");
    expect(await rateOf(c)).toBe(1800);
    expect(await history(c)).toHaveLength(0);

    const ok = await save(c, { pay_rate: "17.00", pay_rate_from_mode: "now", pay_rate_from: "", pay_rate_lower_ok: "1" });
    expect(ok.errors, api.log()).toBeUndefined();
    expect(await rateOf(c)).toBe(1700);
    expect(await frozen(worked)).toBe(1800);
  });

  it("someone with no rate, given one from a date, has those hours priced", async () => {
    const c = await company(null);
    const unpriced = await shift(c, 6, null);

    const res = await save(c, { pay_rate: "20", pay_rate_from_mode: "date", pay_rate_from: ymd(7) });
    expect(res.errors, api.log()).toBeUndefined();
    expect(await frozen(unpriced)).toBe(2000);
    expect((await history(c))[0]).toMatchObject({ old_rate_cents: null, new_rate_cents: 2000, shifts_repriced: 1 });
  });

  it("a future date, or 'from a date' with no date, is refused and nothing is written", async () => {
    const c = await company();
    const future = await save(c, { pay_rate: "18", pay_rate_from_mode: "date", pay_rate_from: ymd(-3) });
    expect(future.errors?.pay_rate).toContain("can't be in the future");
    const blank = await save(c, { pay_rate: "18", pay_rate_from_mode: "date", pay_rate_from: "" });
    expect(blank.errors?.pay_rate).toContain("Pick the date");
    expect(await rateOf(c)).toBe(1700);
    expect(await history(c)).toHaveLength(0);
  });

  it("a save that leaves the rate alone writes no history and moves no shift", async () => {
    const c = await company();
    const worked = await shift(c, 2);
    const res = await save(c, { pay_rate: "17.00", display_name: "Vira Karpynska" });
    expect(res.errors, api.log()).toBeUndefined();
    expect(await history(c)).toHaveLength(0);
    expect(await frozen(worked)).toBe(1700);
  });

  it("another person's shifts, and another company's, are not touched", async () => {
    const c = await company();
    const other = await addMember(api.sql, c.org, "employee", "Other");
    const [theirs] = await api.sql<{ id: string }>(
      `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot)
       values ($1, $2, now() - interval '2 days', now() - interval '2 days' + interval '3 hours', 1700) returning id`,
      [c.org, other.membershipId],
    );
    await shift(c, 2);
    await save(c, { pay_rate: "18", pay_rate_from_mode: "date", pay_rate_from: ymd(5) });
    expect(await frozen(theirs.id)).toBe(1700);
  });

  it("the history cannot be read with a signed-in person's own key", async () => {
    const c = await company();
    await save(c, { pay_rate: "18", pay_rate_from_mode: "now", pay_rate_from: "" });
    const res = await fetch(`${api.url}/rest/v1/pay_rate_changes?select=id`, {
      headers: { apikey: api.anonKey, authorization: `Bearer ${api.tokenFor(c.vira.userId)}` },
    });
    const body = await res.json();
    expect(Array.isArray(body) ? body : []).toEqual([]);
  });
});

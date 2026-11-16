/**
 * The cleaner's Clock tab: a shift that is not a job (travel, supplies,
 * training, other), clocked in and out through the app's own actions, as
 * the cleaner, against a real database behind the real PostgREST.
 *
 * What it owes her pay: one open shift at a time, a reason for every
 * off-job shift, a few words when the reason is "other", and a clock-out
 * only when there is something to close.
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
let clock: typeof import("@/app/field/clock/actions");

beforeAll(async () => {
  // Shift notes are stored encrypted; production has the key, the test gets its own.
  process.env.INTEGRATION_ENCRYPTION_KEY ??= `base64:${randomBytes(32).toString("base64")}`;
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  clock = await import("@/app/field/clock/actions");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

async function cleaner(): Promise<{ org: string; anna: Member }> {
  const org = await addOrg(api.sql, "Clock Co");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  await addMember(api.sql, org, "owner", "Owner");
  const anna = await addMember(api.sql, org, "employee", "Anna");
  await api.sql("update public.memberships set pay_rate_cents = 2200 where id = $1", [anna.membershipId]);
  return { org, anna };
}

async function asAnna<T>(anna: Member, work: () => Promise<T>): Promise<T> {
  request.cookies = api.sessionCookies(anna.userId);
  try {
    return await work();
  } finally {
    await settle();
  }
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const said = (r: unknown) => JSON.stringify(r);

const shifts = (anna: Member) =>
  api.sql<{ category: string | null; open: boolean; rate: number | null }>(
    "select work_category as category, clock_out_at is null as open, pay_rate_cents_snapshot as rate from public.time_entries where employee_id = $1 order by clock_in_at",
    [anna.membershipId],
  );

describe.skipIf(!hasPostgrest)("the cleaner's Clock tab", () => {
  it("a travel shift: clocked in once, a second clock-in refused, clocked out", async () => {
    const { anna } = await cleaner();
    expect(await asAnna(anna, () => clock.clockInAction(form({ work_category: "travel", note: "" })))).toMatchObject({ ok: true });
    expect(await shifts(anna)).toMatchObject([{ category: "travel", open: true, rate: 2200 }]);

    expect(said(await asAnna(anna, () => clock.clockInAction(form({ work_category: "supplies", note: "" }))))).toMatch(/already clocked in/);
    expect(await shifts(anna)).toHaveLength(1);

    expect(await asAnna(anna, () => clock.clockOutAction(form({})))).toMatchObject({ ok: true });
    expect(await shifts(anna)).toMatchObject([{ category: "travel", open: false }]);
  });

  it("no reason given: refused in words, nothing on the clock", async () => {
    const { anna } = await cleaner();
    expect(said(await asAnna(anna, () => clock.clockInAction(form({ work_category: "", note: "" }))))).toMatch(/Pick what this shift is for/);
    expect(await shifts(anna)).toHaveLength(0);
  });

  it("'other' needs a few words", async () => {
    const { anna } = await cleaner();
    expect(said(await asAnna(anna, () => clock.clockInAction(form({ work_category: "other", note: "" }))))).toMatch(/Say a few words/);
    expect(await asAnna(anna, () => clock.clockInAction(form({ work_category: "other", note: "Picking up keys from the office" })))).toMatchObject({ ok: true });
    expect(await shifts(anna)).toMatchObject([{ category: "other", open: true }]);
  });

  it("clocking out with nothing open is refused in words", async () => {
    const { anna } = await cleaner();
    expect(said(await asAnna(anna, () => clock.clockOutAction(form({}))))).toMatch(/not clocked in/);
  });
});

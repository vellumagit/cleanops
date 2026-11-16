/**
 * Hours that become pay, through the office's own timesheet actions, against
 * a real database behind the real PostgREST.
 *
 * What each owes payroll: a manual entry is priced at the cleaner's rate and
 * cannot overlap a shift she already has; a stray punch can be put on her
 * job but never on another company's; a flagged shift is confirmed once;
 * and hours already on a pay run cannot be edited or deleted from under it.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
let timesheets: typeof import("@/app/app/timesheets/actions");

beforeAll(async () => {
  // Shift notes are stored encrypted; production has the key, the test gets its own.
  process.env.INTEGRATION_ENCRYPTION_KEY ??= `base64:${randomBytes(32).toString("base64")}`;
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  timesheets = await import("@/app/app/timesheets/actions");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

type Company = { org: string; client: string; owner: Member; anna: Member };

async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Hours Co");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  const anna = await addMember(api.sql, org, "employee", "Anna");
  await api.sql("update public.memberships set pay_rate_cents = 2200 where id = $1", [anna.membershipId]);
  return { org, client: await addClient(api.sql, org), owner: await addMember(api.sql, org, "owner", "Owner"), anna };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
/** What a datetime-local field sends, in the company's zone (UTC here). */
const local = (iso: string) => iso.slice(0, 16);

async function asOwner<T>(c: Company, work: () => Promise<T>): Promise<T> {
  request.cookies = api.sessionCookies(c.owner.userId);
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

async function shift(c: Company, startHoursAgo: number, hours: number, opts: { booking?: string | null; flagged?: boolean } = {}) {
  const [row] = await api.sql<{ id: string }>(
    `insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, engagement_snapshot, needs_review)
     values ($1, $2, $3, $4, $5, 2200, 'employee', $6) returning id`,
    [c.org, c.anna.membershipId, opts.booking ?? null, hoursAgo(startHoursAgo), hoursAgo(startHoursAgo - hours), opts.flagged ?? false],
  );
  return row.id;
}

async function onAPayRun(c: Company, entryId: string) {
  const [run] = await api.sql<{ id: string }>(
    `insert into public.payroll_runs (organization_id, period_start, period_end, status, total_cents, created_by)
     values ($1, current_date - 14, current_date, 'finalized', 6600, $2) returning id`,
    [c.org, c.owner.membershipId],
  );
  await api.sql("update public.time_entries set payroll_run_id = $2 where id = $1", [entryId, run.id]);
}

const entries = (c: Company) =>
  api.sql<{ id: string; minutes: number; manual: boolean; rate: number | null; booking_id: string | null; needs_review: boolean }>(
    `select id, round(extract(epoch from (clock_out_at - clock_in_at)) / 60)::int as minutes, created_manually as manual,
            pay_rate_cents_snapshot as rate, booking_id, needs_review
       from public.time_entries where employee_id = $1 order by clock_in_at`,
    [c.anna.membershipId],
  );

describe.skipIf(!hasPostgrest)("timesheets, through the office's own actions", () => {
  it("a manual entry: three hours yesterday, priced at her rate, marked as entered by the office", async () => {
    const c = await company();
    const res = await asOwner(c, () =>
      timesheets.createManualTimeEntryAction(
        form({ employee_id: c.anna.membershipId, start_at: local(hoursAgo(27)), end_at: local(hoursAgo(24)), notes: "Phone died on site", booking_id: "" }),
      ),
    );
    expect(res).toMatchObject({ ok: true });
    expect(await entries(c)).toMatchObject([{ minutes: 180, manual: true, rate: 2200 }]);
  });

  it("a manual entry that overlaps a shift she already has is refused in words, and nothing is added", async () => {
    const c = await company();
    await shift(c, 30, 4);
    const res = await asOwner(c, () =>
      timesheets.createManualTimeEntryAction(
        form({ employee_id: c.anna.membershipId, start_at: local(hoursAgo(29)), end_at: local(hoursAgo(27)), notes: "", booking_id: "" }),
      ),
    );
    expect(res).toMatchObject({ ok: false });
    expect((res as { error?: string }).error ?? "").not.toBe("");
    expect(await entries(c)).toHaveLength(1);
  });

  it("deleting an entry removes it; one already on a pay run is refused", async () => {
    const c = await company();
    const loose = await shift(c, 50, 3);
    const paid = await shift(c, 30, 3);
    await onAPayRun(c, paid);
    expect(await asOwner(c, () => timesheets.deleteTimeEntryAction(form({ id: loose })))).toMatchObject({ ok: true });
    const refused = await asOwner(c, () => timesheets.deleteTimeEntryAction(form({ id: paid })));
    expect(refused).toMatchObject({ ok: false });
    expect((await entries(c)).map((e) => e.id)).toEqual([paid]);
  });

  it("editing hours already on a pay run is refused, and the hours stay as paid", async () => {
    const c = await company();
    const paid = await shift(c, 30, 3);
    await onAPayRun(c, paid);
    const res = await asOwner(c, () =>
      timesheets.updateTimeEntryAction(
        form({ id: paid, employee_id: c.anna.membershipId, booking_id: "", start_at: local(hoursAgo(30)), end_at: local(hoursAgo(22)) }),
      ),
    );
    expect(res).toMatchObject({ ok: false });
    expect((await entries(c))[0].minutes).toBe(180);
  });

  it("a stray punch goes onto her job; never onto another company's", async () => {
    const c = await company();
    const job = await addBooking(api.sql, c.org, c.client, { scheduledAt: hoursAgo(30), status: "completed" });
    // She has to be on the job before her hours can go on it.
    await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id) values ($1, $2, $3)", [c.org, job, c.anna.membershipId]);
    const stray = await shift(c, 30, 3);
    expect(await asOwner(c, () => timesheets.attachEntryToBookingAction(form({ id: stray, booking_id: job })))).toMatchObject({ ok: true });
    expect((await entries(c))[0].booking_id).toBe(job);

    const other = await company();
    const theirs = await addBooking(api.sql, other.org, other.client, { scheduledAt: hoursAgo(30), status: "completed" });
    const second = await shift(c, 60, 2);
    const refused = await asOwner(c, () => timesheets.attachEntryToBookingAction(form({ id: second, booking_id: theirs })));
    expect(refused).toMatchObject({ ok: false });
    const [row] = await api.sql<{ booking_id: string | null }>("select booking_id from public.time_entries where id = $1", [second]);
    expect(row.booking_id).toBeNull();
  });

  it("a flagged shift (the system capped it) is confirmed, and is no longer waiting for review", async () => {
    const c = await company();
    const flagged = await shift(c, 30, 3, { flagged: true });
    expect(await asOwner(c, () => timesheets.confirmTimeEntryAction(form({ id: flagged })))).toMatchObject({ ok: true });
    expect((await entries(c))[0].needs_review).toBe(false);
  });
});

/**
 * Creating a recurring booking (createRecurringBookingAction), through the
 * app's own action as the owner, against a real database behind the real
 * PostgREST. The company keeps time in America/Regina (UTC-6 all year, the
 * same as Alberta from November 2026), so a 10:00 visit is 16:00 UTC.
 *
 * What it owes the schedule: every visit falls on the days the rule says,
 * at the local time typed, with the cleaner on it and the series price; a
 * cleaner already busy on one of the dates is refused in words naming it,
 * and nothing is left behind; a rule that cannot make a visit, or ends
 * before it starts, is refused without leaving an empty series.
 */
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
let bookings: typeof import("@/app/app/bookings/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  bookings = await import("@/app/app/bookings/actions");
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
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The first given weekday (0 = Sunday) at least a week out, as YYYY-MM-DD. */
function nextWeekday(dow: number): string {
  const now = new Date();
  let d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 7 * DAY;
  while (new Date(d).getUTCDay() !== dow) d += DAY;
  return ymd(d);
}

type Company = { org: string; client: string; service: string; owner: Member; anna: Member };

async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Series Co");
  await api.sql("update public.organizations set timezone = 'America/Regina' where id = $1", [org]);
  const [service] = await api.sql<{ id: string }>(
    "insert into public.service_types (organization_id, name) values ($1, 'Standard clean') returning id",
    [org],
  );
  return {
    org,
    client: await addClient(api.sql, org, "Patrick Hackett"),
    service: service.id,
    owner: await addMember(api.sql, org, "owner", "Owner"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
}

async function create(c: Company, fields: Record<string, string>): Promise<string> {
  const f = new FormData();
  const all: Record<string, string> = {
    client_id: c.client,
    assigned_to: c.anna.membershipId,
    recurrence_pattern: "weekly",
    custom_days: "",
    monthly_nth: "",
    monthly_dow: "",
    start_time: "10:00",
    starts_at: nextWeekday(2),
    ends_at: "",
    generate_ahead: "6",
    duration_minutes: "120",
    service_type: "recurring",
    service_type_id: c.service,
    service_type_label: "Standard clean",
    total_cents: "150",
    address: "12 Elm St",
    notes: "",
    ...fields,
  };
  for (const [k, v] of Object.entries(all)) f.set(k, v);
  request.cookies = api.sessionCookies(c.owner.userId);
  try {
    const res = await bookings.createRecurringBookingAction({}, f);
    return `returned ${JSON.stringify(res)}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  } finally {
    await settle();
  }
}

/** The visits as the company sees them: local date, weekday and time. */
const visits = (c: Company) =>
  api.sql<{ date: string; dow: number; time: string; total: number; crew: string[]; series: string | null }>(
    `select to_char(scheduled_at at time zone 'America/Regina', 'YYYY-MM-DD') as date,
            extract(dow from scheduled_at at time zone 'America/Regina')::int as dow,
            to_char(scheduled_at at time zone 'America/Regina', 'HH24:MI') as time,
            total_cents as total, series_id as series,
            coalesce((select array_agg(a.membership_id::text) from public.booking_assignees a where a.booking_id = b.id), '{}') as crew
       from public.bookings b where client_id = $1 order by scheduled_at`,
    [c.client],
  );

const seriesCount = async (c: Company) =>
  (await api.sql<{ n: number }>("select count(*)::int as n from public.booking_series where client_id = $1", [c.client]))[0].n;

describe.skipIf(!hasPostgrest)("creating a recurring booking", () => {
  it("weekly on Tuesdays at 10:00: six visits, a week apart, 10:00 local, Anna on each, $150 each", async () => {
    const c = await company();
    const start = nextWeekday(2);
    expect(await create(c, { starts_at: start }), api.log()).toMatch(/^redirected to /);
    const rows = await visits(c);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.date)).toEqual([0, 1, 2, 3, 4, 5].map((w) => ymd(Date.parse(`${start}T12:00:00Z`) + w * 7 * DAY)));
    for (const r of rows) {
      expect(r).toMatchObject({ dow: 2, time: "10:00", total: 15000, crew: [c.anna.membershipId] });
    }
    expect(new Set(rows.map((r) => r.series)).size).toBe(1);
    const [s] = await api.sql<{ pattern: string; total: number }>("select pattern, total_cents as total from public.booking_series where client_id = $1", [c.client]);
    expect(s).toEqual({ pattern: "weekly", total: 15000 });
  });

  it("every two weeks: visits fourteen days apart", async () => {
    const c = await company();
    expect(await create(c, { recurrence_pattern: "bi_weekly", generate_ahead: "4" })).toMatch(/^redirected to /);
    const days = (await visits(c)).map((r) => Date.parse(`${r.date}T12:00:00Z`) / DAY);
    expect(days.slice(1).map((d, i) => d - days[i])).toEqual([14, 14, 14]);
  });

  it("custom weekly, Mondays and Thursdays: visits on those two days and no others", async () => {
    const c = await company();
    expect(await create(c, { recurrence_pattern: "custom_weekly", custom_days: "1,4", starts_at: nextWeekday(1), generate_ahead: "6" })).toMatch(/^redirected to /);
    const rows = await visits(c);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.dow)).toEqual([1, 4, 1, 4, 1, 4]);
  });

  it("monthly on the second Tuesday: each visit is its month's second Tuesday", async () => {
    const c = await company();
    expect(await create(c, { recurrence_pattern: "monthly_nth", monthly_nth: "2", monthly_dow: "2", generate_ahead: "4" })).toMatch(/^redirected to /);
    const rows = await visits(c);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      const dayOfMonth = Number(r.date.slice(8, 10));
      expect(r.dow, r.date).toBe(2);
      expect(dayOfMonth, r.date).toBeGreaterThanOrEqual(8);
      expect(dayOfMonth, r.date).toBeLessThanOrEqual(14);
    }
    expect(new Set(rows.map((r) => r.date.slice(0, 7))).size).toBe(4);
  });

  // Until 2026-11-19 this was refused whole: "already booked", the date
  // named, no series. Now the series is made, Anna is on every visit she is
  // free for, and the third Tuesday is marked as needing cover.
  it("Anna is already booked on the third Tuesday: the series is made, she is left off that one visit, and it is marked", async () => {
    const c = await company();
    const start = nextWeekday(2);
    const third = ymd(Date.parse(`${start}T12:00:00Z`) + 14 * DAY);
    const other = await addClient(api.sql, c.org, "Sylvia Gillespie");
    const busy = await addBooking(api.sql, c.org, other, { scheduledAt: `${third}T16:30:00.000Z`, durationMinutes: 120, status: "confirmed" });
    await api.sql("update public.bookings set assigned_to = $2 where id = $1", [busy, c.anna.membershipId]);
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status) values ($1, $2, $3, true, 'accepted')",
      [c.org, busy, c.anna.membershipId],
    );

    const res = await create(c, { starts_at: start });
    expect(await seriesCount(c), api.log()).toBe(1);
    const rows = await visits(c);
    // Lands on the list with the banner for this series.
    expect(res).toBe(`redirected to /app/bookings?cover=${rows[0].series}`);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) {
      expect(r.crew, r.date).toEqual(r.date === third ? [] : [c.anna.membershipId]);
    }
    const marked = await api.sql<{ date: string; lead: string | null; cover: Array<{ membership_id: string; other_booking_id: string }> }>(
      `select to_char(scheduled_at at time zone 'America/Regina', 'YYYY-MM-DD') as date, assigned_to as lead, cover_needed as cover
         from public.bookings where client_id = $1 and cover_needed is not null`,
      [c.client],
    );
    expect(marked).toEqual([{ date: third, lead: null, cover: [{ membership_id: c.anna.membershipId, other_booking_id: busy }] }]);

    // What the banner and the dashboard read.
    const { loadCoverNeeded } = await import("@/lib/cover-needed");
    const { coverReason, coverSummary } = await import("@/lib/cover-needed-text");
    const cover = await loadCoverNeeded(c.org, { seriesId: rows[0].series! });
    expect(cover).toHaveLength(1);
    expect(cover[0].people[0]).toMatchObject({ membershipId: c.anna.membershipId, otherClient: expect.stringContaining("Sylvia Gillespie") });
    expect(coverReason(cover[0], "America/Regina")).toMatch(/is on another job then \(Sylvia Gillespie \d+, 10:30 AM\)$/);
    expect(coverSummary(cover, "America/Regina", rows.length)).toContain(`is on another job on 1 of the ${rows.length} visits`);
    // Another company can't read it.
    const other2 = await company();
    expect(await loadCoverNeeded(other2.org, { seriesId: rows[0].series! })).toEqual([]);
  });

  it("a series with nobody on it, and one whose crew is free throughout, mark nothing", async () => {
    const c = await company();
    expect(await create(c, { assigned_to: "" }), api.log()).toBe("redirected to /app/bookings");
    expect(await create(c, { start_time: "14:00" })).toBe("redirected to /app/bookings");
    const rows = await api.sql<{ n: number }>("select count(*)::int as n from public.bookings where client_id = $1 and cover_needed is not null", [c.client]);
    expect(rows[0].n).toBe(0);
  });

  it("custom weekly with no days picked, or an end before the start: refused, no empty series", async () => {
    const c = await company();
    expect(await create(c, { recurrence_pattern: "custom_weekly", custom_days: "" })).toMatch(/at least one day/);
    const start = nextWeekday(2);
    expect(await create(c, { starts_at: start, ends_at: ymd(Date.parse(`${start}T12:00:00Z`) - 7 * DAY) })).toMatch(/end date is before the start/);
    expect(await seriesCount(c)).toBe(0);
    expect(await visits(c)).toEqual([]);
  });
});

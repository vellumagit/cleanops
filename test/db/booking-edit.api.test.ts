/**
 * The booking edit form (updateBookingAction), saved through the app's own
 * action as the owner, against a real database behind the real PostgREST:
 * "this visit only" and "this and all future" on a weekly series.
 *
 * What each owes the schedule: this-visit-only touches that visit alone;
 * this-and-future carries the change to every later visit and the series
 * itself, leaving earlier visits as they were; a save that leaves the
 * schedule as it was keeps every later visit (same rows, nothing rebuilt);
 * moving this visit to another weekday moves the rest of the series with
 * it; a billed job's price does not change from under its invoice; and a
 * cleaner cannot edit a booking at all.
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
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** The first Thursday at least a week out, midnight UTC. */
function firstThursday(): number {
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  let d = today + 7 * DAY;
  while (new Date(d).getUTCDay() !== 4) d += DAY;
  return d;
}

type Series = {
  org: string;
  client: string;
  service: string;
  owner: Member;
  anna: Member;
  series: string;
  visits: string[];
  base: number;
};

/** A weekly Thursday 9:00 series with four visits, $140 each. */
async function weeklySeries(): Promise<Series> {
  const org = await addOrg(api.sql, "Edit Co");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  const client = await addClient(api.sql, org, "Helena Lane");
  const owner = await addMember(api.sql, org, "owner", "Owner");
  const anna = await addMember(api.sql, org, "employee", "Anna");
  const [service] = await api.sql<{ id: string }>(
    "insert into public.service_types (organization_id, name) values ($1, 'Standard clean') returning id",
    [org],
  );
  const base = firstThursday();
  const [series] = await api.sql<{ id: string }>(
    `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes, assigned_to, total_cents)
     values ($1, $2, 'weekly', '09:00', $3, 120, $4, 14000) returning id`,
    [org, client, ymd(base), anna.membershipId],
  );
  const visits: string[] = [];
  for (let w = 0; w < 4; w++) {
    const id = await addBooking(api.sql, org, client, {
      scheduledAt: `${ymd(base + w * 7 * DAY)}T09:00:00.000Z`,
      durationMinutes: 120,
      status: "confirmed",
    });
    await api.sql(
      "update public.bookings set series_id = $2, assigned_to = $3, total_cents = 14000, service_type_id = $4, service_type_label = 'Standard clean' where id = $1",
      [id, series.id, anna.membershipId, service.id],
    );
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status) values ($1, $2, $3, true, 'accepted')",
      [org, id, anna.membershipId],
    );
    visits.push(id);
  }
  return { org, client, service: service.id, owner, anna, series: series.id, visits, base };
}

/** The edit form as the page posts it for one visit. */
function editForm(s: Series, visitIndex: number, change: Record<string, string>) {
  const oldAt = `${ymd(s.base + visitIndex * 7 * DAY)}T09:00`;
  const f = new FormData();
  const fields: Record<string, string> = {
    client_id: s.client,
    assigned_to: s.anna.membershipId,
    scheduled_at: oldAt,
    duration_minutes: "120",
    service_type: "standard",
    service_type_id: s.service,
    service_type_label: "Standard clean",
    status: "confirmed",
    total_cents: "140",
    address: "",
    notes: "",
    splits: "[]",
    notify_client: "0",
    series_id: s.series,
    series_scheduled_at: `${oldAt}:00.000Z`,
    update_scope: "this_only",
    ...change,
  };
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** The schedule section of the form, as it pre-fills for this visit. */
const sameSchedule = (s: Series, visitIndex: number) => ({
  series_update_schedule: "1",
  series_pattern: "weekly",
  series_start_time: "09:00",
  series_starts_at: ymd(s.base + visitIndex * 7 * DAY),
  series_ends_at: "",
  series_custom_days: "",
  series_monthly_nth: "",
  series_monthly_dow: "",
});

async function save(as: Member, id: string, form: FormData): Promise<string> {
  request.cookies = api.sessionCookies(as.userId);
  try {
    const res = await bookings.updateBookingAction(id, {}, form);
    return `returned ${JSON.stringify(res)}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  } finally {
    await settle();
  }
}

const seriesVisits = (s: Series) =>
  api.sql<{ id: string; date: string; time: string; total: number; notes: string | null }>(
    `select id, to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD') as date, to_char(scheduled_at at time zone 'UTC', 'HH24:MI') as time,
            total_cents as total, notes
       from public.bookings where series_id = $1 and status <> 'cancelled' order by scheduled_at`,
    [s.series],
  );

describe.skipIf(!hasPostgrest)("the booking edit form on a weekly series", () => {
  it("this visit only: the price and note change on that visit and nowhere else", async () => {
    const s = await weeklySeries();
    const res = await save(s.owner, s.visits[1], editForm(s, 1, { total_cents: "175", notes: "Use the side door" }));
    expect(res, api.log()).toMatch(/^redirected to /);
    const rows = await seriesVisits(s);
    expect(rows.map((r) => r.id)).toEqual(s.visits);
    expect(rows.map((r) => r.total)).toEqual([14000, 17500, 14000, 14000]);
    expect(rows.map((r) => r.notes)).toEqual([null, "Use the side door", null, null]);
    const [series] = await api.sql<{ total: number }>("select total_cents as total from public.booking_series where id = $1", [s.series]);
    expect(series.total).toBe(14000);
  });

  it("this and all future: later visits and the series take the change, the earlier visit keeps its own", async () => {
    const s = await weeklySeries();
    const res = await save(s.owner, s.visits[1], editForm(s, 1, { total_cents: "175", notes: "Use the side door", update_scope: "this_and_future" }));
    expect(res, api.log()).toMatch(/^redirected to /);
    const rows = await seriesVisits(s);
    expect(rows.map((r) => r.id), "same visits, none rebuilt").toEqual(s.visits);
    expect(rows.map((r) => r.total)).toEqual([14000, 17500, 17500, 17500]);
    expect(rows.map((r) => r.notes)).toEqual([null, "Use the side door", "Use the side door", "Use the side door"]);
    const [series] = await api.sql<{ total: number }>("select total_cents as total from public.booking_series where id = $1", [s.series]);
    expect(series.total).toBe(17500);
  });

  it("this and all future with the schedule section shown but untouched: nothing is rebuilt", async () => {
    // The form pre-fills "starts" with this visit's date. Read as a new
    // schedule, that once rebuilt every later visit on a price-only save.
    const s = await weeklySeries();
    const res = await save(
      s.owner,
      s.visits[2],
      editForm(s, 2, { total_cents: "160", update_scope: "this_and_future", ...sameSchedule(s, 2) }),
    );
    expect(res, api.log()).toMatch(/^redirected to /);
    const rows = await seriesVisits(s);
    expect(rows.map((r) => r.id), "same visits, none rebuilt").toEqual(s.visits);
    expect(rows.map((r) => r.total)).toEqual([14000, 14000, 16000, 16000]);
  });

  it("this and all future, the visit moved from Thursday to Wednesday: the rest of the series moves with it", async () => {
    const s = await weeklySeries();
    const wednesday = ymd(s.base + 7 * DAY - DAY);
    const res = await save(
      s.owner,
      s.visits[1],
      editForm(s, 1, { scheduled_at: `${wednesday}T09:00`, update_scope: "this_and_future", ...sameSchedule(s, 1) }),
    );
    expect(res, api.log()).toMatch(/^redirected to /);
    const rows = await seriesVisits(s);
    expect(rows[0]).toMatchObject({ id: s.visits[0], date: ymd(s.base) });
    expect(rows[1]).toMatchObject({ id: s.visits[1], date: wednesday, time: "09:00" });
    const later = rows.slice(2);
    expect(later.length).toBeGreaterThanOrEqual(2);
    expect(later.map((r) => weekday(r.date)), "every later visit on a Wednesday").toEqual(later.map(() => 3));
    expect(later.map((r) => r.time)).toEqual(later.map(() => "09:00"));
    // One a week, no two on the same day.
    expect(new Set(rows.map((r) => r.date)).size).toBe(rows.length);
  });

  it("this and all future, moved from 9:00 to 10:00: a skipped week stays out and a cancelled week stays cancelled", async () => {
    const s = await weeklySeries();
    // Week 2 was taken out with "Skip this one" (row gone, date on the
    // series' skip list); week 3 was cancelled on its own, a client's skip.
    await api.sql("delete from public.bookings where id = $1", [s.visits[2]]);
    await api.sql("update public.booking_series set skip_dates = array[$2::date] where id = $1", [s.series, ymd(s.base + 2 * 7 * DAY)]);
    await api.sql("update public.bookings set status = 'cancelled' where id = $1", [s.visits[3]]);

    const thisWeek = ymd(s.base + 7 * DAY);
    const res = await save(
      s.owner,
      s.visits[1],
      editForm(s, 1, {
        scheduled_at: `${thisWeek}T10:00`,
        update_scope: "this_and_future",
        ...sameSchedule(s, 1),
        series_start_time: "10:00",
      }),
    );
    expect(res, api.log()).toMatch(/^redirected to /);

    const rows = await seriesVisits(s);
    const dates = rows.map((r) => r.date);
    expect(dates).toContain(thisWeek);
    expect(dates, "the skipped week is not booked again").not.toContain(ymd(s.base + 2 * 7 * DAY));
    expect(dates, "the cancelled week is not booked again at the new time").not.toContain(ymd(s.base + 3 * 7 * DAY));
    expect(dates, "the series goes on after them").toContain(ymd(s.base + 4 * 7 * DAY));
    expect(rows.slice(1).map((r) => r.time)).toEqual(rows.slice(1).map(() => "10:00"));
    const [cancelled] = await api.sql<{ status: string }>("select status::text as status from public.bookings where id = $1", [s.visits[3]]);
    expect(cancelled.status).toBe("cancelled");
  });

  it("a finished job an invoice bills: its price does not change from under the invoice", async () => {
    const s = await weeklySeries();
    const done = await addBooking(api.sql, s.org, s.client, { scheduledAt: new Date(Date.now() - 3 * DAY).toISOString(), durationMinutes: 120, status: "completed" });
    await api.sql(
      "update public.bookings set total_cents = 14000, assigned_to = $2, service_type_id = $3 where id = $1",
      [done, s.anna.membershipId, s.service],
    );
    const [inv] = await api.sql<{ id: string }>(
      "insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents) values ($1, $2, $3, 'sent', 14000) returning id",
      [s.org, s.client, done],
    );
    await api.sql("update public.bookings set billing_invoice_id = $2 where id = $1", [done, inv.id]);
    const [{ at }] = await api.sql<{ at: string }>("select to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI') as at from public.bookings where id = $1", [done]);

    const f = editForm(s, 0, { scheduled_at: at, status: "completed", total_cents: "200", series_id: "", series_scheduled_at: "" });
    const res = await save(s.owner, done, f);
    expect(res).toMatch(/already bills this job/);
    const [row] = await api.sql<{ total: number }>("select total_cents as total from public.bookings where id = $1", [done]);
    expect(row.total).toBe(14000);
  });

  it("a cleaner cannot edit a booking, for one visit or the whole series", async () => {
    const s = await weeklySeries();
    const res = await save(s.anna, s.visits[1], editForm(s, 1, { total_cents: "1", update_scope: "this_and_future" }));
    expect(res).toMatch(/permission/);
    expect((await seriesVisits(s)).map((r) => r.total)).toEqual([14000, 14000, 14000, 14000]);
  });
});

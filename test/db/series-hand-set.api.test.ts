/**
 * A series save and the visits someone changed by hand
 * (src/lib/series-hand-set.ts, migration 20261124040000).
 *
 * "This and all future" used to put every later visit back in line with the
 * series: its crew on all of them, and, when the day or time changed, every
 * later visit deleted and written again. A visit dragged to another day, or
 * given its own cleaner for one week, was undone by the next series save
 * with nothing said. Svitlana fixes visits one at a time, so each fix lasted
 * only until the series was next saved.
 *
 * The real actions against the real stack (test/db/api.ts):
 *   - setting one visit's crew marks it; a drag onto another cleaner too
 *   - a save that is not about the crew keeps that crew without asking
 *   - a save that would override a hand-changed visit asks first and writes
 *     nothing; Keep leaves it, Change them too replaces it
 *   - the same for a visit moved by hand when the series itself moves
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
let scheduling: typeof import("@/app/app/scheduling/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  bookings = await import("@/app/app/bookings/actions");
  scheduling = await import("@/app/app/scheduling/actions");
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
  bea: Member;
  vira: Member;
  series: string;
  visits: string[];
  base: number;
};

/** A weekly Thursday 9:00 series, four visits, Anna on each, $140. */
async function weeklySeries(): Promise<Series> {
  const org = await addOrg(api.sql, "Hand Set Co");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  const client = await addClient(api.sql, org, "Nella Cotesta");
  const owner = await addMember(api.sql, org, "owner", "Owner");
  const anna = await addMember(api.sql, org, "employee", "Anna");
  const bea = await addMember(api.sql, org, "employee", "Bea");
  const vira = await addMember(api.sql, org, "employee", "Vira");
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
  return { org, client, service: service.id, owner, anna, bea, vira, series: series.id, visits, base };
}

/** The edit form as the page posts it for one visit, at the time it has now. */
function editForm(s: Series, visitIndex: number, change: Record<string, string>, nowAt?: string) {
  const oldAt = nowAt ?? `${ymd(s.base + visitIndex * 7 * DAY)}T09:00`;
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

type Saved = { redirected?: string; errors?: Record<string, string>; values?: Record<string, string> };

async function save(as: Member, id: string, form: FormData): Promise<Saved> {
  request.cookies = api.sessionCookies(as.userId);
  try {
    return (await bookings.updateBookingAction(id, {}, form)) as Saved;
  } catch (err) {
    const m = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
    if (m) return { redirected: m[1] };
    throw err;
  } finally {
    await settle();
  }
}

type Row = {
  id: string;
  at: string;
  dow: number;
  crew: string[];
  total: number;
  moved: boolean;
  own: boolean;
};
const rows = (s: Series) =>
  api.sql<Row>(
    `select b.id,
            to_char(b.scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as at,
            extract(dow from b.scheduled_at at time zone 'UTC')::int as dow,
            coalesce((select array_agg(ba.membership_id order by ba.membership_id) from public.booking_assignees ba where ba.booking_id = b.id), '{}') as crew,
            b.total_cents as total,
            b.time_set_by_hand_at is not null as moved,
            b.crew_set_by_hand_at is not null as own
       from public.bookings b
      where b.series_id = $1 and b.status <> 'cancelled'
      order by b.scheduled_at`,
    [s.series],
  );
const byId = async (s: Series, id: string) => (await rows(s)).find((r) => r.id === id);

/** Bea on the third visit only, set the way the office sets it. */
async function beaOnThird(s: Series) {
  const res = await save(s.owner, s.visits[2], editForm(s, 2, { assigned_to: s.bea.membershipId }));
  expect(res.redirected, api.log()).toBeTruthy();
}

describe.skipIf(!hasPostgrest)("a series save and the visits changed by hand", () => {
  it("is safe to run the database change twice", async () => {
    const { readFileSync } = await import("node:fs");
    await api.db.exec(readFileSync("supabase/migrations/20261124040000_series_keeps_hand_set_visits.sql", "utf8"));
  });

  it("another cleaner on just this booking marks that visit, and only that one", async () => {
    const s = await weeklySeries();
    await beaOnThird(s);
    const all = await rows(s);
    expect(all.map((r) => r.own)).toEqual([false, false, true, false]);
    expect(all[2].crew).toEqual([s.bea.membershipId]);

    // Saving a visit again without touching its crew marks nothing.
    await save(s.owner, s.visits[1], editForm(s, 1, { notes: "Side door" }));
    expect((await byId(s, s.visits[1]))?.own).toBe(false);
  });

  it("a price change for this and all future keeps that visit's cleaner, and asks nothing", async () => {
    const s = await weeklySeries();
    await beaOnThird(s);
    const res = await save(s.owner, s.visits[1], editForm(s, 1, { total_cents: "175", update_scope: "this_and_future" }));
    expect(res.errors, api.log()).toBeUndefined();
    expect(res.redirected).toBeTruthy();
    expect(res.redirected, "kept without asking is not news").not.toContain("kept=");

    const all = await rows(s);
    expect(all.map((r) => r.id), "same visits").toEqual(s.visits);
    expect(all.map((r) => r.total)).toEqual([14000, 17500, 17500, 17500]);
    expect(all.map((r) => r.crew)).toEqual([
      [s.anna.membershipId],
      [s.anna.membershipId],
      [s.bea.membershipId],
      [s.anna.membershipId],
    ]);
    expect(all[2].own, "still hers to keep next time").toBe(true);
  });

  it("a new cleaner for this and all future asks first; Keep leaves the hand-set visit as it is", async () => {
    const s = await weeklySeries();
    await beaOnThird(s);
    const change = { assigned_to: s.vira.membershipId, update_scope: "this_and_future" };

    const asked = await save(s.owner, s.visits[1], editForm(s, 1, change));
    expect(asked.errors?._form, api.log()).toMatch(/^One later visit was changed by hand: .+ \(its own crew\)\. /);
    expect(asked.errors?._form).toContain("Nothing was saved yet.");
    expect(asked.values?.series_hand_set).toBe(`${s.visits[2]}:c`);
    expect((await rows(s)).map((r) => r.crew[0]), "nothing written").toEqual([
      s.anna.membershipId,
      s.anna.membershipId,
      s.bea.membershipId,
      s.anna.membershipId,
    ]);

    // A plain Save again is asked again.
    const again = await save(s.owner, s.visits[1], editForm(s, 1, change));
    expect(again.errors?._form).toMatch(/changed by hand/);

    const kept = await save(
      s.owner,
      s.visits[1],
      editForm(s, 1, { ...change, series_hand_set: `keep|${asked.values!.series_hand_set}` }),
    );
    expect(kept.redirected, api.log()).toContain(`kept=${s.visits[2]}`);
    const all = await rows(s);
    expect(all.map((r) => r.crew)).toEqual([
      [s.anna.membershipId],
      [s.vira.membershipId],
      [s.bea.membershipId],
      [s.vira.membershipId],
    ]);
    expect(all.map((r) => r.own)).toEqual([false, false, true, false]);
  });

  it("Change them too puts the series' cleaner on it, and it is no longer hand-set", async () => {
    const s = await weeklySeries();
    await beaOnThird(s);
    const change = { assigned_to: s.vira.membershipId, update_scope: "this_and_future" };
    const asked = await save(s.owner, s.visits[1], editForm(s, 1, change));
    const res = await save(
      s.owner,
      s.visits[1],
      editForm(s, 1, { ...change, series_hand_set: `replace|${asked.values!.series_hand_set}` }),
    );
    expect(res.redirected, api.log()).toBeTruthy();
    expect(res.redirected).not.toContain("kept=");
    const all = await rows(s);
    expect(all.slice(1).map((r) => r.crew)).toEqual([[s.vira.membershipId], [s.vira.membershipId], [s.vira.membershipId]]);
    expect(all.map((r) => r.own)).toEqual([false, false, false, false]);

    // The next series save has nothing to ask.
    const next = await save(s.owner, s.visits[1], editForm(s, 1, { assigned_to: s.anna.membershipId, update_scope: "this_and_future" }));
    expect(next.errors, api.log()).toBeUndefined();
  });

  it("the series moves to Wednesdays: a visit moved by hand is asked about, and Keep leaves it where it was put", async () => {
    const s = await weeklySeries();
    // The third visit, dragged to Friday afternoon of its week.
    const friday = `${ymd(s.base + 14 * DAY + DAY)}T14:00`;
    const moved = await save(s.owner, s.visits[2], editForm(s, 2, { scheduled_at: friday }));
    expect(moved.redirected, api.log()).toBeTruthy();
    expect((await byId(s, s.visits[2]))?.moved).toBe(true);

    const wednesday = ymd(s.base + 7 * DAY - DAY);
    const change = { scheduled_at: `${wednesday}T09:00`, update_scope: "this_and_future", ...sameSchedule(s, 1) };
    const asked = await save(s.owner, s.visits[1], editForm(s, 1, change));
    expect(asked.errors?._form, api.log()).toMatch(/^One later visit was changed by hand: Fri, .+ \(moved by hand\)\. /);
    expect(asked.values?.series_hand_set).toBe(`${s.visits[2]}:t`);
    expect((await rows(s)).map((r) => r.id), "nothing written").toEqual(s.visits);

    const kept = await save(
      s.owner,
      s.visits[1],
      editForm(s, 1, { ...change, series_hand_set: `keep|${asked.values!.series_hand_set}` }),
    );
    expect(kept.redirected, api.log()).toContain(`kept=${s.visits[2]}`);

    const all = await rows(s);
    const third = all.find((r) => r.id === s.visits[2]);
    expect(third, "the same visit, not a new one").toMatchObject({ at: friday, dow: 5, moved: true });
    // The series' own visits are on Wednesdays now, and the week she fixed
    // by hand has her Friday visit and no Wednesday one beside it.
    const others = all.filter((r) => r.id !== s.visits[0] && r.id !== s.visits[2]);
    expect(others.length).toBeGreaterThanOrEqual(2);
    expect(others.every((r) => r.dow === 3)).toBe(true);
    const thatWeek = all.filter((r) => r.at >= ymd(s.base + 14 * DAY - 2 * DAY) && r.at < ymd(s.base + 21 * DAY - 2 * DAY));
    expect(thatWeek.map((r) => r.id)).toEqual([s.visits[2]]);
  });

  it("the series moves and Change them too is pressed: the moved visit is rebuilt with the rest", async () => {
    const s = await weeklySeries();
    const friday = `${ymd(s.base + 14 * DAY + DAY)}T14:00`;
    await save(s.owner, s.visits[2], editForm(s, 2, { scheduled_at: friday }));
    const wednesday = ymd(s.base + 7 * DAY - DAY);
    const change = { scheduled_at: `${wednesday}T09:00`, update_scope: "this_and_future", ...sameSchedule(s, 1) };
    const asked = await save(s.owner, s.visits[1], editForm(s, 1, change));
    const res = await save(
      s.owner,
      s.visits[1],
      editForm(s, 1, { ...change, series_hand_set: `replace|${asked.values!.series_hand_set}` }),
    );
    expect(res.redirected, api.log()).toBeTruthy();
    const all = await rows(s);
    expect(all.some((r) => r.id === s.visits[2]), "replaced").toBe(false);
    expect(all.slice(1).every((r) => r.dow === 3)).toBe(true);
    expect(all.every((r) => !r.moved), "nothing left marked as moved by hand").toBe(true);
  });

  it("the series moves: a visit with its own cleaner moves with it and keeps her, without asking", async () => {
    const s = await weeklySeries();
    await beaOnThird(s);
    const wednesday = ymd(s.base + 7 * DAY - DAY);
    const res = await save(
      s.owner,
      s.visits[1],
      editForm(s, 1, { scheduled_at: `${wednesday}T09:00`, update_scope: "this_and_future", ...sameSchedule(s, 1) }),
    );
    expect(res.errors, api.log()).toBeUndefined();
    expect(res.redirected).toBeTruthy();

    const all = await rows(s);
    const third = all.find((r) => r.id === s.visits[2]);
    expect(third, "the same visit, on the new day").toMatchObject({
      at: `${ymd(s.base + 14 * DAY - DAY)}T09:00`,
      dow: 3,
      crew: [s.bea.membershipId],
      own: true,
    });
    const rebuilt = all.filter((r) => r.id !== s.visits[0] && r.id !== s.visits[1] && r.id !== s.visits[2]);
    expect(rebuilt.length).toBeGreaterThanOrEqual(1);
    expect(rebuilt.every((r) => r.dow === 3 && r.crew[0] === s.anna.membershipId)).toBe(true);
    // One visit a week: her visit stands in for that week's, it is not beside it.
    expect(new Set(all.map((r) => r.at.slice(0, 10))).size).toBe(all.length);
  });

  it("Change crew, this and all future: asks about a visit with its own crew, and Keep says which was left", async () => {
    const s = await weeklySeries();
    await beaOnThird(s);
    const assign = async (extra: Record<string, string> = {}) => {
      request.cookies = api.sessionCookies(s.owner.userId);
      try {
        const form = new FormData();
        form.set("id", s.visits[1]);
        form.set("primary_id", s.vira.membershipId);
        form.set("update_scope", "this_and_future");
        form.set("series_id", s.series);
        form.set("series_scheduled_at", `${ymd(s.base + 7 * DAY)}T09:00:00.000Z`);
        for (const [k, v] of Object.entries(extra)) form.set(k, v);
        return await bookings.assignBookingCrewAction({}, form);
      } finally {
        await settle();
      }
    };
    const asked = await assign();
    expect(asked.error, api.log()).toMatch(/One later visit was changed by hand/);
    expect(asked.handSet).toBe(`${s.visits[2]}:c`);
    expect((await byId(s, s.visits[1]))?.crew).toEqual([s.anna.membershipId]);

    const kept = await assign({ series_hand_set: `keep|${asked.handSet}` });
    expect(kept.ok, api.log()).toBe(true);
    expect(kept.notice).toMatch(/One visit you had changed by hand was left as it is: /);
    const all = await rows(s);
    expect(all.map((r) => r.crew[0])).toEqual([
      s.anna.membershipId,
      s.vira.membershipId,
      s.bea.membershipId,
      s.vira.membershipId,
    ]);
  });

  it("a drag onto another cleaner on the board marks that visit's crew as set by hand", async () => {
    const s = await weeklySeries();
    request.cookies = api.sessionCookies(s.owner.userId);
    try {
      const res = await scheduling.rescheduleBookingAction(
        s.visits[2],
        s.bea.membershipId,
        ymd(s.base + 14 * DAY),
        undefined,
        s.anna.membershipId,
      );
      expect(res, api.log()).toMatchObject({ ok: true });
    } finally {
      await settle();
    }
    expect(await byId(s, s.visits[2])).toMatchObject({ crew: [s.bea.membershipId], own: true });

    // Not a series visit: nothing to mark.
    const oneOff = await addBooking(api.sql, s.org, s.client, {
      scheduledAt: `${ymd(s.base + 3 * DAY)}T09:00:00.000Z`,
      durationMinutes: 60,
      status: "confirmed",
    });
    request.cookies = api.sessionCookies(s.owner.userId);
    try {
      await scheduling.rescheduleBookingAction(oneOff, s.bea.membershipId, ymd(s.base + 3 * DAY), undefined, null);
    } finally {
      await settle();
    }
    const [row] = await api.sql<{ own: boolean }>(
      "select crew_set_by_hand_at is not null as own from public.bookings where id = $1",
      [oneOff],
    );
    expect(row.own).toBe(false);
  });
});

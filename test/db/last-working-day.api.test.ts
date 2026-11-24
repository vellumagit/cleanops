/**
 * A cleaner's last working day (migration 20261124010000).
 *
 * Svitlana, 2026-11-23: a cleaner finishing December 18 stays active until
 * then, so nothing stopped the office putting her on visits in January.
 * "I would like to block her after, so I'm not adding."
 *
 * The real actions against the real stack (test/db/api.ts): setting the
 * date takes her off every later visit and marks it; a one-off save adding
 * her after it is refused in words; a "this and all future" save puts her on
 * the visits up to it and leaves her off the rest; a visit she is on before
 * the date stays editable; and the database refuses a direct write too.
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
let employees: typeof import("@/app/app/employees/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  bookings = await import("@/app/app/bookings/actions");
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
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

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
  olga: Member;
  vira: Member;
  series: string;
  visits: string[];
  base: number;
};

/** Weekly Thursday 9:00, four visits, Olga on each. */
async function weeklySeries(): Promise<Series> {
  const org = await addOrg(api.sql, "Last Day Co");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  const client = await addClient(api.sql, org, "Nella Cotesta");
  const owner = await addMember(api.sql, org, "owner", "Owner");
  const olga = await addMember(api.sql, org, "employee", "Olga");
  const vira = await addMember(api.sql, org, "employee", "Vira");
  const [service] = await api.sql<{ id: string }>(
    "insert into public.service_types (organization_id, name) values ($1, 'Standard clean') returning id",
    [org],
  );
  const base = firstThursday();
  const [series] = await api.sql<{ id: string }>(
    `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes, assigned_to, total_cents)
     values ($1, $2, 'weekly', '09:00', $3, 120, $4, 14000) returning id`,
    [org, client, ymd(base), olga.membershipId],
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
      [id, series.id, olga.membershipId, service.id],
    );
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status) values ($1, $2, $3, true, 'accepted')",
      [org, id, olga.membershipId],
    );
    visits.push(id);
  }
  return { org, client, service: service.id, owner, olga, vira, series: series.id, visits, base };
}

/** Her last day: the Monday after the second visit. Visits 0 and 1 are hers; 2 and 3 are after. */
const lastDayFor = (s: Series) => ymd(s.base + 7 * DAY + 4 * DAY);

function editForm(s: Series, visitIndex: number, change: Record<string, string>) {
  const oldAt = `${ymd(s.base + visitIndex * 7 * DAY)}T09:00`;
  const f = new FormData();
  const fields: Record<string, string> = {
    client_id: s.client,
    assigned_to: s.olga.membershipId,
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

async function setLastDay(s: Series, who: Member, day: string | null) {
  request.cookies = api.sessionCookies(s.owner.userId);
  try {
    return await employees.setLastWorkingDayAction(who.membershipId, day);
  } finally {
    await settle();
  }
}

const crewOf = (s: Series) =>
  api.sql<{ id: string; lead: string | null; crew: string[]; cover: unknown }>(
    `select b.id, b.assigned_to as lead, b.cover_needed as cover,
            coalesce((select array_agg(ba.membership_id order by ba.membership_id) from public.booking_assignees ba where ba.booking_id = b.id), '{}') as crew
       from public.bookings b where b.series_id = $1 order by b.scheduled_at`,
    [s.series],
  );

describe.skipIf(!hasPostgrest)("a cleaner's last working day", () => {
  it("is safe to run the database change twice", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261124010000_last_working_day.sql", "utf8");
    await api.db.exec(sql);
  });

  it("setting it takes her off every visit after it and marks each one; the visits before keep her", async () => {
    const s = await weeklySeries();
    const res = await setLastDay(s, s.olga, lastDayFor(s));
    expect(res).toMatchObject({ ok: true, lastDay: lastDayFor(s) });
    expect(res.ok && res.removed.map((r) => r.id)).toEqual([s.visits[2], s.visits[3]]);

    const rows = await crewOf(s);
    expect(rows.map((r) => r.crew)).toEqual([[s.olga.membershipId], [s.olga.membershipId], [], []]);
    expect(rows.map((r) => r.lead)).toEqual([s.olga.membershipId, s.olga.membershipId, null, null]);
    expect(rows[0].cover).toBeNull();
    expect(rows[2].cover).toEqual([{ membership_id: s.olga.membershipId, other_booking_id: s.visits[2] }]);
    expect(rows[3].cover).toEqual([{ membership_id: s.olga.membershipId, other_booking_id: s.visits[3] }]);

    // The "Needs cover" mark says why.
    const { loadCoverNeeded } = await import("@/lib/cover-needed");
    const { coverReason } = await import("@/lib/cover-needed-text");
    const [marked] = await loadCoverNeeded(s.org, { bookingIds: [s.visits[2]] });
    expect(coverReason(marked, "UTC")).toMatch(/^Olga \d+'s last working day is /);
  });

  it("a one-off save putting her on a visit after it is refused, with her name and the date", async () => {
    const s = await weeklySeries();
    await setLastDay(s, s.olga, lastDayFor(s));
    const res = await save(s.owner, s.visits[3], editForm(s, 3, {}));
    expect(res, api.log()).toMatch(/last working day is /);
    expect(res).not.toMatch(/overlapping booking/);
    const rows = await crewOf(s);
    expect(rows[3].crew, "nothing changed").toEqual([]);
  });

  it("a visit she is on before it stays editable", async () => {
    const s = await weeklySeries();
    await setLastDay(s, s.olga, lastDayFor(s));
    const res = await save(s.owner, s.visits[1], editForm(s, 1, { notes: "Side door" }));
    expect(res, api.log()).toMatch(/^redirected to /);
    const [row] = await api.sql<{ notes: string | null }>("select notes from public.bookings where id = $1", [s.visits[1]]);
    expect(row.notes).toBe("Side door");
  });

  it("this and all future from before it: she goes on the visits up to it and is left off the rest, each marked", async () => {
    const s = await weeklySeries();
    await setLastDay(s, s.olga, lastDayFor(s));
    // Vira on the first visit; now put Olga and Vira on the whole series.
    const form = editForm(s, 0, { update_scope: "this_and_future" });
    form.append("additional_assignees", s.vira.membershipId);
    const res = await save(s.owner, s.visits[0], form);
    expect(res, api.log()).toBe(`redirected to /app/bookings?cover=${s.series}`);

    const rows = await crewOf(s);
    const both = [s.olga.membershipId, s.vira.membershipId].sort();
    expect(rows[0].crew).toEqual(both);
    expect(rows[1].crew).toEqual(both);
    expect(rows[2].crew).toEqual([s.vira.membershipId]);
    expect(rows[3].crew).toEqual([s.vira.membershipId]);
    expect(rows[2].lead).toBe(s.vira.membershipId);
    expect(rows[2].cover).toEqual([{ membership_id: s.olga.membershipId, other_booking_id: s.visits[2] }]);
  });

  it("the database refuses a direct write too, and allows it again once the date is cleared", async () => {
    const s = await weeklySeries();
    await setLastDay(s, s.olga, lastDayFor(s));
    await expect(
      api.sql(
        "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, false)",
        [s.org, s.visits[3], s.olga.membershipId],
      ),
    ).rejects.toThrow(/last working day/);

    const cleared = await setLastDay(s, s.olga, null);
    expect(cleared).toMatchObject({ ok: true, lastDay: null, removed: [] });
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, false)",
      [s.org, s.visits[3], s.olga.membershipId],
    );
  });

  it("someone else's double-booking is still reported as one", async () => {
    const s = await weeklySeries();
    const other = await addClient(api.sql, s.org, "Bonnie");
    const busy = await addBooking(api.sql, s.org, other, {
      scheduledAt: `${ymd(s.base)}T10:00:00.000Z`,
      durationMinutes: 60,
      status: "confirmed",
    });
    await expect(
      api.sql(
        "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, false)",
        [s.org, busy, s.olga.membershipId],
      ),
    ).rejects.toThrow(/overlapping booking/);
  });
});

/**
 * The two nightly jobs that write Svit's future schedule, run through their
 * real routes (with the cron secret, and the cron ledger the morning email
 * reads) against a real database behind the real PostgREST.
 *
 *   extend-series (4:00 UTC) makes the next visits of every recurring
 *   series. On 2026-11-16 it made 4. A visit it fails to make is a client
 *   nobody cleans; a visit it makes wrong sends a crew at the wrong time, or
 *   without the person who was meant to go.
 *
 *   rederive-times (4:10 UTC) puts every future visit back at the local time
 *   it was booked for, when the zone rules change (Alberta, 2026-11-01). On
 *   2026-11-16 it looked at 876 visits and moved none, which is right.
 *
 * The company keeps time in America/Regina: UTC-6 all year, the same clock
 * as Alberta from November 2026, so 9:00 is 15:00 UTC. "A zone this
 * computer has wrong" is simulated by marking America/Winnipeg stale,
 * because whether this machine's own Edmonton rules are current depends on
 * the machine.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";

const zones = vi.hoisted(() => ({ stale: new Set<string>() }));
vi.mock("@/lib/tz-probe", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tz-probe")>();
  return {
    ...real,
    runtimeKnowsZone: (tz: string, ...rest: [((tz: string, at: Date) => number)?]) =>
      !zones.stale.has(tz) && real.runtimeKnowsZone(tz, ...rest),
  };
});

const SECRET = "series-jobs-test-cron-secret";
let api: Api;
let restoreEnv: () => void;
let previousSecret: string | undefined;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
}, 240_000);

afterAll(async () => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  zones.stale.clear();
});

type Handler = (req: Request) => Promise<Response>;
async function runCron(GET: Handler, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await GET(new Request(`https://sollos3.com${path}`, { headers: { authorization: `Bearer ${SECRET}` } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function lastRun(path: string): Promise<{ ok: boolean; error: string | null; result: unknown }> {
  const [row] = await api.sql<{ ok: boolean; error: string | null; result: unknown }>(
    "select ok, error, result from public.cron_runs where path = $1 order by started_at desc limit 1",
    [path],
  );
  return row;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** 00:00 UTC of the first Monday at least `minDays` out. */
function mondayAhead(minDays: number): number {
  const now = new Date();
  let d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + minDays * DAY;
  while (new Date(d).getUTCDay() !== 1) d += DAY;
  return d;
}
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** 9:00 in Regina on that day, as an ISO instant. */
const nineAm = (day: number) => new Date(day + 15 * HOUR).toISOString();

async function company(tz = "America/Regina"): Promise<{ org: string; client: string; anna: Member; bea: Member; gone: Member }> {
  const org = await addOrg(api.sql, "Series Co");
  await api.sql("update public.organizations set timezone = $2 where id = $1", [org, tz]);
  return {
    org,
    client: await addClient(api.sql, org, "Hilda Daubner"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    bea: await addMember(api.sql, org, "employee", "Bea"),
    gone: await addMember(api.sql, org, "employee", "Gone", "disabled"),
  };
}

/** A weekly 9:00 series whose latest visit is `latestDay`, with that visit already booked. */
async function weeklySeries(
  c: { org: string; client: string },
  opts: {
    latestDay: number;
    crew: Array<{ m: Member; accepted?: boolean }>;
    tz?: string;
    skip?: string[];
    propertyId?: string | null;
    active?: boolean;
  },
): Promise<string> {
  const crewJson = opts.crew.map(({ m }) => ({ membership_id: m.membershipId, start_offset_minutes: null, duration_minutes: null }));
  const [s] = await api.sql<{ id: string }>(
    `insert into public.booking_series
       (organization_id, client_id, pattern, start_time, starts_at, generate_ahead, duration_minutes,
        service_type, service_type_label, total_cents, address, notes, property_id, crew, assigned_to, active, skip_dates)
     values ($1, $2, 'weekly', '09:00', $3, 4, 180, 'standard', 'Deep clean', 15000, '12 Elm Street', 'Bring the ladder',
             $4, $5::jsonb, $6, $7, $8)
     returning id`,
    [
      c.org,
      c.client,
      ymd(opts.latestDay - 7 * DAY),
      opts.propertyId ?? null,
      JSON.stringify(crewJson),
      opts.crew[0]?.m.membershipId ?? null,
      opts.active ?? true,
      opts.skip ?? [],
    ],
  );
  const tz = opts.tz ?? "America/Regina";
  const [b] = await api.sql<{ id: string }>(
    `insert into public.bookings
       (organization_id, client_id, series_id, scheduled_at, scheduled_local, scheduled_tz, duration_minutes,
        service_type, status, total_cents, assigned_to)
     values ($1, $2, $3, $4::timestamptz, $5, $6, 180, 'standard', 'confirmed', 15000, $7) returning id`,
    [c.org, c.client, s.id, nineAm(opts.latestDay), `${ymd(opts.latestDay)}T09:00`, tz, opts.crew[0]?.m.membershipId ?? null],
  );
  for (const { m, accepted } of opts.crew) {
    await api.sql(
      `insert into public.booking_assignees (organization_id, booking_id, membership_id, acceptance_status)
       values ($1, $2, $3, $4)`,
      [c.org, b.id, m.membershipId, accepted ? "accepted" : "pending"],
    );
  }
  return s.id;
}

/** Only this company's series run: the database is shared across the tests in this file. */
async function onlySeriesOf(...orgs: string[]): Promise<void> {
  await api.sql("update public.booking_series set active = false where not (organization_id = any($1::uuid[]))", [orgs]);
}

type Visit = {
  id: string;
  scheduled_at: string;
  scheduled_local: string | null;
  scheduled_tz: string | null;
  duration_minutes: number;
  total_cents: number;
  service_type_label: string | null;
  address: string | null;
  property_id: string | null;
  notes: string | null;
  status: string;
};
const visitsOf = (seriesId: string) =>
  api.sql<Visit>(
    `select id, scheduled_at::text, scheduled_local, scheduled_tz, duration_minutes, total_cents, service_type_label,
            address, property_id, notes, status::text
       from public.bookings where series_id = $1 order by scheduled_at`,
    [seriesId],
  );
const crewOf = (bookingId: string) =>
  api.sql<{ membership_id: string; acceptance_status: string }>(
    "select membership_id, acceptance_status::text from public.booking_assignees where booking_id = $1",
    [bookingId],
  );
const iso = (pgText: string) => new Date(pgText).toISOString();

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("extend-series: the next visits of every recurring series", { timeout: 120_000 }, () => {
  it("makes the next four weekly visits at 9:00 local, as the series says, with the crew still on the team", async () => {
    const { GET } = await import("@/app/api/cron/extend-series/route");
    const c = await company();
    const [prop] = await api.sql<{ id: string }>(
      "insert into public.client_properties (organization_id, client_id, label, address) values ($1, $2, 'Home', '12 Elm Street') returning id",
      [c.org, c.client],
    );
    const latest = mondayAhead(7);
    // Anna has confirmed this series; Bea has not answered yet; Gone was
    // deactivated after the series was saved.
    const series = await weeklySeries(c, {
      latestDay: latest,
      crew: [{ m: c.anna, accepted: true }, { m: c.bea }, { m: c.gone }],
      propertyId: prop.id,
    });
    await onlySeriesOf(c.org);

    const run = await runCron(GET, "/api/cron/extend-series");
    expect(run, api.log()).toEqual({ status: 200, body: { generated: 4 } });

    const visits = await visitsOf(series);
    const fresh = visits.slice(1);
    expect(fresh.map((v) => iso(v.scheduled_at))).toEqual([1, 2, 3, 4].map((w) => nineAm(latest + w * 7 * DAY)));
    for (const v of fresh) {
      expect(v).toMatchObject({
        scheduled_tz: "America/Regina",
        duration_minutes: 180,
        total_cents: 15000,
        service_type_label: "Deep clean",
        address: "12 Elm Street",
        property_id: prop.id,
        notes: "[Recurring] Bring the ladder",
        status: "confirmed",
      });
      expect(v.scheduled_local).toBe(`${ymd(new Date(v.scheduled_at).getTime() - 15 * HOUR)}T09:00`);
      // Anna is not asked again; Bea still is; Gone is not put back on.
      const crew = await crewOf(v.id);
      expect(crew.map((r) => [r.membership_id, r.acceptance_status]).sort()).toEqual(
        [
          [c.anna.membershipId, "accepted"],
          [c.bea.membershipId, "pending"],
        ].sort(),
      );
    }

    expect(await lastRun("/api/cron/extend-series")).toMatchObject({ ok: true, error: null, result: { generated: 4 } });

    // Tomorrow night: the latest visit is now a month out, so nothing more,
    // and nothing doubled.
    expect(await runCron(GET, "/api/cron/extend-series")).toEqual({ status: 200, body: { generated: 0 } });
    expect(await visitsOf(series)).toHaveLength(5);
  });

  it("leaves alone a series that is far enough ahead, one that was stopped, and the dates it was told to skip", async () => {
    const { GET } = await import("@/app/api/cron/extend-series/route");
    const c = await company();
    const farAhead = await weeklySeries(c, { latestDay: mondayAhead(40), crew: [{ m: c.anna }] });
    const stopped = await weeklySeries(c, { latestDay: mondayAhead(7), crew: [{ m: c.anna }], active: false });
    const latest = mondayAhead(14);
    const skipDay = latest + 14 * DAY;
    const skipping = await weeklySeries(c, { latestDay: latest, crew: [{ m: c.bea }], skip: [ymd(skipDay)] });
    await onlySeriesOf(c.org);

    const run = await runCron(GET, "/api/cron/extend-series");
    expect(run, api.log()).toEqual({ status: 200, body: { generated: 4 } });
    expect(await visitsOf(farAhead)).toHaveLength(1);
    expect(await visitsOf(stopped)).toHaveLength(1);
    // Four visits, stepping over the skipped Monday rather than losing one.
    const fresh = (await visitsOf(skipping)).slice(1).map((v) => iso(v.scheduled_at));
    expect(fresh).toEqual([1, 3, 4, 5].map((w) => nineAm(latest + w * 7 * DAY)));
  });

  it("a date where the cleaner is already booked gets its visit with no cleaner, named in the morning email; every other visit is made with her", async () => {
    const { GET } = await import("@/app/api/cron/extend-series/route");
    const c = await company();
    const latest = mondayAhead(7);
    const clashing = await weeklySeries(c, { latestDay: latest, crew: [{ m: c.anna }] });
    // Anna already has another client 9:00 to noon on the second new Monday.
    const clashDay = latest + 14 * DAY;
    const other = await addClient(api.sql, c.org, "Ken Hicks");
    const [busy] = await api.sql<{ id: string }>(
      `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, assigned_to)
       values ($1, $2, $3::timestamptz, 180, 'standard', 'confirmed', $4) returning id`,
      [c.org, other, nineAm(clashDay), c.anna.membershipId],
    );
    await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id) values ($1, $2, $3)", [
      c.org,
      busy.id,
      c.anna.membershipId,
    ]);
    // A second company's series runs the same night and must not be held up.
    const d = await company();
    const untouched = await weeklySeries(d, { latestDay: latest, crew: [{ m: d.anna }] });
    await onlySeriesOf(c.org, d.org);

    const run = await runCron(GET, "/api/cron/extend-series");
    expect(run.status, JSON.stringify(run.body)).toBe(500);
    expect(String(run.body.error)).toContain("already has an overlapping booking");
    expect(String(run.body.error)).toContain(nineAm(clashDay));

    expect(String(run.body.error)).toContain("WITHOUT a cleaner");

    // Anna is never put in two places, and the client is not dropped: the
    // clashing Monday has its visit, with nobody on it.
    const visits = await visitsOf(clashing);
    const onClashDay = visits.find((v) => iso(v.scheduled_at) === nineAm(clashDay));
    expect(onClashDay, "the visit exists").toBeTruthy();
    expect(await crewOf(onClashDay!.id)).toEqual([]);
    expect(
      (await api.sql<{ a: string | null }>("select assigned_to as a from public.bookings where id = $1", [onClashDay!.id]))[0].a,
    ).toBeNull();
    // The other three Mondays are made, with Anna on them.
    const others = visits.slice(1).filter((v) => iso(v.scheduled_at) !== nineAm(clashDay));
    expect(others).toHaveLength(3);
    for (const v of others) expect((await crewOf(v.id)).map((r) => r.membership_id)).toEqual([c.anna.membershipId]);
    expect(await visitsOf(untouched)).toHaveLength(5);

    const ledger = await lastRun("/api/cron/extend-series");
    expect(ledger.ok).toBe(false);
    expect(ledger.error).toContain("overlapping booking");

    // The next night it is not made a second time.
    const again = await runCron(GET, "/api/cron/extend-series");
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(await visitsOf(clashing)).toHaveLength(visits.length);
  });

  it("someone with a last working day is on the new visits up to it and left off the rest, which are marked; the run is clean", async () => {
    // Migration 20261124010000. Anna stays on every visit; Bea finishes the
    // day after the second new Monday.
    const { GET } = await import("@/app/api/cron/extend-series/route");
    const c = await company();
    const latest = mondayAhead(7);
    const series = await weeklySeries(c, { latestDay: latest, crew: [{ m: c.anna }, { m: c.bea }] });
    const lastDay = ymd(latest + 14 * DAY + DAY);
    await api.sql("update public.memberships set last_working_day = $2 where id = $1", [c.bea.membershipId, lastDay]);
    await onlySeriesOf(c.org);

    const run = await runCron(GET, "/api/cron/extend-series");
    expect(run, api.log()).toEqual({ status: 200, body: { generated: 4 } });

    const fresh = (await visitsOf(series)).slice(1);
    expect(fresh).toHaveLength(4);
    for (const [i, v] of fresh.entries()) {
      const crew = (await crewOf(v.id)).map((r) => r.membership_id).sort();
      const [row] = await api.sql<{ cover: unknown }>("select cover_needed as cover from public.bookings where id = $1", [v.id]);
      if (i < 2) {
        expect(crew, `week ${i + 1}`).toEqual([c.anna.membershipId, c.bea.membershipId].sort());
        expect(row.cover).toBeNull();
      } else {
        expect(crew, `week ${i + 1}`).toEqual([c.anna.membershipId]);
        expect(row.cover).toEqual([{ membership_id: c.bea.membershipId, other_booking_id: v.id }]);
      }
    }
  });

  it("a company whose zone this computer has wrong gets no visits tonight, and the morning email says so", async () => {
    const { GET } = await import("@/app/api/cron/extend-series/route");
    const ok = await company();
    const stale = await company("America/Winnipeg");
    zones.stale.add("America/Winnipeg");
    const latest = mondayAhead(7);
    const fine = await weeklySeries(ok, { latestDay: latest, crew: [{ m: ok.anna }] });
    const held = await weeklySeries(stale, { latestDay: latest, crew: [{ m: stale.anna }], tz: "America/Winnipeg" });
    await onlySeriesOf(ok.org, stale.org);

    const run = await runCron(GET, "/api/cron/extend-series");
    // Better no visits than visits an hour off, but not in silence: a series
    // held back every night runs dry a month later with nobody told.
    expect(run.status, JSON.stringify(run.body)).toBe(500);
    expect(String(run.body.error)).toContain("America/Winnipeg");
    expect(await visitsOf(held)).toHaveLength(1);
    expect(await visitsOf(fine)).toHaveLength(5);
    expect((await lastRun("/api/cron/extend-series")).error).toContain("America/Winnipeg");
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("rederive-times: future visits back at the local time they were booked for", { timeout: 120_000 }, () => {
  /** A visit booked for 9:00 local on `day`, stored at `storedAt`. */
  async function visit(
    c: { org: string; client: string },
    day: number,
    storedAt: string,
    opts: { tz?: string; status?: string; crew?: Member; minutes?: number; local?: string } = {},
  ): Promise<string> {
    const [b] = await api.sql<{ id: string }>(
      `insert into public.bookings
         (organization_id, client_id, scheduled_at, scheduled_local, scheduled_tz, duration_minutes, service_type, status, assigned_to)
       values ($1, $2, $3::timestamptz, $4, $5, $6, 'standard', $7::public.booking_status, $8) returning id`,
      [
        c.org,
        c.client,
        storedAt,
        `${ymd(day)}T${opts.local ?? "09:00"}`,
        opts.tz ?? "America/Regina",
        opts.minutes ?? 120,
        opts.status ?? "confirmed",
        opts.crew?.membershipId ?? null,
      ],
    );
    if (opts.crew) {
      await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id) values ($1, $2, $3)", [
        c.org,
        b.id,
        opts.crew.membershipId,
      ]);
    }
    return b.id;
  }
  const at = async (id: string) =>
    iso((await api.sql<{ t: string }>("select scheduled_at::text as t from public.bookings where id = $1", [id]))[0].t);

  it("moves a visit stored an hour off back to 9:00, leaves the right ones, the past and the cancelled alone, and a dry run writes nothing", async () => {
    const { GET } = await import("@/app/api/cron/rederive-times/route");
    const c = await company();
    const day = mondayAhead(10);
    const nine = nineAm(day);
    const tenUtcOff = new Date(new Date(nine).getTime() + HOUR).toISOString();
    const off = await visit(c, day, tenUtcOff);
    const right = await visit(c, day + DAY, nineAm(day + DAY));
    // Two days ago, whatever day of the week the suite runs on.
    const today = new Date();
    const yesterday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - 2 * DAY;
    const past = await visit(c, yesterday, new Date(new Date(nineAm(yesterday)).getTime() + HOUR).toISOString());
    const finished = await visit(c, day + 2 * DAY, new Date(new Date(nineAm(day + 2 * DAY)).getTime() + HOUR).toISOString(), {
      status: "cancelled",
    });

    const dry = await runCron(GET, "/api/cron/rederive-times?dry=1");
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, changed: 1 });
    expect(await at(off)).toBe(tenUtcOff);

    const run = await runCron(GET, "/api/cron/rederive-times");
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ dryRun: false, changed: 1, refusedZones: [], dbDisagreed: 0 });
    expect(await at(off)).toBe(nine);
    expect(await at(right)).toBe(nineAm(day + DAY));
    expect(await at(past)).not.toBe(nineAm(yesterday));
    expect(await at(finished)).not.toBe(nineAm(day + 2 * DAY));

    // The move is on the audit log, and the wall clock still reads 9:00.
    const [row] = await api.sql<{ scheduled_local: string; audited: number }>(
      `select b.scheduled_local,
              (select count(*)::int from public.audit_log a where a.entity_id = b.id and a.after->>'via' = 'wall_clock_rederive') as audited
         from public.bookings b where b.id = $1`,
      [off],
    );
    expect(row).toEqual({ scheduled_local: `${ymd(day)}T09:00`, audited: 1 });

    // Quiet the next night.
    expect((await runCron(GET, "/api/cron/rederive-times")).body).toMatchObject({ changed: 0 });
  });

  it("a visit it cannot move, and a zone this computer has wrong, are left alone and named in the morning email; the rest still move", async () => {
    const { GET } = await import("@/app/api/cron/rederive-times/route");
    const c = await company();
    const w = await company("America/Winnipeg");
    zones.stale.add("America/Winnipeg");
    const day = mondayAhead(10);
    const nine = nineAm(day);
    const hourLate = (iso9: string) => new Date(new Date(iso9).getTime() + HOUR).toISOString();

    // Anna's 9:00 is stored at 10:00. Back at 9:00 it would run into her
    // 7:00 to 9:30 job, so the database refuses the move.
    const blocked = await visit(c, day, hourLate(nine), { crew: c.anna });
    await visit(c, day, new Date(new Date(nine).getTime() - 2 * HOUR).toISOString(), { crew: c.anna, minutes: 150, local: "07:00" });
    const movable = await visit(c, day + DAY, hourLate(nineAm(day + DAY)), { crew: c.bea });
    const heldBack = await visit(w, day, hourLate(nineAm(day)), { tz: "America/Winnipeg" });

    const run = await runCron(GET, "/api/cron/rederive-times");
    expect(await at(movable)).toBe(nineAm(day + DAY));
    expect(await at(blocked)).toBe(hourLate(nine));
    expect(await at(heldBack)).toBe(hourLate(nineAm(day)));
    // Left an hour off is fine for one night only if someone is told.
    expect(run.status, JSON.stringify(run.body)).toBe(500);
    expect(String(run.body.error)).toContain("America/Winnipeg");
    expect(String(run.body.error)).toContain(blocked);
    const ledger = await lastRun("/api/cron/rederive-times");
    expect(ledger.ok).toBe(false);
    expect(ledger.error).toContain(blocked);
  });

  it("looks past the first thousand future visits", async () => {
    const { GET } = await import("@/app/api/cron/rederive-times/route");
    const c = await company();
    // The earlier tests' visit that cannot move would fail this run too.
    await api.sql("update public.bookings set status = 'cancelled' where organization_id <> $1 and scheduled_at > now()", [c.org]);
    const base = mondayAhead(10);
    // 1,050 right visits first in time, then one an hour off at the end.
    await api.sql(
      `insert into public.bookings (organization_id, client_id, scheduled_at, scheduled_local, scheduled_tz, duration_minutes, service_type, status)
       select $1, $2, $3::timestamptz + make_interval(mins => g * 10), null, 'America/Regina', 5, 'standard', 'confirmed'
         from generate_series(1, 1050) g`,
      [c.org, c.client, nineAm(base - 9 * DAY)],
    );
    const lastDay = base + 60 * DAY;
    const off = await visit(c, lastDay, new Date(new Date(nineAm(lastDay)).getTime() + HOUR).toISOString());

    const run = await runCron(GET, "/api/cron/rederive-times");
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(Number(run.body.considered)).toBeGreaterThan(1050);
    expect(await at(off)).toBe(nineAm(lastDay));
  });
});

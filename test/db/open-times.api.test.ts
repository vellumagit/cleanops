/**
 * Open times from a company's real schedule (roadmap phase 2, 2026-11-22).
 *
 * The settings a company saves (hours, notice, gap, who takes online
 * bookings) and the times those produce, on a real database: against the
 * cleaners' own hours, their time off, and the jobs they are already on.
 * Nothing here is public yet; this is what the office's preview shows.
 *
 * The clock is pinned: "now" is Monday 2027-03-01, 9:00 in Regina (UTC-6
 * all year), and the days looked at are that week.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addCrew, addMember, addOrg, type Member } from "./harness";
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
let settings: typeof import("@/app/app/settings/online-booking/actions");
let times: typeof import("@/lib/open-times-load");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  settings = await import("@/app/app/settings/online-booking/actions");
  times = await import("@/lib/open-times-load");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const one of v) f.append(k, one);
    else f.set(k, v);
  }
  return f;
};
async function as<T>(who: Member | null, press: () => Promise<T>): Promise<T> {
  request.cookies = who ? api.sessionCookies(who.userId) : [];
  try {
    return await press();
  } finally {
    await settle();
  }
}

const NOW = Date.parse("2027-03-01T15:00:00Z"); // Monday 9:00 in Regina
const WED = "2027-03-03";
/** A Regina wall-clock time that week, as an instant. */
const regina = (ymd: string, hhmm: string) => `${ymd}T${String(Number(hhmm.slice(0, 2)) + 6).padStart(2, "0")}:${hhmm.slice(3)}:00Z`;

let seq = 0;
type Co = { org: string; owner: Member; manager: Member; anna: Member; bea: Member; client: string; standard: string; noLength: string };
async function company(opts: { sharesHours?: boolean } = {}): Promise<Co> {
  const org = await addOrg(api.sql, "Open Times");
  await api.sql("update public.organizations set timezone = 'America/Regina', automations_enabled = true, automation_settings = $2::jsonb where id = $1", [
    org,
    JSON.stringify({ divide_crew_hours: { enabled: opts.sharesHours === true } }),
  ]);
  const person = async (role: "owner" | "manager" | "employee", name: string) => {
    const m = await addMember(api.sql, org, role, name);
    await api.sql("update public.memberships set display_name = $2 where id = $1", [m.membershipId, name]);
    return m;
  };
  const svc = async (name: string, minutes: number | null) =>
    (
      await api.sql<{ id: string }>(
        "insert into public.service_types (organization_id, name, default_duration_minutes) values ($1, $2, $3) returning id",
        [org, name, minutes],
      )
    )[0].id;
  return {
    org,
    owner: await person("owner", "Olivia"),
    manager: await person("manager", "Mara"),
    anna: await person("employee", "Anna"),
    bea: await person("employee", "Bea"),
    client: await addClient(api.sql, org, "Jordan"),
    standard: await svc("Standard clean", 120),
    noLength: await svc("Windows", null),
  };
}
const makePage = (c: Co) => as(c.owner, () => settings.createBookingPageAction({}, form({ name: `open-${Date.now().toString(36)}-${++seq}` })));
const everyone = (c: Co) => [c.owner, c.manager, c.anna, c.bea];
/** Weekdays 9 to 5, a start every hour, with these people ticked. */
const rulesForm = (c: Co, takes: Member[], over: Record<string, string> = {}) => {
  const fields: Record<string, string | string[]> = {
    min_notice_hours: "24",
    max_days_ahead: "60",
    gap_minutes: "30",
    slot_step_minutes: "60",
    takes: takes.map((m) => m.membershipId),
  };
  for (const d of [1, 2, 3, 4, 5]) Object.assign(fields, { [`open_${d}`]: "on", [`start_${d}`]: "09:00", [`end_${d}`]: "17:00" });
  for (const m of everyone(c)) fields[`cleaner_listed_${m.membershipId}`] = "1";
  return form({ ...fields, ...over });
};
const save = (c: Co, takes: Member[], over: Record<string, string> = {}, who: Member = c.owner) =>
  as(who, () => settings.saveOpenTimeRulesAction({}, rulesForm(c, takes, over)));
const takers = async (c: Co) =>
  (await api.sql<{ id: string }>("select id from public.memberships where organization_id = $1 and takes_online_bookings order by id", [c.org])).map((r) => r.id);
/** The open start times on one day, "09:00", or the reason there are none. */
async function day(c: Co, ymd: string, serviceId = c.standard) {
  const loaded = await times.loadOpenTimes({ organizationId: c.org, serviceId, fromYmd: ymd, days: 1, now: NOW });
  if (!loaded.ok) throw new Error(loaded.error);
  const d = loaded.days[0];
  return d.times.length > 0 ? d.times.map((t) => t.hhmm) : d.reason;
}
async function jobFor(c: Co, crew: Member[], ymd: string, hhmm: string, minutes = 120) {
  const id = await addBooking(api.sql, c.org, c.client, { scheduledAt: regina(ymd, hhmm), durationMinutes: minutes });
  for (const who of crew) await addCrew(api.sql, c.org, id, who.membershipId);
  return id;
}
const HOURLY = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"]; // a 2h job, 9 to 5

describe.skipIf(!hasPostgrest)("saving the rules", { timeout: 120_000 }, () => {
  it("owners and admins only, and only once the page exists", async () => {
    const c = await company();
    expect(await save(c, [c.anna]), "no page yet").toEqual({ error: "Make your page first." });
    await makePage(c);
    for (const who of [c.manager, c.anna]) {
      expect(await save(c, [c.anna], {}, who)).toEqual({ error: "Only owners and admins can set up the booking page." });
    }
    expect(await takers(c), "nobody is ticked to start with").toEqual([]);

    const saved = await save(c, [c.anna], { min_notice_hours: "12", gap_minutes: "45" });
    expect(saved.error, api.log()).toBeUndefined();
    const [row] = await api.sql<{ hours: Record<string, unknown>; notice: number; ahead: number; gap: number; step: number }>(
      "select opening_hours as hours, min_notice_hours as notice, max_days_ahead as ahead, gap_minutes as gap, slot_step_minutes as step from public.booking_pages where organization_id = $1",
      [c.org],
    );
    expect(row).toMatchObject({ notice: 12, ahead: 60, gap: 45, step: 60 });
    expect(Object.keys(row.hours).sort()).toEqual(["1", "2", "3", "4", "5"]);
    expect(row.hours["3"]).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(await takers(c)).toEqual([c.anna.membershipId]);

    // Unticking takes them off again.
    await save(c, [c.bea]);
    expect(await takers(c)).toEqual([c.bea.membershipId]);
  });

  it("a wrong value is refused in words and nothing changes", async () => {
    const c = await company();
    await makePage(c);
    await save(c, [c.anna]);
    expect(await save(c, [c.bea], { end_2: "08:00" })).toEqual({ error: "Tuesday: closing has to be after opening." });
    expect(await save(c, [c.bea], { slot_step_minutes: "20" })).toEqual({ error: "Choose how far apart the start times are." });
    expect(await takers(c)).toEqual([c.anna.membershipId]);
  });

  it("another company's people can't be ticked, and theirs are untouched by a save here", async () => {
    const c = await company();
    const other = await company();
    await makePage(c);
    await makePage(other);
    await save(other, [other.anna]);

    await as(c.owner, () =>
      settings.saveOpenTimeRulesAction(
        {},
        rulesForm(c, [c.anna, other.bea], { [`cleaner_listed_${other.bea.membershipId}`]: "1", [`cleaner_listed_${other.anna.membershipId}`]: "1" }),
      ),
    );
    expect(await takers(c)).toEqual([c.anna.membershipId]);
    expect(await takers(other), "still exactly what they set").toEqual([other.anna.membershipId]);
  });

  it("the page's save keeps how many cleaners each service needs, within 1 to 6", async () => {
    const c = await company();
    await makePage(c);
    const [{ slug }] = await api.sql<{ slug: string }>("select slug::text as slug from public.booking_pages where organization_id = $1", [c.org]);
    const size = async () =>
      (await api.sql<{ n: number }>("select online_crew_size as n from public.service_types where id = $1", [c.standard]))[0].n;
    expect(await size()).toBe(1);
    const press = (crew: string) =>
      as(c.owner, () => settings.saveBookingPageAction({}, form({ name: slug, [`listed_${c.standard}`]: "1", [`price_${c.standard}`]: "hidden", [`crew_${c.standard}`]: crew })));
    expect((await press("2")).ok, api.log()).toBe("Saved.");
    expect(await size()).toBe(2);
    await press("40");
    expect(await size(), "a number off the list falls back to one").toBe(1);
  });
});

describe.skipIf(!hasPostgrest)("the times a visitor would be offered", { timeout: 120_000 }, () => {
  it("nothing until hours are saved and someone is ticked; then every start that fits inside the hours", async () => {
    const c = await company();
    expect(await times.loadOpenTimes({ organizationId: c.org, serviceId: c.standard, days: 1, now: NOW })).toEqual({ ok: false, error: "Make your booking page first." });
    await makePage(c);
    expect(await day(c, WED), "no hours saved").toBe("closed");
    await save(c, []);
    expect(await day(c, WED), "nobody ticked").toBe("no_cleaners");

    await save(c, [c.anna]);
    expect(await day(c, WED)).toEqual(HOURLY);
    expect(await day(c, "2027-03-06"), "Saturday").toBe("closed");
    expect(await day(c, WED, c.noLength)).toBe("no_length");
    // Monday at 9: all of today is inside the 24 hours' notice.
    expect(await day(c, "2027-03-01")).toBe("too_soon");
    // Tuesday: only starts from 9:00 tomorrow on, which is all of them.
    expect(await day(c, "2027-03-02")).toEqual(HOURLY);
    expect(await day(c, "2027-02-26"), "last Friday").toBe("past");
    expect(await day(c, "2027-06-01"), "further than 60 days").toBe("too_far");
  });

  it("a job the cleaner is already on takes its times away, with the gap either side", async () => {
    const c = await company();
    await makePage(c);
    await save(c, [c.anna]);
    await jobFor(c, [c.anna], WED, "11:00"); // 11:00 to 13:00
    // With 30 minutes clear: nothing may end after 10:30 or start before 13:30.
    expect(await day(c, WED)).toEqual(["14:00", "15:00"]);
    // No gap asked for: a job may sit right up against it.
    await save(c, [c.anna], { gap_minutes: "0" });
    expect(await day(c, WED)).toEqual(["09:00", "13:00", "14:00", "15:00"]);

    // A cancelled job holds nothing; neither does someone else's.
    const other = await company();
    await jobFor(other, [other.anna], "2027-03-04", "09:00", 480);
    const gone = await jobFor(c, [c.anna], "2027-03-04", "09:00", 480);
    expect(await day(c, "2027-03-04")).toBe("full");
    await api.sql("update public.bookings set status = 'cancelled' where id = $1", [gone]);
    expect(await day(c, "2027-03-04")).toEqual(["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"]);
  });

  it("a second cleaner fills in: a time is open when anyone ticked is free, and says who", async () => {
    const c = await company();
    await makePage(c);
    await save(c, [c.anna, c.bea], { gap_minutes: "0" });
    await jobFor(c, [c.anna], WED, "09:00", 240); // Anna 9 to 1
    await jobFor(c, [c.bea], WED, "13:00", 240); // Bea 1 to 5
    const loaded = await times.loadOpenTimes({ organizationId: c.org, serviceId: c.standard, fromYmd: WED, days: 1, now: NOW });
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.cleaners.map((p) => p.name)).toEqual(["Anna", "Bea"]);
    const who = Object.fromEntries(loaded.days[0].times.map((t) => [t.hhmm, t.cleaners]));
    expect(who).toEqual({
      "09:00": [c.bea.membershipId],
      "10:00": [c.bea.membershipId],
      "11:00": [c.bea.membershipId],
      "13:00": [c.anna.membershipId],
      "14:00": [c.anna.membershipId],
      "15:00": [c.anna.membershipId],
    });
  });

  it("time off and the hours a cleaner gave are respected", async () => {
    const c = await company();
    await makePage(c);
    await save(c, [c.anna]);
    // Approved time off on Thursday; a request not yet approved on Friday.
    await api.sql("insert into public.pto_requests (organization_id, employee_id, start_date, end_date, status) values ($1, $2, '2027-03-04', '2027-03-04', 'approved')", [c.org, c.anna.membershipId]);
    await api.sql("insert into public.pto_requests (organization_id, employee_id, start_date, end_date, status) values ($1, $2, '2027-03-05', '2027-03-05', 'pending')", [c.org, c.anna.membershipId]);
    expect(await day(c, "2027-03-04")).toBe("full");
    expect(await day(c, "2027-03-05")).toEqual(HOURLY);

    // Anna works Wednesdays from noon, and not Tuesdays at all.
    await api.sql("insert into public.availability_slots (organization_id, membership_id, day_of_week, start_time, end_time) values ($1, $2, 3, '12:00', '17:00')", [c.org, c.anna.membershipId]);
    expect(await day(c, WED)).toEqual(["12:00", "13:00", "14:00", "15:00"]);
    expect(await day(c, "2027-03-02"), "no hours given for Tuesday").toBe("full");
    // A one-off change for one date replaces the weekly hours.
    await api.sql("insert into public.availability_overrides (organization_id, membership_id, date, kind, start_time, end_time) values ($1, $2, '2027-03-02', 'custom', '09:00', '12:00')", [c.org, c.anna.membershipId]);
    expect(await day(c, "2027-03-02")).toEqual(["09:00", "10:00"]);
    await api.sql("insert into public.availability_overrides (organization_id, membership_id, date, kind) values ($1, $2, '2027-03-03', 'off')", [c.org, c.anna.membershipId]);
    expect(await day(c, WED)).toBe("full");
  });

  it("a job for two needs two free at once, and shared hours halve how long each is there", async () => {
    const c = await company({ sharesHours: true });
    await makePage(c);
    await api.sql("update public.service_types set online_crew_size = 2 where id = $1", [c.standard]);
    await save(c, [c.anna], { gap_minutes: "0" });
    expect(await day(c, WED), "one cleaner can't make a crew of two").toBe("full");

    await save(c, [c.anna, c.bea], { gap_minutes: "0" });
    // Two hours shared by two is an hour on site, so 16:00 fits before 5.
    expect(await day(c, WED)).toEqual([...HOURLY, "16:00"]);
    // Bea alone on a two-hour job from 10: hers alone, so 10 to 12.
    await jobFor(c, [c.bea], WED, "10:00");
    expect(await day(c, WED)).toEqual(["09:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
    // Anna and Bea together on a two-hour job from 14: an hour each, 14 to 15.
    await jobFor(c, [c.anna, c.bea], WED, "14:00");
    expect(await day(c, WED)).toEqual(["09:00", "12:00", "13:00", "15:00", "16:00"]);
  });

  it("a statutory holiday is closed, when the company has a holiday region", async () => {
    const c = await company();
    await makePage(c);
    await save(c, [c.anna]);
    const good = "2027-03-26"; // Good Friday 2027
    expect(await day(c, good), "no region set: an ordinary Friday").toEqual(HOURLY);
    await api.sql("update public.organizations set holiday_region = 'CA-AB' where id = $1", [c.org]);
    const loaded = await times.loadOpenTimes({ organizationId: c.org, serviceId: c.standard, fromYmd: "2027-03-25", days: 2, now: NOW });
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.days.map((d) => [d.ymd, d.reason ?? d.times.length, d.holiday ?? null])).toEqual([
      ["2027-03-25", 7, null],
      [good, "closed", "Good Friday"],
    ]);
  });

  it("a run of days comes back in order, one entry a day", async () => {
    const c = await company();
    await makePage(c);
    await save(c, [c.anna]);
    const loaded = await times.loadOpenTimes({ organizationId: c.org, serviceId: c.standard, fromYmd: "2027-03-01", days: 7, now: NOW });
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.tz).toBe("America/Regina");
    expect(loaded.days.map((d) => [d.ymd, d.reason ?? d.times.length])).toEqual([
      ["2027-03-01", "too_soon"],
      ["2027-03-02", 7],
      ["2027-03-03", 7],
      ["2027-03-04", 7],
      ["2027-03-05", 7],
      ["2027-03-06", "closed"],
      ["2027-03-07", "closed"],
    ]);
    // Another company's service is not this company's to look up.
    const other = await company();
    expect(await times.loadOpenTimes({ organizationId: c.org, serviceId: other.standard, days: 1, now: NOW })).toEqual({ ok: false, error: "That service wasn't found." });
  });
});

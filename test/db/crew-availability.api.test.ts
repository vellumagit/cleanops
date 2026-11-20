/**
 * The booking form's "who is free" check.
 *
 * The crew picker listed every active person whatever the day (in-person
 * notes, 2026-11-19: "show only available cleaners when creating a new
 * booking"). This is the question it now asks, pressed as the office and as
 * a cleaner, on a real database, against the same overlap rule that refuses
 * a double-booked save.
 */
import { randomBytes } from "node:crypto";
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
let check: typeof import("@/app/app/bookings/crew-availability");

beforeAll(async () => {
  process.env.INTEGRATION_ENCRYPTION_KEY ??= `base64:${randomBytes(32).toString("base64")}`;
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  check = await import("@/app/app/bookings/crew-availability");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

async function as<T>(who: Member, press: () => Promise<T>): Promise<T> {
  request.cookies = api.sessionCookies(who.userId);
  try {
    return await press();
  } finally {
    await settle();
  }
}

// A Saturday well in the future, in a company on UTC so the wall clock and
// the stored instant read the same.
const DAY = "2027-03-13";
const at = (hhmm: string) => `${DAY}T${hhmm}`;
const instant = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;

type Co = { org: string; owner: Member; manager: Member; anna: Member; bea: Member; cara: Member; dan: Member; client: string };
async function company(): Promise<Co> {
  const org = await addOrg(api.sql, "Free Co");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Owner"),
    manager: await addMember(api.sql, org, "manager", "Manager"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    bea: await addMember(api.sql, org, "employee", "Bea"),
    cara: await addMember(api.sql, org, "employee", "Cara"),
    dan: await addMember(api.sql, org, "employee", "Dan"),
    client: await addClient(api.sql, org, "Smith"),
  };
}

const ask = (who: Member, hhmm: string, minutes: number, excludeBookingId?: string) =>
  as(who, () => check.getCrewAvailabilityAction({ scheduledAtLocal: at(hhmm), durationMinutes: minutes, excludeBookingId }));

describe.skipIf(!hasPostgrest)("who is free for a visit", { timeout: 120_000 }, () => {
  it("names each person who isn't, with the reason; everyone else is left out", async () => {
    const c = await company();
    // Anna: on another job 10:00 to 12:00.
    const job = await addBooking(api.sql, c.org, c.client, { scheduledAt: instant("10:00"), durationMinutes: 120 });
    await addCrew(api.sql, c.org, job, c.anna.membershipId);
    // Bea: approved time off that day.
    await api.sql(
      "insert into public.pto_requests (organization_id, employee_id, start_date, end_date, status) values ($1, $2, $3, $3, 'approved')",
      [c.org, c.bea.membershipId, DAY],
    );
    // Cara: works Monday to Friday, and this is a Saturday.
    for (const day of [1, 2, 3, 4, 5]) {
      await api.sql(
        "insert into public.availability_slots (organization_id, membership_id, day_of_week, start_time, end_time) values ($1, $2, $3, '09:00', '17:00')",
        [c.org, c.cara.membershipId, day],
      );
    }
    // Dan: nothing on file. Free.

    const res = await ask(c.owner, "11:00", 120);
    expect(res, api.log()).toMatchObject({ ok: true });
    if (!res.ok) return;
    expect(Object.keys(res.unavailable).sort()).toEqual([c.anna.membershipId, c.bea.membershipId, c.cara.membershipId].sort());
    expect(res.unavailable[c.anna.membershipId]).toMatchObject({ kind: "busy" });
    expect(res.unavailable[c.anna.membershipId].reason).toMatch(/^On another job then: Smith \d+, 10:00 AM$/);
    expect(res.unavailable[c.bea.membershipId]).toEqual({ kind: "off", reason: "Off that day" });
    expect(res.unavailable[c.cara.membershipId]).toEqual({ kind: "hours", reason: "Doesn't work Saturdays" });

    // A manager gets the same answer.
    const forManager = await ask(c.manager, "11:00", 120);
    expect(forManager).toEqual(res);
  });

  it("back to back is free; a minute's overlap is not; the visit being edited is not its own clash", async () => {
    const c = await company();
    const job = await addBooking(api.sql, c.org, c.client, { scheduledAt: instant("10:00"), durationMinutes: 120 });
    await addCrew(api.sql, c.org, job, c.anna.membershipId);
    const busy = async (hhmm: string, minutes: number, exclude?: string) => {
      const res = await ask(c.owner, hhmm, minutes, exclude);
      if (!res.ok) throw new Error(`check failed\n${api.log()}`);
      return c.anna.membershipId in res.unavailable;
    };
    expect(await busy("12:00", 60)).toBe(false);
    expect(await busy("08:00", 120)).toBe(false);
    expect(await busy("11:59", 60)).toBe(true);
    expect(await busy("08:00", 121)).toBe(true);
    // No length typed yet: judged on the start time alone.
    expect(await busy("10:30", 0)).toBe(true);
    expect(await busy("12:00", 0)).toBe(false);
    // Editing that same visit: Anna is free for it.
    expect(await busy("10:00", 120, job)).toBe(false);
  });

  it("a cancelled job, a day marked unavailable, hours for one date, and pending time off", async () => {
    const c = await company();
    const gone = await addBooking(api.sql, c.org, c.client, { scheduledAt: instant("10:00"), durationMinutes: 120, status: "cancelled" });
    await addCrew(api.sql, c.org, gone, c.anna.membershipId);
    await api.sql(
      "insert into public.availability_overrides (organization_id, membership_id, date, kind) values ($1, $2, $3, 'off')",
      [c.org, c.bea.membershipId, DAY],
    );
    await api.sql(
      "insert into public.availability_overrides (organization_id, membership_id, date, kind, start_time, end_time) values ($1, $2, $3, 'custom', '13:00', '16:00')",
      [c.org, c.cara.membershipId, DAY],
    );
    // Asked for, not approved: not time off yet.
    await api.sql(
      "insert into public.pto_requests (organization_id, employee_id, start_date, end_date, status) values ($1, $2, $3, $3, 'pending')",
      [c.org, c.dan.membershipId, DAY],
    );

    const res = await ask(c.owner, "10:00", 120);
    expect(res, api.log()).toMatchObject({ ok: true });
    if (!res.ok) return;
    expect(res.unavailable).toEqual({
      [c.bea.membershipId]: { kind: "off", reason: "Off that day" },
      [c.cara.membershipId]: { kind: "hours", reason: "Works 1:00 PM to 4:00 PM that day" },
    });
    const afternoon = await ask(c.owner, "13:00", 120);
    expect(afternoon.ok && Object.keys(afternoon.unavailable)).toEqual([c.bea.membershipId]);
  });

  it("shared hours: the second person on a four-hour visit is there for two, so a job after her half is no clash", async () => {
    // Svitlana, 2026-11-15: two cleaners on a 9:00 job, the second with an
    // 11:30 job. Divided, each is there 9:00 to 11:00.
    const c = await company();
    const later = await addBooking(api.sql, c.org, c.client, { scheduledAt: instant("11:30"), durationMinutes: 120 });
    await addCrew(api.sql, c.org, later, c.anna.membershipId);
    const annaBusy = async (input: { crewIds?: string[]; dividesHours?: boolean }) => {
      const res = await as(c.owner, () =>
        check.getCrewAvailabilityAction({ scheduledAtLocal: at("09:00"), durationMinutes: 240, ...input }),
      );
      if (!res.ok) throw new Error(`check failed\n${api.log()}`);
      return c.anna.membershipId in res.unavailable;
    };
    await api.sql("update public.organizations set automation_settings = '{}'::jsonb where id = $1", [c.org]);
    const orgShares = await (await import("@/lib/crew-hours")).orgDividesCrewHours(c.org);
    expect(orgShares, "this company does not divide by default").toBe(false);

    // Not divided: she would work all four hours, into her 11:30.
    expect(await annaBusy({ crewIds: [c.bea.membershipId] })).toBe(true);
    // Divided, alone: still all four hours.
    expect(await annaBusy({ dividesHours: true })).toBe(true);
    // Divided, as the second person: two hours, done by 11:00.
    expect(await annaBusy({ crewIds: [c.bea.membershipId], dividesHours: true })).toBe(false);
    // Already picked, with Bea: the same two hours.
    expect(await annaBusy({ crewIds: [c.bea.membershipId, c.anna.membershipId], dividesHours: true })).toBe(false);

    // The pop-up's version, for a visit that exists, reads its time and its
    // own tick, and doesn't count the visit against its own crew.
    const morning = await addBooking(api.sql, c.org, c.client, { scheduledAt: instant("09:00"), durationMinutes: 240 });
    await addCrew(api.sql, c.org, morning, c.bea.membershipId);
    const forBooking = async (crewIds: string[]) => {
      const res = await as(c.owner, () => check.getCrewAvailabilityForBookingAction(morning, crewIds));
      if (!res.ok) throw new Error(`check failed\n${api.log()}`);
      return Object.keys(res.unavailable).sort();
    };
    expect(await forBooking([c.bea.membershipId])).toEqual([c.anna.membershipId]);
    await api.sql("update public.bookings set divide_hours_evenly = true where id = $1", [morning]);
    expect(await forBooking([c.bea.membershipId])).toEqual([]);
    expect(await as(c.anna, () => check.getCrewAvailabilityForBookingAction(morning))).toEqual({ ok: false });
    const other = await company();
    expect(await as(other.owner, () => check.getCrewAvailabilityForBookingAction(morning))).toEqual({ ok: false });
  });

  it("only answers the office, only about its own company, and fails closed on a bad time", async () => {
    const c = await company();
    const other = await company();
    const job = await addBooking(api.sql, other.org, other.client, { scheduledAt: instant("10:00"), durationMinutes: 120 });
    await addCrew(api.sql, other.org, job, other.anna.membershipId);

    expect(await ask(c.anna, "10:00", 120)).toEqual({ ok: false });
    expect(await ask(c.owner, "10:00", 120)).toEqual({ ok: true, unavailable: {} });
    expect(await as(c.owner, () => check.getCrewAvailabilityAction({ scheduledAtLocal: "soon", durationMinutes: 60 }))).toEqual({ ok: false });
  });
});

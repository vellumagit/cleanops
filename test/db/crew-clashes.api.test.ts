/**
 * A double-booking refusal says who, which job and when (2026-11-14).
 *
 * Svitlana set up a fortnightly series for a new client. The cleaner she
 * wanted was free on the first visit and booked on later ones, and every
 * save came back with the database's own sentence, "A cleaner already has
 * an overlapping booking": no name, no date, no other job. She could not
 * find the clash from the form, saved the series with nobody on it, and
 * gave up.
 *
 * The real actions and the real lookup against the real stack
 * (test/db/api.ts). What overlaps is still the database's call; these check
 * that the answer it gives is turned into the right names and dates.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async () => (await import("./next-stubs")).nextServer());

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
/** Nine in the morning UTC, `days` from now. */
const at = (days: number, hour = 9) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

type Company = { org: string; manager: Member };

async function company(opts: { sharesHours?: boolean } = {}): Promise<Company> {
  const org = await addOrg(api.sql, "Company");
  await api.sql(
    "update public.organizations set automations_enabled = true, timezone = 'UTC', automation_settings = $2::jsonb where id = $1",
    [org, JSON.stringify(opts.sharesHours ? { divide_crew_hours: { enabled: true } } : {})],
  );
  return { org, manager: await addMember(api.sql, org, "manager", "Manager") };
}

async function job(c: Company, clientName: string, when: string, minutes: number, crew: Member[]): Promise<string> {
  const [client] = await api.sql<{ id: string }>(
    "insert into public.clients (organization_id, name) values ($1, $2) returning id",
    [c.org, clientName],
  );
  const id = await addBooking(api.sql, c.org, client.id, { scheduledAt: when, durationMinutes: minutes });
  for (const [i, m] of crew.entries()) {
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, $4)",
      [c.org, id, m.membershipId, i === 0],
    );
    if (i === 0) await api.sql("update public.bookings set assigned_to = $2 where id = $1", [id, m.membershipId]);
  }
  return id;
}

const crewOf = async (id: string) =>
  (await api.sql<{ membership_id: string }>("select membership_id from public.booking_assignees where booking_id = $1", [id])).map(
    (r) => r.membership_id,
  );

async function assign(who: Member, jobId: string, primary: Member | null, additional: Member[] = []) {
  request.cookies = api.sessionCookies(who.userId);
  try {
    const form = new FormData();
    form.set("id", jobId);
    form.set("primary_id", primary?.membershipId ?? "");
    for (const m of additional) form.append("additional_ids", m.membershipId);
    return await bookings.assignBookingCrewAction({}, form);
  } finally {
    await settle();
  }
}

describe.skipIf(!hasPostgrest)("double-booking: the refusal names who, which job and when", () => {
  it("putting a cleaner on a second job at the same time names her and the job she is on", async () => {
    const c = await company();
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    await api.sql("update public.memberships set display_name = 'Olha Musnytska' where id = $1", [olha.membershipId]);
    await job(c, "Nancy Whitson", at(20), 240, [olha]);
    const stacie = await job(c, "Stacie Moore", at(20, 10), 180, []);

    const res = await assign(c.manager, stacie, olha);
    expect(res.error).toContain("Olha Musnytska is already booked then: Nancy Whitson,");
    expect(res.error).toContain("9:00 AM");
    expect(res.error).toContain("Nothing was changed.");
    // The sentence it replaces.
    expect(res.error).not.toMatch(/A cleaner already has an overlapping booking/);
    expect(await crewOf(stacie)).toEqual([]);
  });

  it("someone who is free still goes on", async () => {
    const c = await company();
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    const vira = await addMember(api.sql, c.org, "employee", "Vira");
    await job(c, "Nancy Whitson", at(20), 240, [olha]);
    const stacie = await job(c, "Stacie Moore", at(20, 10), 180, []);

    const res = await assign(c.manager, stacie, vira);
    expect(res.error, api.log()).toBeUndefined();
    expect(await crewOf(stacie)).toEqual([vira.membershipId]);
  });

  it("two people refused at once are each named with their own job", async () => {
    const c = await company();
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    const vira = await addMember(api.sql, c.org, "employee", "Vira");
    await api.sql("update public.memberships set display_name = 'Olha Musnytska' where id = $1", [olha.membershipId]);
    await api.sql("update public.memberships set display_name = 'Vira Karpynska' where id = $1", [vira.membershipId]);
    await job(c, "Nancy Whitson", at(20), 240, [olha]);
    await job(c, "Emma Drebit", at(20, 11), 120, [vira]);
    const stacie = await job(c, "Stacie Moore", at(20, 10), 180, []);

    const res = await assign(c.manager, stacie, olha, [vira]);
    expect(res.error).toContain("Olha Musnytska is already booked then: Nancy Whitson,");
    expect(res.error).toContain("Vira Karpynska is already booked then: Emma Drebit,");
    expect(await crewOf(stacie)).toEqual([]);
  });

  it("a series: free on the first visit, booked on later ones, and every clashing date is listed", async () => {
    const c = await company();
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    await api.sql("update public.memberships set display_name = 'Olha Musnytska' where id = $1", [olha.membershipId]);
    // Six fortnightly visits for the new client, nobody on them yet.
    const visits: Array<{ id: string; when: string }> = [];
    for (let i = 0; i < 6; i++) {
      const when = at(20 + i * 14);
      visits.push({ id: await job(c, "Stacie Moore", when, 180, []), when });
    }
    // She is free on the first, and already somewhere else on the 3rd and 5th.
    await job(c, "Nancy Whitson", at(20 + 2 * 14), 240, [olha]);
    await job(c, "Emma Drebit", at(20 + 4 * 14, 10), 120, [olha]);
    // A job on another day entirely is not a clash.
    await job(c, "Someone Else", at(21), 240, [olha]);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const { explainDoubleBooking, findCrewClashes } = await import("@/lib/crew-clashes");
    const proposed = visits.map((v) => ({
      bookingId: v.id,
      scheduledAt: v.when,
      durationMinutes: 180,
      crew: [{ membershipId: olha.membershipId }],
    }));

    const clashes = await findCrewClashes(
      createSupabaseAdminClient(),
      c.org,
      proposed.map((p) => ({ ...p, dividesHours: false })),
    );
    expect(clashes.map((x) => x.clientName).sort()).toEqual(["Emma Drebit", "Nancy Whitson"]);

    const text = (await explainDoubleBooking(createSupabaseAdminClient(), c.org, proposed)) as string;
    expect(text).toContain("Olha Musnytska is already booked on 2 of these dates:");
    expect(text).toContain("Nancy Whitson,");
    expect(text).toContain("Emma Drebit,");
    expect(text).not.toContain("Someone Else");
    expect(text).toContain("Choose someone who is free on every date");
  });

  it("the visits being saved are not clashes with themselves", async () => {
    const c = await company();
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    // She is already on both visits of the series being re-saved.
    const a = await job(c, "Stacie Moore", at(20), 180, [olha]);
    const b = await job(c, "Stacie Moore 2", at(34), 180, [olha]);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const { findCrewClashes } = await import("@/lib/crew-clashes");
    const clashes = await findCrewClashes(createSupabaseAdminClient(), c.org, [
      { bookingId: a, scheduledAt: at(20), durationMinutes: 180, dividesHours: false, crew: [{ membershipId: olha.membershipId }] },
      { bookingId: b, scheduledAt: at(34), durationMinutes: 180, dividesHours: false, crew: [{ membershipId: olha.membershipId }] },
    ]);
    expect(clashes).toEqual([]);
  });

  it("shared hours: two people on a 4-hour job are each there two hours, so a job after that is no clash", async () => {
    const c = await company({ sharesHours: true });
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    const vira = await addMember(api.sql, c.org, "employee", "Vira");
    // 9:00, four hours shared by two: each is there 9:00 to 11:00.
    await job(c, "Nancy Whitson", at(20), 240, [olha, vira]);
    const later = await job(c, "Stacie Moore", at(20, 11), 120, []);
    const during = await job(c, "Emma Drebit", at(20, 10), 120, []);

    expect((await assign(c.manager, later, olha)).error, api.log()).toBeUndefined();
    const res = await assign(c.manager, during, vira);
    expect(res.error).toContain("is already booked then: Nancy Whitson,");
  });

  // The save Svitlana was making: the Assign dialog, "This and all future
  // bookings". It goes through its own database function, and on the test
  // stack it was still answering with the bare sentence after the other
  // paths had been fixed. Found by trying it on screen, not by a test.
  it("Assign, this and all future: free on the visit that is open, booked later, and the dates are named", async () => {
    const c = await company();
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    await api.sql("update public.memberships set display_name = 'Olha Musnytska' where id = $1", [olha.membershipId]);
    const [client] = await api.sql<{ id: string }>(
      "insert into public.clients (organization_id, name) values ($1, 'Stacie Moore') returning id",
      [c.org],
    );
    const [series] = await api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes)
       values ($1, $2, 'bi_weekly', '09:00', current_date, 180) returning id`,
      [c.org, client.id],
    );
    const visits: Array<{ id: string; when: string }> = [];
    for (let i = 0; i < 4; i++) {
      const when = at(20 + i * 14);
      const id = await addBooking(api.sql, c.org, client.id, { scheduledAt: when, durationMinutes: 180 });
      await api.sql("update public.bookings set series_id = $2 where id = $1", [id, series.id]);
      visits.push({ id, when });
    }
    await job(c, "Nancy Whitson", at(20 + 14), 240, [olha]);
    await job(c, "Emma Drebit", at(20 + 3 * 14, 10), 120, [olha]);

    request.cookies = api.sessionCookies(c.manager.userId);
    let res: Awaited<ReturnType<typeof bookings.assignBookingCrewAction>>;
    try {
      const form = new FormData();
      form.set("id", visits[0].id);
      form.set("primary_id", olha.membershipId);
      form.set("update_scope", "this_and_future");
      form.set("series_id", series.id);
      form.set("series_scheduled_at", visits[0].when);
      res = await bookings.assignBookingCrewAction({}, form);
    } finally {
      await settle();
    }

    expect(res.error).toContain("Olha Musnytska is already booked on 2 of these dates:");
    expect(res.error).toContain("Nancy Whitson,");
    expect(res.error).toContain("Emma Drebit,");
    expect(res.error).toContain("Choose someone who is free on every date");
    expect(res.error).not.toMatch(/A cleaner already has an overlapping booking/);
    // All or nothing: not even the visit she is free on was changed.
    for (const v of visits) expect(await crewOf(v.id)).toEqual([]);
  });

  it("Assign, this and all future, with someone free on every date goes through", async () => {
    const c = await company();
    const vira = await addMember(api.sql, c.org, "employee", "Vira");
    const [client] = await api.sql<{ id: string }>(
      "insert into public.clients (organization_id, name) values ($1, 'Stacie Moore') returning id",
      [c.org],
    );
    const [series] = await api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes)
       values ($1, $2, 'bi_weekly', '09:00', current_date, 180) returning id`,
      [c.org, client.id],
    );
    const visits: Array<{ id: string; when: string }> = [];
    for (let i = 0; i < 3; i++) {
      const when = at(20 + i * 14);
      const id = await addBooking(api.sql, c.org, client.id, { scheduledAt: when, durationMinutes: 180 });
      await api.sql("update public.bookings set series_id = $2 where id = $1", [id, series.id]);
      visits.push({ id, when });
    }

    request.cookies = api.sessionCookies(c.manager.userId);
    let res: Awaited<ReturnType<typeof bookings.assignBookingCrewAction>>;
    try {
      const form = new FormData();
      form.set("id", visits[0].id);
      form.set("primary_id", vira.membershipId);
      form.set("update_scope", "this_and_future");
      form.set("series_id", series.id);
      form.set("series_scheduled_at", visits[0].when);
      res = await bookings.assignBookingCrewAction({}, form);
    } finally {
      await settle();
    }
    expect(res.error, api.log()).toBeUndefined();
    for (const v of visits) expect(await crewOf(v.id)).toEqual([vira.membershipId]);
  });
});

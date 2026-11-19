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

  // 2026-11-15, Svitlana, Stacie Moore: three hours at 9:00 for Olha and
  // Vira, who are both on another job at 11:30. Shared between two, each is
  // there until 10:30, so there is no clash, and the save was refused anyway.
  // The database checked each person as she was added, while the job still
  // looked like a one-person job: three hours each, 9:00 to 12:00.
  it("shared hours: putting two people on a job at once checks each for her share, not the whole job", async () => {
    const c = await company({ sharesHours: true });
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    const vira = await addMember(api.sql, c.org, "employee", "Vira");
    await job(c, "Sylvia Gillespie", at(20, 11), 240, [olha, vira]);
    await api.sql(
      "update public.bookings set scheduled_at = scheduled_at + interval '30 minutes' where client_id = (select id from public.clients where organization_id = $1 and name = 'Sylvia Gillespie')",
      [c.org],
    );
    const stacie = await job(c, "Stacie Moore", at(20), 180, []);

    expect((await assign(c.manager, stacie, olha, [vira])).error, api.log()).toBeUndefined();
    expect((await crewOf(stacie)).sort()).toEqual([olha.membershipId, vira.membershipId].sort());

    // And the rule still bites: alone, Olha would be there the full three
    // hours, into the 11:30 job.
    const alone = await job(c, "Alone Job", at(21), 180, []);
    await job(c, "Later That Day", at(21, 11), 120, [olha]);
    expect((await assign(c.manager, alone, olha)).error).toContain("is already booked then: Later That Day");
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

  it("bringing back a cancelled job whose cleaner has since been booked then names her and that job", async () => {
    const c = await company();
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    await api.sql("update public.memberships set display_name = 'Olha Musnytska' where id = $1", [olha.membershipId]);
    const cancelled = await job(c, "Was Cancelled", at(6), 180, [olha]);
    await api.sql("update public.bookings set status = 'cancelled' where id = $1", [cancelled]);
    await job(c, "Booked Since", at(6, 10), 180, [olha]);

    request.cookies = api.sessionCookies(c.manager.userId);
    let result: { ok: boolean; error?: string };
    try {
      const form = new FormData();
      form.set("id", cancelled);
      form.set("status", "confirmed");
      result = await bookings.setBookingStatusAction(form);
    } finally {
      await settle();
    }
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Olha Musnytska is already booked then: Booked Since");
    expect(result.error).not.toMatch(/overlapping booking/i);
    const [row] = await api.sql<{ status: string }>("select status from public.bookings where id = $1", [cancelled]);
    expect(row.status).toBe("cancelled");
  });

  it("making a booking recurring when its cleaner is booked on a later date names that date and leaves no series behind", async () => {
    const c = await company();
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    await api.sql("update public.memberships set display_name = 'Olha Musnytska' where id = $1", [olha.membershipId]);
    const first = await job(c, "Goes Weekly", at(3), 180, [olha]);
    // Two weeks after the first visit, same hour: the third visit would land on it.
    await job(c, "In The Way", at(17, 10), 180, [olha]);

    request.cookies = api.sessionCookies(c.manager.userId);
    let result: { ok: boolean; error?: string };
    try {
      const form = new FormData();
      form.set("pattern", "weekly");
      result = await bookings.convertBookingToRecurringAction(first, form);
    } finally {
      await settle();
    }
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Olha Musnytska is already booked");
    expect(result.error).toContain("In The Way");
    expect(result.error).not.toMatch(/overlapping booking/i);
    expect(await api.sql("select 1 from public.booking_series where organization_id = $1", [c.org])).toEqual([]);
    const [row] = await api.sql<{ series_id: string | null }>("select series_id from public.bookings where id = $1", [first]);
    expect(row.series_id).toBeNull();
  });

  it("shared hours: a NEW booking with two people is judged on each one's share too", async () => {
    const c = await company({ sharesHours: true });
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    const vira = await addMember(api.sql, c.org, "employee", "Vira");
    await job(c, "Sylvia Gillespie", at(22, 11), 240, [olha, vira]);
    const [client] = await api.sql<{ id: string }>(
      "insert into public.clients (organization_id, name) values ($1, 'Stacie Moore') returning id",
      [c.org],
    );
    const [service] = await api.sql<{ id: string }>(
      "insert into public.service_types (organization_id, name) values ($1, 'Standard clean') returning id",
      [c.org],
    );
    const create = async (crew: Member[]) => {
      request.cookies = api.sessionCookies(c.manager.userId);
      try {
        const form = new FormData();
        form.set("client_id", client.id);
        form.set("assigned_to", crew[0].membershipId);
        for (const m of crew.slice(1)) form.append("additional_assignees", m.membershipId);
        form.set("scheduled_at", at(22).slice(0, 16));
        form.set("duration_minutes", "180");
        form.set("service_type", "standard");
        form.set("service_type_id", service.id);
        form.set("service_type_label", "Standard clean");
        form.set("status", "confirmed");
        form.set("total_cents", "100");
        const res = await bookings.createBookingAction({}, form);
        return `returned ${JSON.stringify(res)}`;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      } finally {
        await settle();
      }
    };

    // Three hours for two: each until 10:30, clear of the 11:00 job.
    expect(await create([olha, vira]), api.log()).toMatch(/^redirected to /);
    const made = await api.sql<{ id: string; assigned_to: string | null }>(
      "select id, assigned_to from public.bookings where client_id = $1",
      [client.id],
    );
    expect(made).toHaveLength(1);
    expect(made[0].assigned_to).toBe(olha.membershipId);
    expect((await crewOf(made[0].id)).sort()).toEqual([olha.membershipId, vira.membershipId].sort());

    // Alone she would be there the full three hours, into the 11:00 job:
    // refused, by name, and nothing is left behind.
    const refused = await create([olha]);
    expect(refused).toContain("is already booked");
    expect(refused).toContain("Sylvia Gillespie");
    expect(await api.sql("select 1 from public.bookings where client_id = $1", [client.id])).toHaveLength(1);
  });

  it("shared hours: taking someone off a job is never refused, even though the one left now runs long", async () => {
    const c = await company({ sharesHours: true });
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    const vira = await addMember(api.sql, c.org, "employee", "Vira");
    const shared = await job(c, "Shared Morning", at(23), 180, [olha, vira]);
    await job(c, "Half Past Eleven", at(23, 11), 120, [olha]);

    // Vira calls in sick. Olha alone is there 9:00 to 12:00, over the 11:00
    // job; that is for the morning check to list, not for this save to refuse.
    expect((await assign(c.manager, shared, olha)).error, api.log()).toBeUndefined();
    expect(await crewOf(shared)).toEqual([olha.membershipId]);
  });

  it("shared hours: swapping one person for another checks the newcomer and leaves the one who stays alone", async () => {
    const c = await company({ sharesHours: true });
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    const vira = await addMember(api.sql, c.org, "employee", "Vira");
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const busy = await addMember(api.sql, c.org, "employee", "Busy");
    await api.sql("update public.memberships set display_name = 'Busy Person' where id = $1", [busy.membershipId]);
    const shared = await job(c, "Shared Morning", at(24), 240, [olha, vira]);
    await job(c, "Ten O'Clock", at(24, 10), 60, [busy]);

    // Busy is on another job at 10:00, inside her 9:00 to 11:00 share here.
    const refused = await assign(c.manager, shared, olha, [busy]);
    expect(refused.error).toContain("Busy Person is already booked then: Ten O'Clock");
    expect((await crewOf(shared)).sort()).toEqual([olha.membershipId, vira.membershipId].sort());

    expect((await assign(c.manager, shared, olha, [anna])).error, api.log()).toBeUndefined();
    expect((await crewOf(shared)).sort()).toEqual([olha.membershipId, anna.membershipId].sort());
  });

  it("the database change is safe to run a second time", async () => {
    const { readFileSync } = await import("node:fs");
    const sqlText = readFileSync("supabase/migrations/20261115010000_overlap_guard_whole_crew.sql", "utf8");
    await api.db.exec(sqlText);
    const c = await company({ sharesHours: true });
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    const vira = await addMember(api.sql, c.org, "employee", "Vira");
    await job(c, "Later", at(25, 11), 120, [olha, vira]);
    const morning = await job(c, "Morning", at(25), 180, []);
    expect((await assign(c.manager, morning, olha, [vira])).error, api.log()).toBeUndefined();
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

describe.skipIf(!hasPostgrest)("booking someone on their day off asks first", () => {
  /** A company in UTC, a client and a service, and the booking form for them. */
  async function setUp() {
    const c = await company();
    const [client] = await api.sql<{ id: string }>(
      "insert into public.clients (organization_id, name) values ($1, 'Away Day Client') returning id",
      [c.org],
    );
    const [service] = await api.sql<{ id: string }>(
      "insert into public.service_types (organization_id, name) values ($1, 'Standard clean') returning id",
      [c.org],
    );
    const formFor = (when: string, crew: Member[], extra: Record<string, string> = {}) => {
      const form = new FormData();
      form.set("client_id", client.id);
      form.set("assigned_to", crew[0]?.membershipId ?? "");
      for (const m of crew.slice(1)) form.append("additional_assignees", m.membershipId);
      form.set("scheduled_at", when.slice(0, 16));
      form.set("duration_minutes", "120");
      form.set("service_type", "standard");
      form.set("service_type_id", service.id);
      form.set("service_type_label", "Standard clean");
      form.set("status", "confirmed");
      form.set("total_cents", "100");
      for (const [k, v] of Object.entries(extra)) form.set(k, v);
      return form;
    };
    const press = async <T,>(work: () => Promise<T>): Promise<T | { redirected: string }> => {
      request.cookies = api.sessionCookies(c.manager.userId);
      try {
        return await work();
      } catch (err) {
        const m = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
        if (m) return { redirected: m[1] };
        throw err;
      } finally {
        await settle();
      }
    };
    const count = async () => (await api.sql("select 1 from public.bookings where client_id = $1", [client.id])).length;
    return { c, client: client.id, formFor, press, count };
  }
  const offOn = (c: Company, who: Member, day: string) =>
    api.sql(
      "insert into public.pto_requests (organization_id, employee_id, start_date, end_date, status) values ($1, $2, $3, $3, 'approved')",
      [c.org, who.membershipId, day.slice(0, 10)],
    );

  it("a new visit: the first save names them and saves nothing, the second goes through", async () => {
    const { c, formFor, press, count } = await setUp();
    const john = await addMember(api.sql, c.org, "employee", "John");
    await api.sql("update public.memberships set display_name = 'John Away' where id = $1", [john.membershipId]);
    const when = at(30);
    await offOn(c, john, when);

    const asked = (await press(() => bookings.createBookingAction({}, formFor(when, [john])))) as {
      errors?: Record<string, string>;
      values?: Record<string, string>;
    };
    expect(asked.errors?._form, api.log()).toContain("John Away is off on");
    expect(asked.errors?._form).toContain("Press Save again to book them anyway");
    expect(asked.values?.confirm_time_off).toBe(`${when.slice(0, 10)}:${john.membershipId}`);
    expect(await count()).toBe(0);

    const saved = await press(() =>
      bookings.createBookingAction({}, formFor(when, [john], { confirm_time_off: asked.values!.confirm_time_off })),
    );
    expect(saved, api.log()).toMatchObject({ redirected: expect.any(String) });
    expect(await count()).toBe(1);
  });

  it("a yes for one day is not a yes for another, and a pending request doesn't ask at all", async () => {
    const { c, formFor, press, count } = await setUp();
    const john = await addMember(api.sql, c.org, "employee", "John");
    const first = at(31);
    const second = at(32);
    await offOn(c, john, first);
    await offOn(c, john, second);
    const stale = `${first.slice(0, 10)}:${john.membershipId}`;
    const asked = (await press(() => bookings.createBookingAction({}, formFor(second, [john], { confirm_time_off: stale })))) as {
      errors?: Record<string, string>;
    };
    expect(asked.errors?._form).toContain("is off on");
    expect(await count()).toBe(0);

    const vira = await addMember(api.sql, c.org, "employee", "Vira");
    await api.sql(
      "insert into public.pto_requests (organization_id, employee_id, start_date, end_date, status) values ($1, $2, $3, $3, 'pending')",
      [c.org, vira.membershipId, at(33).slice(0, 10)],
    );
    expect(await press(() => bookings.createBookingAction({}, formFor(at(33), [vira]))), api.log()).toMatchObject({
      redirected: expect.any(String),
    });
  });

  it("editing: adding someone who is off asks; saving the same crew on the same day again does not", async () => {
    const { c, client, formFor, press } = await setUp();
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    const john = await addMember(api.sql, c.org, "employee", "John");
    const when = at(34);
    await offOn(c, john, when);
    const id = await addBooking(api.sql, c.org, client, { scheduledAt: when, durationMinutes: 120 });
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, true)",
      [c.org, id, olha.membershipId],
    );
    await api.sql("update public.bookings set assigned_to = $2 where id = $1", [id, olha.membershipId]);

    const asked = (await press(() => bookings.updateBookingAction(id, {}, formFor(when, [olha, john])))) as {
      errors?: Record<string, string>;
      values?: Record<string, string>;
    };
    expect(asked.errors?._form, api.log()).toContain("is off on");
    expect(await crewOf(id)).toEqual([olha.membershipId]);

    const saved = await press(() =>
      bookings.updateBookingAction(id, {}, formFor(when, [olha, john], { confirm_time_off: asked.values!.confirm_time_off })),
    );
    expect((saved as { errors?: unknown }).errors, JSON.stringify(saved) + api.log()).toBeUndefined();
    expect((await crewOf(id)).sort()).toEqual([olha.membershipId, john.membershipId].sort());

    // John is on it now by the office's choice: a later edit of the same
    // visit, same day, same people, is not asked about him again.
    const again = await press(() => bookings.updateBookingAction(id, {}, formFor(when, [olha, john], { notes: "Use the side door" })));
    expect((again as { errors?: unknown }).errors, JSON.stringify(again)).toBeUndefined();
  });
});

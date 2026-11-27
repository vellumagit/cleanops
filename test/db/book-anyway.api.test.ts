/**
 * "Book anyway" (migration 20261124020000).
 *
 * Svitlana, 2026-11-23: she wanted to put Olha and Vira on a visit that
 * overlapped a job they were already on and move one of them later. Every
 * save was refused, so the visit could not go down at all. Now the office
 * (an owner, admin or manager) is refused once, with the names, and a Book
 * anyway press keeps the overlap.
 *
 * The real actions against the real stack (test/db/api.ts): the refusal
 * carries a key and saves nothing; the press saves, writes an audit entry,
 * and the visit's page can name the overlap; a changed save asks again; a
 * manager gets it as an owner does (widened 2026-11-23), a cleaner never;
 * and a last working day is still a hard stop.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addMember, addOrg, type Member } from "./harness";
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
/** `hour`:00 UTC, `days` from now. */
const at = (days: number, hour: number) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

type Result = { errors?: Record<string, string>; values?: Record<string, string> } | { redirected: string };

async function setUp() {
  const org = await addOrg(api.sql, "Overlap Co");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  const owner = await addMember(api.sql, org, "owner", "Owner");
  const manager = await addMember(api.sql, org, "manager", "Manager");
  const olha = await addMember(api.sql, org, "employee", "Olha");
  const vira = await addMember(api.sql, org, "employee", "Vira");
  const [service] = await api.sql<{ id: string }>(
    "insert into public.service_types (organization_id, name) values ($1, 'Standard clean') returning id",
    [org],
  );
  const client = async (name: string) =>
    (
      await api.sql<{ id: string }>(
        "insert into public.clients (organization_id, name) values ($1, $2) returning id",
        [org, name],
      )
    )[0].id;

  // Leslie's job, 9 to 2, Olha and Vira on it.
  const leslie = await client("Leslie Saumer");
  const day = 20;
  const busy = await addBooking(api.sql, org, leslie, { scheduledAt: at(day, 9), durationMinutes: 300, status: "confirmed" });
  for (const [i, m] of [olha, vira].entries()) {
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, $4)",
      [org, busy, m.membershipId, i === 0],
    );
  }
  await api.sql("update public.bookings set assigned_to = $2 where id = $1", [busy, olha.membershipId]);

  const amanda = await client("Amanda SJ");
  const formFor = (crew: Member[], extra: Record<string, string> = {}, hour = 10) => {
    const f = new FormData();
    f.set("client_id", amanda);
    f.set("assigned_to", crew[0]?.membershipId ?? "");
    for (const m of crew.slice(1)) f.append("additional_assignees", m.membershipId);
    f.set("scheduled_at", at(day, hour).slice(0, 16));
    f.set("duration_minutes", "240");
    f.set("service_type", "standard");
    f.set("service_type_id", service.id);
    f.set("service_type_label", "Standard clean");
    f.set("status", "confirmed");
    f.set("total_cents", "100");
    f.set("notify_client", "0");
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };
  const press = async (as: Member, work: () => Promise<unknown>): Promise<Result> => {
    request.cookies = api.sessionCookies(as.userId);
    try {
      return (await work()) as Result;
    } catch (err) {
      const m = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
      if (m) return { redirected: m[1] };
      throw err;
    } finally {
      await settle();
    }
  };
  const amandaVisits = () =>
    api.sql<{ id: string; lead: string | null; crew: string[] }>(
      `select b.id, b.assigned_to as lead,
              coalesce((select array_agg(ba.membership_id order by ba.membership_id) from public.booking_assignees ba where ba.booking_id = b.id), '{}') as crew
         from public.bookings b where b.client_id = $1`,
      [amanda],
    );
  /** One of Amanda's visits, `hour`:00 for four hours, with this crew. */
  const amandaVisit = async (hour: number, crew: Member[] = [], days = day) => {
    const id = await addBooking(api.sql, org, amanda, { scheduledAt: at(days, hour), durationMinutes: 240, status: "confirmed" });
    for (const [i, m] of crew.entries()) {
      await api.sql(
        "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, $4)",
        [org, id, m.membershipId, i === 0],
      );
      if (i === 0) await api.sql("update public.bookings set assigned_to = $2 where id = $1", [id, m.membershipId]);
    }
    return id;
  };
  const visit = async (id: string) =>
    (
      await api.sql<{ at: string; lead: string | null; crew: string[]; cover: Array<{ membership_id: string; other_booking_id: string }> | null }>(
        `select to_char(b.scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as at, b.assigned_to as lead, b.cover_needed as cover,
                coalesce((select array_agg(ba.membership_id order by ba.membership_id) from public.booking_assignees ba where ba.booking_id = b.id), '{}') as crew
           from public.bookings b where b.id = $1`,
        [id],
      )
    )[0];
  return { org, owner, manager, olha, vira, busy, amanda, day, formFor, press, amandaVisits, amandaVisit, visit };
}

const asked = (r: Result) => r as { errors?: Record<string, string>; values?: Record<string, string> };

describe.skipIf(!hasPostgrest)("Book anyway", () => {
  it("is safe to run the database change twice", async () => {
    const { readFileSync } = await import("node:fs");
    await api.db.exec(readFileSync("supabase/migrations/20261124020000_book_over_a_clash.sql", "utf8"));
  });

  it("a new visit: refused once with the names and a key, then saved with the overlap on Book anyway", async () => {
    const s = await setUp();
    const first = asked(await s.press(s.owner, () => bookings.createBookingAction({}, s.formFor([s.olha, s.vira]))));
    expect(first.errors?._form, api.log()).toMatch(/Olha \d+ is already booked then: Leslie Saumer/);
    expect(first.errors?._form).toContain("press Book anyway");
    const key = first.values?.confirm_overlap;
    expect(key).toBe(
      [`${s.olha.membershipId}:${s.busy}`, `${s.vira.membershipId}:${s.busy}`].sort().join(","),
    );
    expect(await s.amandaVisits(), "nothing saved").toEqual([]);

    const saved = await s.press(s.owner, () =>
      bookings.createBookingAction({}, s.formFor([s.olha, s.vira], { confirm_overlap: key! })),
    );
    expect(saved, api.log()).toMatchObject({ redirected: expect.any(String) });
    const [visit] = await s.amandaVisits();
    expect(visit.lead).toBe(s.olha.membershipId);
    expect(visit.crew).toEqual([s.olha.membershipId, s.vira.membershipId].sort());

    const [audit] = await api.sql<{ after: { booked_over_clash: Array<{ other_booking_id: string }> } }>(
      "select after from public.audit_log where entity_id = $1 and organization_id = $2",
      [visit.id, s.org],
    );
    expect(audit.after.booked_over_clash.map((c) => c.other_booking_id)).toEqual([s.busy, s.busy]);

    // The visit's page names it, from both sides.
    const { clashesOnVisit } = await import("@/lib/crew-clashes");
    const { alsoBookedSentence } = await import("@/lib/crew-clash-text");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const here = await clashesOnVisit(createSupabaseAdminClient(), s.org, visit.id);
    expect(alsoBookedSentence(here, "UTC")).toMatch(/^Olha \d+ is also on Leslie Saumer's job \(.+\) at the same time\. Vira/);
    const there = await clashesOnVisit(createSupabaseAdminClient(), s.org, s.busy);
    expect(there.map((c) => c.bookingId)).toEqual([visit.id, visit.id]);
  });

  it("editing one visit: the same, and a plain Save after the question still refuses", async () => {
    const s = await setUp();
    // Amanda's visit, 10 to 2, with nobody on it yet.
    const id = await addBooking(api.sql, s.org, s.amanda, { scheduledAt: at(s.day, 10), durationMinutes: 240, status: "confirmed" });
    const first = asked(await s.press(s.owner, () => bookings.updateBookingAction(id, {}, s.formFor([s.olha]))));
    expect(first.errors?._form, api.log()).toMatch(/Olha \d+ is already booked then/);
    const key = first.values?.confirm_overlap;
    expect(key).toBe(`${s.olha.membershipId}:${s.busy}`);

    const plain = asked(await s.press(s.owner, () => bookings.updateBookingAction(id, {}, s.formFor([s.olha]))));
    expect(plain.errors?._form).toMatch(/already booked then/);
    expect((await s.amandaVisits())[0].crew).toEqual([]);

    const saved = await s.press(s.owner, () =>
      bookings.updateBookingAction(id, {}, s.formFor([s.olha], { confirm_overlap: key! })),
    );
    expect(saved, api.log()).toMatchObject({ redirected: expect.any(String) });
    expect((await s.amandaVisits())[0].crew).toEqual([s.olha.membershipId]);

    // Saved again later with nothing changed: the overlap was already
    // there, so the guard has nothing new to refuse.
    const again = await s.press(s.owner, () =>
      bookings.updateBookingAction(id, {}, s.formFor([s.olha], { notes: "Side door" })),
    );
    expect(again, api.log()).toMatchObject({ redirected: expect.any(String) });
  });

  // Svitlana, 2026-11-26: Carmen North's visit two days before, already
  // Completed, ran 45 minutes over into Veronika's next job. Lengthening it
  // was refused, she pressed Book anyway, and it refused again, over and
  // over: the press was ignored for a Completed visit, while the database
  // still counts a finished visit's overlaps. She moved the start time
  // earlier to get it saved.
  it("a Completed visit made longer into the next job: Book anyway saves it", async () => {
    const s = await setUp();
    const past = -2;
    const [bissell] = await api.sql<{ id: string }>(
      "insert into public.clients (organization_id, name) values ($1, 'Louise Bissell') returning id",
      [s.org],
    );
    // Olha's next job that day, 12 to 3.
    const next = await addBooking(api.sql, s.org, bissell.id, {
      scheduledAt: at(past, 12),
      durationMinutes: 180,
      status: "completed",
    });
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, true)",
      [s.org, next, s.olha.membershipId],
    );
    await api.sql("update public.bookings set assigned_to = $2 where id = $1", [next, s.olha.membershipId]);
    // 8 to 12, done and closed, Olha on it. Closed, as a finished visit is
    // (by the office, or by the crew's clock): an open one with nobody
    // clocked in reads as not started, and any save puts it back to
    // Confirmed (job-sync.ts).
    const id = await s.amandaVisit(8, [s.olha], past);
    await api.sql("update public.bookings set status = 'completed', closed_at = now() where id = $1", [id]);

    const longer = (extra: Record<string, string> = {}) =>
      s.formFor([s.olha], {
        scheduled_at: at(past, 8).slice(0, 16),
        duration_minutes: "285",
        status: "completed",
        ...extra,
      });
    const first = asked(await s.press(s.owner, () => bookings.updateBookingAction(id, {}, longer())));
    expect(first.errors?._form, api.log()).toMatch(/Olha \d+ is already booked then/);
    expect(first.errors?._form).toContain("press Book anyway");
    const key = first.values?.confirm_overlap;
    expect(key).toBe(`${s.olha.membershipId}:${next}`);

    const saved = await s.press(s.owner, () =>
      bookings.updateBookingAction(id, {}, longer({ confirm_overlap: key! })),
    );
    expect(saved, api.log()).toMatchObject({ redirected: expect.any(String) });
    const [row] = await api.sql<{ minutes: number; status: string; at: string }>(
      `select duration_minutes as minutes, status,
              to_char(scheduled_at at time zone 'UTC', 'HH24:MI') as at
         from public.bookings where id = $1`,
      [id],
    );
    expect(row).toEqual({ minutes: 285, status: "completed", at: "08:00" });
    expect((await s.visit(id)).crew).toEqual([s.olha.membershipId]);
  });

  it("a Completed visit entered afterwards over another job: Book anyway saves it", async () => {
    const s = await setUp();
    const past = -2;
    const other = await s.amandaVisit(9, [s.olha], past);
    await api.sql("update public.bookings set status = 'completed', closed_at = now() where id = $1", [other]);
    const before = (await s.amandaVisits()).length;

    const entered = (extra: Record<string, string> = {}) =>
      s.formFor([s.olha], { scheduled_at: at(past, 11).slice(0, 16), status: "completed", ...extra });
    const first = asked(await s.press(s.owner, () => bookings.createBookingAction({}, entered())));
    expect(first.errors?._form, api.log()).toContain("press Book anyway");
    expect(first.values?.confirm_overlap).toBe(`${s.olha.membershipId}:${other}`);
    expect((await s.amandaVisits()).length, "nothing saved yet").toBe(before);

    const saved = await s.press(s.owner, () =>
      bookings.createBookingAction({}, entered({ confirm_overlap: first.values!.confirm_overlap })),
    );
    expect(saved, api.log()).toMatchObject({ redirected: expect.any(String) });
    expect((await s.amandaVisits()).length).toBe(before + 1);
  });

  // The press is only as good as the agreement between the app, which names
  // the clashes and makes the key, and the database, which refuses. Svit
  // shares a job's hours across its crew: two people on a four-hour job are
  // each there two hours. If the two ever read that differently, the office
  // gets a refusal with no names and no button, or a button that can't work.
  it("with the crew's hours shared, as at Svit: only a real overlap asks, and Book anyway saves it", async () => {
    const s = await setUp();
    await api.sql(
      `update public.organizations set automations_enabled = true,
              automation_settings = '{"divide_crew_hours": {"enabled": true}}'::jsonb where id = $1`,
      [s.org],
    );
    // Leslie's 9-to-2 job is two people, so each is there 9 to 11:30.
    // Amanda's at 12 for four hours is noon to 2 each: clear of it.
    const clear = await s.press(s.owner, () => bookings.createBookingAction({}, s.formFor([s.olha, s.vira], {}, 12)));
    expect(clear, api.log()).toMatchObject({ redirected: expect.any(String) });
    const [visit] = await s.amandaVisits();

    // Moved to 10: 10 to noon each, into Leslie's 9 to 11:30.
    const first = asked(
      await s.press(s.owner, () => bookings.updateBookingAction(visit.id, {}, s.formFor([s.olha, s.vira], {}, 10))),
    );
    expect(first.errors?._form, api.log()).toContain("press Book anyway");
    expect(first.values?.confirm_overlap).toBe(
      [`${s.olha.membershipId}:${s.busy}`, `${s.vira.membershipId}:${s.busy}`].sort().join(","),
    );
    expect((await s.visit(visit.id)).at.slice(11), "not moved yet").toBe("12:00");

    const saved = await s.press(s.owner, () =>
      bookings.updateBookingAction(
        visit.id,
        {},
        s.formFor([s.olha, s.vira], { confirm_overlap: first.values!.confirm_overlap }, 10),
      ),
    );
    expect(saved, api.log()).toMatchObject({ redirected: expect.any(String) });
    expect((await s.visit(visit.id)).at.slice(11)).toBe("10:00");
  });

  // A split shift gives each person their own hours on the visit. The
  // question is about those hours, not the whole visit.
  it("a split shift: only the person whose own hours overlap is named, and Book anyway keeps the split", async () => {
    const s = await setUp();
    const day = s.day + 1;
    // Vira is on another job 10 to 11.
    const [other] = await api.sql<{ id: string }>(
      "insert into public.clients (organization_id, name) values ($1, 'Brent Bissell') returning id",
      [s.org],
    );
    const busy = await addBooking(api.sql, s.org, other.id, { scheduledAt: at(day, 10), durationMinutes: 60, status: "confirmed" });
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, true)",
      [s.org, busy, s.vira.membershipId],
    );
    await api.sql("update public.bookings set assigned_to = $2 where id = $1", [busy, s.vira.membershipId]);

    const split = (segments: Array<[Member, number, number]>, extra: Record<string, string> = {}) =>
      s.formFor([segments[0][0]], {
        scheduled_at: at(day, 10).slice(0, 16),
        splits: JSON.stringify(
          segments.map(([m, offset, minutes]) => ({
            assigned_to: m.membershipId,
            start_offset_minutes: offset,
            duration_minutes: minutes,
          })),
        ),
        ...extra,
      });
    // Olha 10 to noon, Vira noon to 2: Vira's own hours are clear of her
    // 10-to-11 job, though the visit as a whole is not.
    const clear = await s.press(s.owner, () =>
      bookings.createBookingAction({}, split([[s.olha, 0, 120], [s.vira, 120, 120]])),
    );
    expect(clear, api.log()).toMatchObject({ redirected: expect.any(String) });
    const [visit] = await s.amandaVisits();

    // Vira from 10:30 instead: into her other job. Olha is not named.
    const later: Array<[Member, number, number]> = [[s.olha, 0, 30], [s.vira, 30, 210]];
    const first = asked(await s.press(s.owner, () => bookings.updateBookingAction(visit.id, {}, split(later))));
    expect(first.errors?._form, api.log()).toMatch(/Vira \d+ is already booked then: Brent Bissell/);
    expect(first.errors?._form).not.toMatch(/Olha/);
    expect(first.values?.confirm_overlap).toBe(`${s.vira.membershipId}:${busy}`);

    const saved = await s.press(s.owner, () =>
      bookings.updateBookingAction(visit.id, {}, split(later, { confirm_overlap: first.values!.confirm_overlap })),
    );
    expect(saved, api.log()).toMatchObject({ redirected: expect.any(String) });
    const rows = await api.sql<{ membership_id: string; off: number; dur: number }>(
      `select membership_id, split_start_offset_minutes as off, split_duration_minutes as dur
         from public.booking_assignees where booking_id = $1 order by split_start_offset_minutes`,
      [visit.id],
    );
    expect(rows).toEqual([
      { membership_id: s.olha.membershipId, off: 0, dur: 30 },
      { membership_id: s.vira.membershipId, off: 30, dur: 210 },
    ]);
  });

  it("a key for one crew is not a yes for another", async () => {
    const s = await setUp();
    const first = asked(await s.press(s.owner, () => bookings.createBookingAction({}, s.formFor([s.olha]))));
    const key = first.values?.confirm_overlap;
    expect(key).toBeTruthy();

    // Vira added after the question: her clash was never shown.
    const again = asked(
      await s.press(s.owner, () => bookings.createBookingAction({}, s.formFor([s.olha, s.vira], { confirm_overlap: key! }))),
    );
    expect(again.errors?._form).toMatch(/Vira \d+ is already booked then/);
    expect(again.values?.confirm_overlap).not.toBe(key);
    expect(await s.amandaVisits()).toEqual([]);
  });

  it("off that day as well: both questions answered once each, then it saves", async () => {
    const s = await setUp();
    await api.sql(
      "insert into public.pto_requests (organization_id, employee_id, start_date, end_date, status) values ($1, $2, $3, $3, 'approved')",
      [s.org, s.olha.membershipId, at(s.day, 9).slice(0, 10)],
    );
    const away = asked(await s.press(s.owner, () => bookings.createBookingAction({}, s.formFor([s.olha]))));
    expect(away.errors?._form, api.log()).toContain("is off on");
    const timeOff = away.values!.confirm_time_off;

    const clash = asked(
      await s.press(s.owner, () => bookings.createBookingAction({}, s.formFor([s.olha], { confirm_time_off: timeOff }))),
    );
    expect(clash.errors?._form).toMatch(/already booked then/);
    expect(clash.values?.confirm_time_off, "the first yes is kept").toBe(timeOff);

    const saved = await s.press(s.owner, () =>
      bookings.createBookingAction(
        {},
        s.formFor([s.olha], { confirm_time_off: clash.values!.confirm_time_off, confirm_overlap: clash.values!.confirm_overlap }),
      ),
    );
    expect(saved, api.log()).toMatchObject({ redirected: expect.any(String) });
    expect((await s.amandaVisits()).length).toBe(1);
  });

  // It was owners and admins only for a day. The people running the
  // schedule are often managers, so they get it too.
  it("a manager gets Book anyway as an owner does", async () => {
    const s = await setUp();
    const first = asked(await s.press(s.manager, () => bookings.createBookingAction({}, s.formFor([s.olha]))));
    expect(first.errors?._form, api.log()).toContain("press Book anyway");
    expect(first.values?.confirm_overlap).toBe(`${s.olha.membershipId}:${s.busy}`);
    expect(await s.amandaVisits(), "nothing saved yet").toEqual([]);

    const saved = await s.press(s.manager, () =>
      bookings.createBookingAction({}, s.formFor([s.olha], { confirm_overlap: first.values!.confirm_overlap })),
    );
    expect(saved, api.log()).toMatchObject({ redirected: expect.any(String) });
    expect((await s.amandaVisits())[0].crew).toEqual([s.olha.membershipId]);
  });

  it("a last working day is not waived", async () => {
    const s = await setUp();
    await api.sql("update public.memberships set last_working_day = $2 where id = $1", [
      s.olha.membershipId,
      at(s.day - 1, 9).slice(0, 10),
    ]);
    const id = await addBooking(api.sql, s.org, s.amanda, { scheduledAt: at(s.day, 10), durationMinutes: 240, status: "confirmed" });
    await expect(
      api.sql(
        `select public.update_booking_assignments_allow_clashes($1, array[$2]::uuid[], $3::jsonb, $4::jsonb)`,
        [
          s.org,
          id,
          JSON.stringify({ assigned_to: s.olha.membershipId }),
          JSON.stringify([
            { booking_id: id, membership_id: s.olha.membershipId, is_primary: true, split_index: null, split_start_offset_minutes: null, split_duration_minutes: null },
          ]),
        ],
      ),
    ).rejects.toThrow(/last working day/);
  });

  it("is safe to run the board and series change twice", async () => {
    const { readFileSync } = await import("node:fs");
    await api.db.exec(readFileSync("supabase/migrations/20261124030000_book_anyway_board_and_series.sql", "utf8"));
  });

  // The busiest write in the app: Svitlana moves visits by dragging them.
  it("the board: a drop onto a busy cleaner is refused with a key, and the same drop with it goes through", async () => {
    const s = await setUp();
    // Amanda at 3 PM with Olha: clear of Leslie's 9 to 2.
    const id = await s.amandaVisit(15, [s.olha]);
    const date = at(s.day, 10).slice(0, 10);
    const drop = (confirm?: string) =>
      s.press(s.owner, () =>
        scheduling.rescheduleBookingAction(id, s.olha.membershipId, date, "10:00", s.olha.membershipId, confirm),
      ) as Promise<unknown> as Promise<{ ok: boolean; error?: string; bookAnyway?: string }>;

    const refused = await drop();
    expect(refused.ok, api.log()).toBe(false);
    expect(refused.error).toMatch(/Olha \d+ is already booked then: Leslie Saumer/);
    expect(refused.error).toContain("press Book anyway");
    expect(refused.bookAnyway).toBe(`${s.olha.membershipId}:${s.busy}`);
    expect((await s.visit(id)).at, "the visit stayed put").toBe(`${date}T15:00`);

    // A key for some other clash moves nothing.
    const wrong = await drop(`${s.vira.membershipId}:${s.busy}`);
    expect(wrong.ok).toBe(false);
    expect((await s.visit(id)).at).toBe(`${date}T15:00`);

    const moved = await drop(refused.bookAnyway);
    expect(moved, api.log()).toMatchObject({ ok: true });
    expect(await s.visit(id)).toMatchObject({ at: `${date}T10:00`, crew: [s.olha.membershipId] });
    const [audit] = await api.sql<{ after: { via: string } }>(
      "select after from public.audit_log where entity_id = $1 and organization_id = $2",
      [id, s.org],
    );
    expect(audit.after.via).toBe("book_anyway_board");
  });

  // Dragging was for owners and admins until 2026-11-23.
  it("the board: a manager can drag, and keep a double-booking; a cleaner can do neither", async () => {
    const s = await setUp();
    const id = await s.amandaVisit(15, [s.olha]);
    const date = at(s.day, 10).slice(0, 10);
    const drop = (as: Member, time: string, confirm?: string) =>
      s.press(as, () =>
        scheduling.rescheduleBookingAction(id, s.olha.membershipId, date, time, s.olha.membershipId, confirm),
      ) as Promise<unknown> as Promise<{ ok: boolean; error?: string; bookAnyway?: string }>;

    const cleaner = await drop(s.vira, "16:00");
    expect(cleaner).toMatchObject({ ok: false, error: "Only owners, admins and managers can reschedule" });
    expect((await s.visit(id)).at).toBe(`${date}T15:00`);

    // A free slot: it just moves.
    expect(await drop(s.manager, "16:00"), api.log()).toMatchObject({ ok: true });
    expect((await s.visit(id)).at).toBe(`${date}T16:00`);

    // Onto Leslie's 9 to 2: refused with the key, then kept.
    const refused = await drop(s.manager, "10:00");
    expect(refused.ok).toBe(false);
    expect(refused.bookAnyway).toBe(`${s.olha.membershipId}:${s.busy}`);
    expect(await drop(s.manager, "10:00", refused.bookAnyway), api.log()).toMatchObject({ ok: true });
    expect((await s.visit(id)).at).toBe(`${date}T10:00`);
  });

  it("the board: a drop onto a cleaner past her last working day says so, and offers no Book anyway", async () => {
    const s = await setUp();
    await api.sql("update public.memberships set last_working_day = $2 where id = $1", [
      s.olha.membershipId,
      at(s.day - 1, 9).slice(0, 10),
    ]);
    const id = await s.amandaVisit(15);
    const res = (await s.press(s.owner, () =>
      scheduling.rescheduleBookingAction(id, s.olha.membershipId, at(s.day, 10).slice(0, 10), "16:00", null),
    )) as unknown as { ok: boolean; error?: string; bookAnyway?: string };
    expect(res.ok).toBe(false);
    expect(res.error, api.log()).toMatch(/last working day is /);
    expect(res.error).not.toMatch(/already booked/);
    expect(res.bookAnyway).toBeUndefined();
    expect((await s.visit(id)).crew).toEqual([]);
  });

  // Where a "Needs cover" visit sends the office to pick someone.
  it("the Change crew pop-up: refused with a key, saved with it, for a manager as for an owner", async () => {
    const s = await setUp();
    const id = await s.amandaVisit(10);
    const assign = (as: Member, extra: Record<string, string> = {}) => {
      const form = new FormData();
      form.set("id", id);
      form.set("primary_id", s.olha.membershipId);
      for (const [k, v] of Object.entries(extra)) form.set(k, v);
      return s.press(as, () => bookings.assignBookingCrewAction({}, form)) as Promise<unknown> as Promise<{
        ok?: boolean;
        error?: string;
        confirmOverlap?: string;
      }>;
    };

    const asManager = await assign(s.manager);
    expect(asManager.error, api.log()).toContain("press Book anyway");
    expect(asManager.confirmOverlap).toBe(`${s.olha.membershipId}:${s.busy}`);
    expect((await s.visit(id)).crew).toEqual([]);

    const refused = await assign(s.owner);
    expect(refused.error, api.log()).toContain("press Book anyway");
    expect(refused.confirmOverlap).toBe(`${s.olha.membershipId}:${s.busy}`);
    expect((await s.visit(id)).crew).toEqual([]);

    // A cleaner cannot assign crew at all, key or no key.
    const cleaner = await assign(s.vira, { confirm_overlap: refused.confirmOverlap! });
    expect(cleaner.error).toMatch(/Only owners, admins, or managers/);
    expect((await s.visit(id)).crew).toEqual([]);

    const saved = await assign(s.manager, { confirm_overlap: refused.confirmOverlap! });
    expect(saved, api.log()).toMatchObject({ ok: true });
    expect(await s.visit(id)).toMatchObject({ lead: s.olha.membershipId, crew: [s.olha.membershipId] });
  });

  // Svitlana's own case: Olha on a series, busy on some of its dates. The
  // save leaves her off those and marks them; she wanted her kept on.
  it("a series save that left someone off: Put them on anyway puts her on those visits and clears the mark", async () => {
    const s = await setUp();
    const [series] = await api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes)
       values ($1, $2, 'bi_weekly', '10:00', current_date, 240) returning id`,
      [s.org, s.amanda],
    );
    // Three visits; Olha is on Leslie's job during the first.
    const visits: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await s.amandaVisit(10, [], s.day + i * 14);
      await api.sql("update public.bookings set series_id = $2 where id = $1", [id, series.id]);
      visits.push(id);
    }
    const form = new FormData();
    form.set("id", visits[0]);
    form.set("primary_id", s.olha.membershipId);
    form.set("update_scope", "this_and_future");
    form.set("series_id", series.id);
    form.set("series_scheduled_at", at(s.day, 10));
    const saved = (await s.press(s.owner, () => bookings.assignBookingCrewAction({}, form))) as unknown as {
      ok?: boolean;
      notice?: string;
      noticeBookingIds?: string[];
    };
    expect(saved.ok, api.log()).toBe(true);
    expect(saved.notice).toMatch(/is on another job on 1 of the 3 visits/);
    expect(saved.noticeBookingIds).toEqual([visits[0]]);
    expect(await s.visit(visits[0])).toMatchObject({ crew: [], lead: null });
    expect(await s.visit(visits[1])).toMatchObject({ crew: [s.olha.membershipId] });

    // Not a cleaner's to press, even for herself.
    const asCleaner = await s.press(s.olha, () => bookings.putLeftOffCrewOnAction({ seriesId: series.id }));
    expect(asCleaner).toMatchObject({ ok: false });
    expect((await s.visit(visits[0])).crew).toEqual([]);

    const put = await s.press(s.manager, () => bookings.putLeftOffCrewOnAction({ seriesId: series.id }));
    expect(put, api.log()).toMatchObject({ ok: true, people: 1, visits: 1 });
    expect(await s.visit(visits[0])).toMatchObject({ crew: [s.olha.membershipId], lead: s.olha.membershipId, cover: null });

    // Nothing left to do: pressing again says so and changes nothing.
    const again = await s.press(s.owner, () => bookings.putLeftOffCrewOnAction({ seriesId: series.id }));
    expect(again).toMatchObject({ ok: false });

    // And the visit can be moved afterwards like any other.
    const moved = await s.press(s.owner, () =>
      scheduling.rescheduleBookingAction(visits[0], s.olha.membershipId, at(s.day, 10).slice(0, 10), "15:00", s.olha.membershipId),
    );
    expect(moved, api.log()).toMatchObject({ ok: true });
  });

  it("Put them on anyway keeps the lead, joins a crew, and leaves a finished cleaner off and marked", async () => {
    const s = await setUp();
    const anna = await addMember(api.sql, s.org, "employee", "Anna");
    // Anna leads Amanda's visit; Olha was left off for Leslie's job, Vira
    // because it is after her last working day.
    const id = await s.amandaVisit(10, [anna]);
    await api.sql("update public.memberships set last_working_day = $2 where id = $1", [
      s.vira.membershipId,
      at(s.day - 1, 9).slice(0, 10),
    ]);
    const marks = [
      { membership_id: s.olha.membershipId, other_booking_id: s.busy },
      { membership_id: s.vira.membershipId, other_booking_id: id },
    ];
    await api.sql("update public.bookings set cover_needed = $2::jsonb where id = $1", [id, JSON.stringify(marks)]);

    const put = await s.press(s.owner, () => bookings.putLeftOffCrewOnAction({ bookingIds: [id] }));
    expect(put, api.log()).toMatchObject({ ok: true, people: 1, visits: 1 });
    expect(await s.visit(id)).toMatchObject({
      lead: anna.membershipId,
      crew: [anna.membershipId, s.olha.membershipId].sort(),
      cover: [marks[1]],
    });
  });

  it("bringing a cancelled visit back: refused with a key, kept with it, and never past a last working day", async () => {
    const s = await setUp();
    // Amanda's visit was cancelled; since then Olha was put on Leslie's job
    // at the same time.
    const id = await addBooking(api.sql, s.org, s.amanda, { scheduledAt: at(s.day, 10), durationMinutes: 240, status: "cancelled" });
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, true)",
      [s.org, id, s.olha.membershipId],
    );
    await api.sql("update public.bookings set assigned_to = $2 where id = $1", [id, s.olha.membershipId]);
    const status = async () => (await api.sql<{ status: string }>("select status from public.bookings where id = $1", [id]))[0].status;
    const bringBack = (as: Member, key?: string) => {
      const f = new FormData();
      f.set("id", id);
      f.set("status", "confirmed");
      if (key) f.set("confirm_overlap", key);
      return s.press(as, () => bookings.setBookingStatusAction(f)) as unknown as Promise<{
        ok: boolean;
        error?: string;
        bookAnyway?: string;
      }>;
    };

    const refused = await bringBack(s.owner);
    expect(refused.ok, api.log()).toBe(false);
    expect(refused.error).toMatch(/Olha/);
    expect(refused.error).toMatch(/Leslie Saumer/);
    expect(refused.bookAnyway).toBeTruthy();
    expect(await status()).toBe("cancelled");

    // A key for other clashes is not a yes for these.
    const wrong = await bringBack(s.owner, "not-the-key");
    expect(wrong.ok).toBe(false);
    expect(await status()).toBe("cancelled");

    // A manager may keep the overlap, as on every other Book anyway.
    const kept = await bringBack(s.manager, refused.bookAnyway);
    expect(kept, api.log()).toMatchObject({ ok: true });
    expect(await status()).toBe("confirmed");
    expect(await s.visit(id)).toMatchObject({ lead: s.olha.membershipId, crew: [s.olha.membershipId] });
    const audit = await api.sql<{ after: { via?: string } | null }>(
      "select after from public.audit_log where entity_id = $1 and organization_id = $2",
      [id, s.org],
    );
    expect(audit.some((a) => a.after?.via === "book_anyway_status")).toBe(true);

    // Cancelled again, and Olha has since finished: the key does not get
    // her back on a visit after her last day.
    await api.sql("update public.bookings set status = 'cancelled' where id = $1", [id]);
    await api.sql("update public.memberships set last_working_day = $2 where id = $1", [
      s.olha.membershipId,
      at(s.day - 1, 9).slice(0, 10),
    ]);
    const finished = await bringBack(s.owner, refused.bookAnyway);
    expect(finished.ok).toBe(false);
    expect(await status()).toBe("cancelled");
  });

  it("Make recurring: the whole crew comes along, and a busy date leaves them off that visit instead of refusing", async () => {
    const s = await setUp();
    // Amanda's one-off visit, two weeks before Leslie's job, Olha and Vira
    // on it. Made weekly, its third visit lands on Leslie's day.
    const source = await s.amandaVisit(10, [s.olha, s.vira], s.day - 14);
    const f = new FormData();
    f.set("pattern", "weekly");
    const made = (await s.press(s.owner, () => bookings.convertBookingToRecurringAction(source, f))) as unknown as {
      ok: boolean;
      error?: string;
      coverSeriesId?: string;
    };
    expect(made.ok, `${made.error ?? ""} ${api.log()}`).toBe(true);
    expect(made.coverSeriesId).toBeTruthy();

    const [series] = await api.sql<{ id: string; crew: Array<{ membership_id: string }> | null }>(
      "select id, crew from public.booking_series where id = $1",
      [made.coverSeriesId],
    );
    expect((series.crew ?? []).map((m) => m.membership_id).sort()).toEqual(
      [s.olha.membershipId, s.vira.membershipId].sort(),
    );

    const visits = await api.sql<{ id: string; at: string; lead: string | null; crew: string[]; cover: unknown[] | null }>(
      `select b.id, b.scheduled_at::text as at, b.assigned_to as lead, b.cover_needed as cover,
              coalesce((select array_agg(ba.membership_id order by ba.membership_id) from public.booking_assignees ba where ba.booking_id = b.id), '{}') as crew
         from public.bookings b where b.series_id = $1 and b.id <> $2 order by b.scheduled_at`,
      [series.id, source],
    );
    expect(visits.length).toBeGreaterThanOrEqual(3);
    const both = [s.olha.membershipId, s.vira.membershipId].sort();
    // The visit on Leslie's day has nobody and says who it is waiting for.
    const clashing = visits.filter((v) => (v.cover ?? []).length > 0);
    expect(clashing).toHaveLength(1);
    expect(clashing[0]).toMatchObject({ crew: [], lead: null });
    expect(clashing[0].cover).toHaveLength(2);
    // Every other new visit has both of them, not the lead alone.
    for (const v of visits.filter((x) => x.id !== clashing[0].id)) {
      expect(v.crew).toEqual(both);
      expect(v.lead).toBe(s.olha.membershipId);
    }

    // And the office can still put them on that one, double-booked.
    const put = await s.press(s.owner, () => bookings.putLeftOffCrewOnAction({ seriesId: series.id }));
    expect(put, api.log()).toMatchObject({ ok: true, people: 2, visits: 1 });
    expect((await s.visit(clashing[0].id)).crew).toEqual(both);
  });

  it("Make recurring with nobody busy answers plainly, and a one-person visit stays one person", async () => {
    const s = await setUp();
    const anna = await addMember(api.sql, s.org, "employee", "Anna");
    const source = await s.amandaVisit(10, [anna], s.day - 14);
    const f = new FormData();
    f.set("pattern", "bi_weekly");
    const made = (await s.press(s.owner, () => bookings.convertBookingToRecurringAction(source, f))) as unknown as {
      ok: boolean;
      coverSeriesId?: string;
    };
    expect(made, api.log()).toEqual({ ok: true });
    const crews = await api.sql<{ crew: string[] }>(
      `select coalesce((select array_agg(ba.membership_id) from public.booking_assignees ba where ba.booking_id = b.id), '{}') as crew
         from public.bookings b where b.client_id = $1 and b.id <> $2`,
      [s.amanda, source],
    );
    expect(crews.length).toBeGreaterThanOrEqual(3);
    for (const c of crews) expect(c.crew).toEqual([anna.membershipId]);
  });
});

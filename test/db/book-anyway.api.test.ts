/**
 * "Book anyway" (migration 20261124020000).
 *
 * Svitlana, 2026-11-23: she wanted to put Olha and Vira on a visit that
 * overlapped a job they were already on and move one of them later. Every
 * save was refused, so the visit could not go down at all. Now an owner or
 * admin is refused once, with the names, and a Book anyway press keeps the
 * overlap.
 *
 * The real actions against the real stack (test/db/api.ts): the refusal
 * carries a key and saves nothing; the press saves, writes an audit entry,
 * and the visit's page can name the overlap; a changed save asks again; a
 * manager is refused as before; and a last working day is still a hard stop.
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
  return { org, owner, manager, olha, vira, busy, amanda, day, formFor, press, amandaVisits };
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

  it("a manager is refused as before, with no Book anyway", async () => {
    const s = await setUp();
    const first = asked(await s.press(s.manager, () => bookings.createBookingAction({}, s.formFor([s.olha]))));
    expect(first.errors?._form).toMatch(/move that job first\.$/);
    expect(first.errors?._form).not.toContain("Book anyway");
    expect(first.values?.confirm_overlap).toBeUndefined();

    // A key typed in by hand changes nothing.
    const forged = `${s.olha.membershipId}:${s.busy}`;
    const again = asked(
      await s.press(s.manager, () => bookings.createBookingAction({}, s.formFor([s.olha], { confirm_overlap: forged }))),
    );
    expect(again.errors?._form).toMatch(/already booked then/);
    expect(await s.amandaVisits()).toEqual([]);
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
});

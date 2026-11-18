/**
 * Changing the schedule, through the app's own actions, against a real
 * database behind the real PostgREST: the calendar drag (rescheduleBooking,
 * Svit's busiest way to move a job), skipping one visit of a series, and
 * deleting a job.
 *
 * What each owes the schedule and the books: a dragged job keeps its time
 * of day and its crew unless the drop says otherwise; dragging a team job
 * by the second cleaner's card does not throw the lead off; a drop onto a
 * time the cleaner is busy is refused in words; a skipped visit leaves the
 * series standing; a billed job is never deleted.
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
let scheduling: typeof import("@/app/app/scheduling/actions");
let bookings: typeof import("@/app/app/bookings/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  scheduling = await import("@/app/app/scheduling/actions");
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

type Company = { org: string; client: string; owner: Member; anna: Member; bea: Member };

async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Schedule Co");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  return {
    org,
    client: await addClient(api.sql, org),
    owner: await addMember(api.sql, org, "owner", "Owner"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    bea: await addMember(api.sql, org, "employee", "Bea"),
  };
}

const ymdIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const at = (days: number, hhmm: string) => `${ymdIn(days)}T${hhmm}:00.000Z`;

async function jobWith(c: Company, when: string, crew: Member[], minutes = 120): Promise<string> {
  const id = await addBooking(api.sql, c.org, c.client, { scheduledAt: when, durationMinutes: minutes, status: "confirmed" });
  for (const [i, m] of crew.entries()) {
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status) values ($1, $2, $3, $4, 'accepted')",
      [c.org, id, m.membershipId, i === 0],
    );
  }
  if (crew[0]) await api.sql("update public.bookings set assigned_to = $2 where id = $1", [id, crew[0].membershipId]);
  return id;
}

async function asOwner<T>(c: Company, work: () => Promise<T>): Promise<T | string> {
  request.cookies = api.sessionCookies(c.owner.userId);
  try {
    return await work();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("redirected to ")) return message;
    throw err;
  } finally {
    await settle();
  }
}

const jobRow = async (id: string) =>
  (
    await api.sql<{ at: string; status: string; lead: string | null; crew: string[] }>(
      `select to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as at, status::text as status, assigned_to as lead,
              coalesce((select array_agg(membership_id::text order by membership_id) from public.booking_assignees a where a.booking_id = b.id), '{}') as crew
         from public.bookings b where b.id = $1`,
      [id],
    )
  )[0];

describe.skipIf(!hasPostgrest)("changing the schedule, through the app's own actions", () => {
  it("dragged to another day: same time of day, same cleaner", async () => {
    const c = await company();
    const id = await jobWith(c, at(3, "09:30"), [c.anna]);
    const res = await asOwner(c, () => scheduling.rescheduleBookingAction(id, c.anna.membershipId, ymdIn(5), undefined, c.anna.membershipId));
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
    expect(await jobRow(id)).toMatchObject({ at: `${ymdIn(5)}T09:30`, lead: c.anna.membershipId, crew: [c.anna.membershipId] });
  });

  it("dragged into another cleaner's lane: the job goes to her", async () => {
    const c = await company();
    const id = await jobWith(c, at(3, "09:30"), [c.anna]);
    await asOwner(c, () => scheduling.rescheduleBookingAction(id, c.bea.membershipId, ymdIn(3), undefined, c.anna.membershipId));
    expect(await jobRow(id)).toMatchObject({ lead: c.bea.membershipId, crew: [c.bea.membershipId] });
  });

  it("a team job dragged by the second cleaner's card to another day: both stay on it", async () => {
    const c = await company();
    const id = await jobWith(c, at(3, "09:30"), [c.anna, c.bea], 240);
    await asOwner(c, () => scheduling.rescheduleBookingAction(id, c.bea.membershipId, ymdIn(4), undefined, c.bea.membershipId));
    const row = await jobRow(id);
    expect(row.at).toBe(`${ymdIn(4)}T09:30`);
    expect(row.crew).toEqual([c.anna.membershipId, c.bea.membershipId].sort());
  });

  it("dropped onto a time the cleaner is already working: refused in words, the job stays put", async () => {
    const c = await company();
    await jobWith(c, at(5, "09:30"), [c.anna]);
    const id = await jobWith(c, at(3, "09:30"), [c.anna]);
    const res = await asOwner(c, () => scheduling.rescheduleBookingAction(id, c.anna.membershipId, ymdIn(5), undefined, c.anna.membershipId));
    expect(res).toMatchObject({ ok: false });
    expect(String((res as { error?: string }).error ?? "")).toMatch(/booked|overlap/i);
    expect((await jobRow(id)).at).toBe(`${ymdIn(3)}T09:30`);
  });

  it("one visit of a series skipped: that visit is gone, the series and its other visits stay", async () => {
    const c = await company();
    const [series] = await api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes, assigned_to)
       values ($1, $2, 'weekly', '09:00', current_date, 120, $3) returning id`,
      [c.org, c.client, c.anna.membershipId],
    );
    const first = await jobWith(c, at(7, "09:00"), [c.anna]);
    const second = await jobWith(c, at(14, "09:00"), [c.anna]);
    await api.sql("update public.bookings set series_id = $2 where id = any($1::uuid[])", [[first, second], series.id]);
    const skip = new FormData();
    skip.set("id", first);
    await asOwner(c, () => bookings.skipBookingOccurrenceAction(skip));
    const left = await api.sql<{ id: string }>("select id from public.bookings where series_id = $1 and status <> 'cancelled'", [series.id]);
    expect(left.map((r) => r.id)).toEqual([second]);
    const [s] = await api.sql<{ active: boolean }>("select active from public.booking_series where id = $1", [series.id]);
    expect(s.active).toBe(true);
  });

  it("a job deleted; a billed one is refused and stays", async () => {
    const c = await company();
    const loose = await jobWith(c, at(3, "09:30"), [c.anna]);
    const f1 = new FormData();
    f1.set("id", loose);
    await asOwner(c, () => bookings.deleteBookingAction(f1));
    expect(await jobRow(loose)).toBeUndefined();

    const billed = await addBooking(api.sql, c.org, c.client, { scheduledAt: at(-3, "09:30"), status: "completed" });
    const [inv] = await api.sql<{ id: string }>(
      "insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents) values ($1, $2, $3, 'sent', 14000) returning id",
      [c.org, c.client, billed],
    );
    await api.sql("update public.bookings set billing_invoice_id = $2 where id = $1", [billed, inv.id]);
    const f2 = new FormData();
    f2.set("id", billed);
    // Refused in place: the answer comes back to the page (no redirect, so
    // it doesn't reload at the top), with the invoice to deal with first.
    const res = (await asOwner(c, () => bookings.deleteBookingAction(f2))) as { ok: false; error: string; link?: { href: string; label: string } };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/bills this job/);
    expect(res.link?.href).toBe(`/app/invoices/${inv.id}`);
    expect(await jobRow(billed)).toBeTruthy();

    // Skip is for upcoming dates: a past occurrence is refused in words, and stays.
    const [oldSeries] = await api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes, service_type)
       values ($1, $2, 'weekly', '09:00', current_date - 30, 120, 'standard') returning id`,
      [c.org, c.client],
    );
    const past = await addBooking(api.sql, c.org, c.client, { scheduledAt: at(-5, "09:00"), status: "confirmed" });
    await api.sql("update public.bookings set series_id = $2 where id = $1", [past, oldSeries.id]);
    const f3 = new FormData();
    f3.set("id", past);
    const skipped = (await asOwner(c, () => bookings.skipBookingOccurrenceAction(f3))) as { ok: false; error: string };
    expect(skipped.ok).toBe(false);
    expect(skipped.error).toMatch(/already happened/);
    expect(await jobRow(past)).toBeTruthy();
  });
});

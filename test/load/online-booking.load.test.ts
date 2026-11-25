/**
 * Many visitors taking the same time at once, on a company's booking page
 * (roadmap phase 3).
 *
 * The page lists a time as open to everyone looking at it. What matters is
 * what happens when several of them press at the same instant: never more
 * visits than there are free cleaners, and nothing half-made left behind
 * for the losers.
 *
 * Since 2026-11-25 nobody is put on an online booking (the office chooses
 * who), so the database's double-booking guard isn't what decides: each
 * unstaffed visit holds a person's time, and of a crowd pressing for the
 * last free person, the one booked first keeps it (lib/online-booking.ts).
 *
 * Needs a real server: on PGlite each query waits for the one before, so
 * "at once" never happens.
 *
 *   pnpm test:load
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "../db/api";
import { addClient, type Member } from "../db/harness";
import { hasRealPostgres } from "../db/real-postgres";
import { company, people, pct } from "./helpers";

vi.mock("next/headers", async () => (await import("../db/next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("../db/next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("../db/next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("../db/next-stubs")).nextServer(),
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  isEmailConfigured: () => true,
  sendEmail: async () => true,
  sendOrgEmail: async () => true,
  sendOrgEmailDetailed: async () => ({ ok: true }),
}));
vi.mock("@/lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/push")>()),
  sendPushToMembership: async () => 1,
}));

const ready = hasPostgrest && hasRealPostgres;
let api: Api;
let restoreEnv: () => void;
let online: typeof import("@/lib/online-booking");

beforeAll(async () => {
  if (!ready) return;
  api = await startApi();
  if (api.kind !== "postgres") throw new Error("the load tests must run on a real server (pnpm test:load)");
  restoreEnv = api.useAsSupabase();
  online = await import("@/lib/online-booking");
});

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

/** A day `n` days out (the load companies keep UTC). */
const dayOut = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const at = (ymd: string, hhmm: string) => Date.parse(`${ymd}T${hhmm}:00Z`);

/** A company open every day nine to five, hourly starts, with `n` cleaners taking online bookings. */
async function shop(label: string, cleaners: number, opts: { crewSize?: number; gap?: number } = {}) {
  const c = await company(api, label);
  const crew = await people(api, c.org, cleaners, "Cleaner");
  await api.sql("update public.memberships set takes_online_bookings = true where id = any($1::uuid[])", [crew.map((m) => m.membershipId)]);
  const [{ id: service }] = await api.sql<{ id: string }>(
    "insert into public.service_types (organization_id, name, default_duration_minutes, default_price_cents, show_on_booking_page, online_crew_size) values ($1, 'Standard clean', 120, 15000, true, $2) returning id",
    [c.org, opts.crewSize ?? 1],
  );
  const hours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: "09:00", end: "17:00" }]]));
  await api.sql(
    "insert into public.booking_pages (organization_id, slug, status, time_booking, opening_hours, slot_step_minutes, gap_minutes) values ($1, $2, 'published', 'instant', $3::jsonb, 60, $4)",
    [c.org, `race-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, JSON.stringify(hours), opts.gap ?? 0],
  );
  return { ...c, crew, service };
}

/** `n` different visitors, each already on the books, pressing the same start at once. */
async function rush(s: Awaited<ReturnType<typeof shop>>, n: number, startMs: number) {
  const clients: string[] = [];
  for (let i = 0; i < n; i++) clients.push(await addClient(api.sql, s.org, `Visitor ${i + 1}`));
  const ms: number[] = [];
  const t0 = performance.now();
  const results = await Promise.all(
    clients.map(async (id, i) => {
      const t = performance.now();
      const res = await online.bookTimeOnline({
        organizationId: s.org,
        mode: "instant",
        serviceId: s.service,
        startMs,
        client: { id, name: `Visitor ${i + 1}` },
        address: `${i + 1} Race Road`,
        note: "",
      });
      ms.push(performance.now() - t);
      return res;
    }),
  );
  ms.sort((a, b) => a - b);
  console.log(`  ${n} at once: ${Math.round(performance.now() - t0)}ms in all; each p50 ${Math.round(pct(ms, 50))}ms, slowest ${Math.round(ms[ms.length - 1])}ms`);
  return results;
}
const booked = (s: { org: string }) =>
  api.sql<{ id: string; lead: string | null; crew: number }>(
    `select b.id, b.assigned_to as lead, (select count(*)::int from public.booking_assignees a where a.booking_id = b.id) as crew
       from public.bookings b where b.organization_id = $1 order by b.created_at`,
    [s.org],
  );
/** Pairs of the company's visits whose times overlap. */
const overlaps = (s: { org: string }) =>
  api.sql<{ n: number }>(
    `select count(*)::int as n
       from public.bookings bx
       join public.bookings by on by.organization_id = bx.organization_id and by.id > bx.id
      where bx.organization_id = $1 and bx.status <> 'cancelled' and by.status <> 'cancelled'
        and bx.scheduled_at < by.scheduled_at + make_interval(mins => by.duration_minutes)
        and by.scheduled_at < bx.scheduled_at + make_interval(mins => bx.duration_minutes)`,
    [s.org],
  );

describe.skipIf(!ready)("visitors taking the same time at once, on a real server", () => {
  it("one cleaner, twelve visitors, one time: exactly one visit, and eleven are told it went", async () => {
    const s = await shop("One Cleaner", 1);
    const results = await rush(s, 12, at(dayOut(3), "10:00"));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.taken)).toHaveLength(11);
    const rows = await booked(s);
    expect(rows, "nothing half-made left behind").toHaveLength(1);
    expect(rows[0], "left for the office to staff").toMatchObject({ lead: null, crew: 0 });
  });

  it("three cleaners, twelve visitors, one time: no more than three visits", async () => {
    const s = await shop("Three Cleaners", 3);
    const results = await rush(s, 12, at(dayOut(3), "10:00"));
    const rows = await booked(s);
    expect(rows.every((r) => !r.lead && r.crew === 0), "all left for the office").toBe(true);
    expect(rows.length).toBe(results.filter((r) => r.ok).length);
    // Every cleaner should end up with one. Fewer means a visitor was told
    // "taken" while someone was still free: allowed (they are shown the
    // time still open and can press again), but worth seeing.
    console.log(`  ${rows.length} of 3 cleaners booked`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(3);
  });

  it("a job for two, four cleaners, ten visitors: at most two visits", async () => {
    const s = await shop("Pairs", 4, { crewSize: 2 });
    const results = await rush(s, 10, at(dayOut(3), "13:00"));
    const rows = await booked(s);
    expect(rows.length).toBe(results.filter((r) => r.ok).length);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(2);
  });

  it("neighbouring times, one cleaner, all at once: no two visits overlap", async () => {
    const s = await shop("Neighbours", 1);
    const day = dayOut(4);
    const clients: string[] = [];
    for (let i = 0; i < 7; i++) clients.push(await addClient(api.sql, s.org, `Neighbour ${i + 1}`));
    // 9, 10, 11 ... 15: each two hours long, so every one overlaps the next.
    await Promise.all(
      clients.map((id, i) =>
        online.bookTimeOnline({ organizationId: s.org, mode: "instant", serviceId: s.service, startMs: at(day, `${String(9 + i).padStart(2, "0")}:00`), client: { id, name: `N${i}` }, address: "1 Road", note: "" }),
      ),
    );
    expect((await overlaps(s))[0].n, "one cleaner can't be at two of them").toBe(0);
    const rows = await booked(s);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(4); // 9, 11, 13, 15 at the very most
  });
});

export type { Member };

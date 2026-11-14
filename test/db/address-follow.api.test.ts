/**
 * Changing a client's address changes the visits already booked
 * (2026-11-14).
 *
 * Svitlana changed Hilda Daubner's address on the client. The client
 * record took it; the visit booked for the following Tuesday kept its own
 * copy of the old address, which is what the crew's phones show, so they
 * would have driven to the wrong home. 51 visits for another client whose
 * address changed the same day were the same. A crew sent to the wrong
 * address is paid for a job nobody did.
 *
 * The real client save against the real stack (test/db/api.ts).
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
let clients: typeof import("@/app/app/clients/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  clients = await import("@/app/app/clients/actions");
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
const OLD = "13825 155 Avenue NW, Edmonton, AB";
const NEW = "6315 135 Avenue NW, Edmonton, AB";

type Setup = { org: string; manager: Member; client: string };

async function setup(address: string | null = OLD): Promise<Setup> {
  const org = await addOrg(api.sql, "Company");
  const manager = await addMember(api.sql, org, "manager", "Manager");
  const [client] = await api.sql<{ id: string }>(
    "insert into public.clients (organization_id, name, address) values ($1, 'Hilda Daubner', $2) returning id",
    [org, address],
  );
  return { org, manager, client: client.id };
}

async function visit(
  s: Setup,
  opts: { inDays: number; address: string | null; status?: string; property?: string | null },
): Promise<string> {
  const id = await addBooking(api.sql, s.org, s.client, {
    scheduledAt: new Date(Date.now() + opts.inDays * DAY).toISOString(),
    durationMinutes: 120,
    status: opts.status ?? "confirmed",
  });
  await api.sql("update public.bookings set address = $2, property_id = $3 where id = $1", [
    id,
    opts.address,
    opts.property ?? null,
  ]);
  return id;
}

const addressOf = async (id: string) =>
  (await api.sql<{ address: string | null }>("select address from public.bookings where id = $1", [id]))[0].address;

/** Save the client with a new address, as the edit form does. Returns where the save sent the browser. */
async function saveClient(s: Setup, address: string): Promise<string> {
  request.cookies = api.sessionCookies(s.manager.userId);
  try {
    const form = new FormData();
    form.set("name", "Hilda Daubner");
    form.set("address", address);
    const res = await clients.updateClientAction(s.client, {}, form);
    return `returned ${JSON.stringify(res)}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  } finally {
    await settle();
  }
}

describe.skipIf(!hasPostgrest)("a client's new address reaches the visits already booked", () => {
  it("upcoming visits at the old address move; the save says how many", async () => {
    const s = await setup();
    const tuesday = await visit(s, { inDays: 3, address: OLD });
    const later = await visit(s, { inDays: 17, address: OLD, status: "pending" });

    const landed = await saveClient(s, NEW);
    expect(landed).toContain("redirected to /app/clients?");
    expect(landed).toContain("moved=2");
    expect(landed).toContain("kept=0");
    expect(await addressOf(tuesday)).toBe(NEW);
    expect(await addressOf(later)).toBe(NEW);
  });

  it("the old address written another way is still the old address", async () => {
    const s = await setup();
    // Typed by hand on the booking months ago; the client's was picked from
    // address search. Same home.
    const v = await visit(s, { inDays: 5, address: "13825 155 Ave NW" });
    await saveClient(s, NEW);
    expect(await addressOf(v)).toBe(NEW);
  });

  it("what has happened, or was typed differently on purpose, is left alone", async () => {
    const s = await setup();
    const done = await visit(s, { inDays: -7, address: OLD, status: "completed" });
    const cancelled = await visit(s, { inDays: 4, address: OLD, status: "cancelled" });
    const underway = await visit(s, { inDays: 0.01, address: OLD, status: "in_progress" });
    const elsewhere = await visit(s, { inDays: 6, address: "22 Lakeside Cottage Rd, Seba Beach" });
    const blank = await visit(s, { inDays: 8, address: null });

    const landed = await saveClient(s, NEW);
    // Where the work was done stays where it was done.
    expect(await addressOf(done)).toBe(OLD);
    expect(await addressOf(cancelled)).toBe(OLD);
    expect(await addressOf(underway)).toBe(OLD);
    // A different address typed on one visit is somebody's decision.
    expect(await addressOf(elsewhere)).toBe("22 Lakeside Cottage Rd, Seba Beach");
    expect(landed).toContain("kept=1");
    expect(landed).toContain("moved=0");
    // No address of its own: it reads the client's live, and still does.
    expect(await addressOf(blank)).toBeNull();
  });

  it("the recurring series moves too, so new visits come out at the new address", async () => {
    const s = await setup();
    const [series] = await api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes, address)
       values ($1, $2, 'bi_weekly', '09:00', current_date, 120, $3) returning id`,
      [s.org, s.client, OLD],
    );
    await saveClient(s, NEW);
    const [row] = await api.sql<{ address: string | null }>("select address from public.booking_series where id = $1", [series.id]);
    expect(row.address).toBe(NEW);
  });

  it("another client's visits at the same old address are not touched", async () => {
    const s = await setup();
    const [other] = await api.sql<{ id: string }>(
      "insert into public.clients (organization_id, name, address) values ($1, 'Neighbour', $2) returning id",
      [s.org, OLD],
    );
    const theirs = await addBooking(api.sql, s.org, other.id, {
      scheduledAt: new Date(Date.now() + 3 * DAY).toISOString(),
      durationMinutes: 120,
    });
    await api.sql("update public.bookings set address = $2 where id = $1", [theirs, OLD]);

    await saveClient(s, NEW);
    expect(await addressOf(theirs)).toBe(OLD);
  });

  it("a save that does not change the address moves nothing and says nothing", async () => {
    const s = await setup();
    const v = await visit(s, { inDays: 3, address: "13825 155 Ave NW" });
    const landed = await saveClient(s, OLD);
    expect(landed).toBe("redirected to /app/clients");
    expect(await addressOf(v)).toBe("13825 155 Ave NW");
  });
});

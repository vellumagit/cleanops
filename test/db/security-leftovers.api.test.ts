/**
 * Security audit leftovers, closed 2026-11-11.
 *
 *   - an API key kept working for a suspended company
 *   - the public API answered with the database's own error text
 *   - estimate PDFs sat in a public bucket (the bucket half; the link half is
 *     src/lib/estimate-pdf-storage.test.ts)
 *
 * Real routes against the real stack (test/db/api.ts).
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addCrew, addMember, addOrg } from "./harness";
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

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

async function apiKey(org: string): Promise<string> {
  const { generateApiKey } = await import("@/lib/api-keys");
  const { rawKey, keyHash, keyPrefix } = generateApiKey();
  await api.sql(
    "insert into public.api_keys (organization_id, label, key_hash, key_prefix) values ($1, 'Zapier', $2, $3)",
    [org, keyHash, keyPrefix],
  );
  return rawKey;
}

const call = (key: string, path: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

describe.skipIf(!hasPostgrest)("security audit leftovers", { timeout: 90_000 }, () => {
  it("an API key stops working while its company is suspended, and works again after", async () => {
    const { GET } = await import("@/app/api/v1/clients/route");
    const org = await addOrg(api.sql, "Company");
    const key = await apiKey(org);

    expect((await GET(call(key, "/api/v1/clients"))).status, api.log()).toBe(200);

    await api.sql("update public.organizations set suspended_at = now() where id = $1", [org]);
    const shut = await GET(call(key, "/api/v1/clients"));
    expect(shut.status).toBe(403);
    expect(((await shut.json()) as { error: string }).error).toContain("suspended");

    await api.sql("update public.organizations set suspended_at = null where id = $1", [org]);
    expect((await GET(call(key, "/api/v1/clients"))).status).toBe(200);
  });

  it("a refused crew assignment is explained in words, not in the database's", async () => {
    const { POST } = await import("@/app/api/v1/bookings/route");
    const org = await addOrg(api.sql, "Company");
    const client = await addClient(api.sql, org);
    const anna = await addMember(api.sql, org, "employee", "Anna");
    const at = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const first = await addBooking(api.sql, org, client, { scheduledAt: at, durationMinutes: 120 });
    await addCrew(api.sql, org, first, anna.membershipId);

    const res = await POST(
      call(await apiKey(org), "/api/v1/bookings", {
        method: "POST",
        body: { client_id: client, scheduled_at: at, duration_minutes: 60, assigned_to: anna.membershipId },
      }),
    );
    await settle();
    const body = (await res.json()) as { error: string };
    expect(res.status, api.log()).toBe(409);
    expect(body.error).toBe("That cleaner already has a booking at that time. Nothing was created.");
    expect(body.error).not.toMatch(/booking_assignees|23P01|constraint|db-error/i);
    expect(await api.sql("select id from public.bookings where organization_id = $1", [org])).toHaveLength(1);
  });

  it("estimate PDFs have a private bucket", async () => {
    const [bucket] = await api.sql<{ public: boolean; allowed_mime_types: string[] }>(
      "select public, allowed_mime_types from storage.buckets where id = 'estimate-pdfs'",
    );
    expect(bucket).toEqual({ public: false, allowed_mime_types: ["application/pdf"] });
  });
});

// A client's address corrected through the API reaches the visits already
// booked, as it does from the client's page (src/lib/address-follow.ts,
// 2026-11-14). The API was the one writer of clients.address the first fix
// did not cover.
describe.skipIf(!hasPostgrest)("PATCH /api/v1/clients/:id with a new address", () => {
  it("moves the upcoming visit, leaves the finished one, and says how many moved", async () => {
    const org = await addOrg(api.sql, "Address By Api");
    const [client] = await api.sql<{ id: string }>(
      "insert into public.clients (organization_id, name, address) values ($1, 'Hilda Daubner', '13825 155 Avenue NW') returning id",
      [org],
    );
    const day = 86_400_000;
    const upcoming = await addBooking(api.sql, org, client.id, { scheduledAt: new Date(Date.now() + 3 * day).toISOString() });
    const done = await addBooking(api.sql, org, client.id, {
      scheduledAt: new Date(Date.now() - 10 * day).toISOString(),
      status: "completed",
    });
    await api.sql("update public.bookings set address = '13825 155 Ave NW' where id = any($1::uuid[])", [[upcoming, done]]);

    const { PATCH } = await import("@/app/api/v1/clients/[id]/route");
    const res = await PATCH(
      call(await apiKey(org), `/api/v1/clients/${client.id}`, { method: "PATCH", body: { address: "6315 135 Avenue NW" } }),
      { params: Promise.resolve({ id: client.id }) },
    );
    await settle();
    expect(res.status, api.log()).toBe(200);
    expect((await res.json()).upcoming_visits_updated).toBe(1);

    const rows = await api.sql<{ id: string; address: string }>("select id, address from public.bookings where id = any($1::uuid[])", [
      [upcoming, done],
    ]);
    expect(rows.find((r) => r.id === upcoming)?.address).toBe("6315 135 Avenue NW");
    expect(rows.find((r) => r.id === done)?.address).toBe("13825 155 Ave NW");
  });

  it("a change that does not touch the address reports nothing about visits", async () => {
    const org = await addOrg(api.sql, "Phone By Api");
    const [client] = await api.sql<{ id: string }>(
      "insert into public.clients (organization_id, name, address) values ($1, 'Someone', '1 First Street') returning id",
      [org],
    );
    const { PATCH } = await import("@/app/api/v1/clients/[id]/route");
    const res = await PATCH(
      call(await apiKey(org), `/api/v1/clients/${client.id}`, { method: "PATCH", body: { phone: "780-555-0100" } }),
      { params: Promise.resolve({ id: client.id }) },
    );
    await settle();
    expect(res.status, api.log()).toBe(200);
    expect("upcoming_visits_updated" in (await res.json())).toBe(false);
  });
});

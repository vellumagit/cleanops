/**
 * A calendar connection is switched off only when it is really dead
 * (2026-11-12).
 *
 * Two connections at Svit were wrong in opposite directions:
 *   - one granted email only (calendar box unticked, June 9) sat "active" and
 *     403'd every night;
 *   - one was switched off for good by a single Google 503 on Nov 9.
 *
 * The real calendar code against the real stack; only Google's token endpoint
 * is stood in for.
 */
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addMember, addOrg } from "./harness";

let api: Api;
let restoreEnv: () => void;
const saved: Record<string, string | undefined> = {};
const ENV = {
  INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  GOOGLE_CALENDAR_CLIENT_ID: "test-client",
  GOOGLE_CALENDAR_CLIENT_SECRET: "test-secret",
};

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
}, 240_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  restoreEnv?.();
  await api?.stop();
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Google's token endpoint answers `status`; everything else goes through. */
function googleTokenEndpointSays(status: number) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      calls.push(url);
      return new Response(JSON.stringify({ error: status === 400 ? "invalid_grant" : "backend_error" }), { status });
    }
    if (url.startsWith("https://www.googleapis.com/")) {
      calls.push(url);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  return calls;
}

async function memberConnection(opts: { scope: string; expired: boolean }) {
  const { encryptSecret } = await import("@/lib/crypto");
  const org = await addOrg(api.sql, "Company");
  await addMember(api.sql, org, "owner");
  const cleaner = await addMember(api.sql, org, "employee", "Cleaner");
  const [row] = await api.sql<{ id: string }>(
    `insert into public.integration_connections
       (organization_id, membership_id, provider, status, scope, access_token_ciphertext, refresh_token_ciphertext, token_expires_at)
     values ($1, $2, 'google_calendar', 'active', $3, $4, $5, $6) returning id`,
    [
      org,
      cleaner.membershipId,
      opts.scope,
      encryptSecret("access"),
      encryptSecret("refresh"),
      new Date(Date.now() + (opts.expired ? -3600_000 : 3600_000)).toISOString(),
    ],
  );
  return { org, membershipId: cleaner.membershipId, connectionId: row.id };
}

const state = async (id: string) =>
  (await api.sql<{ status: string; last_error: string | null }>(
    "select status, last_error from public.integration_connections where id = $1",
    [id],
  ))[0];

const window = () => [new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString()] as const;

describe.skipIf(!hasPostgrest)("calendar connections", { timeout: 90_000 }, () => {
  it("a grant without calendar permission is flagged for reconnecting, once, without calling Google", async () => {
    const { listMemberManagedEvents } = await import("@/lib/google-calendar");
    const c = await memberConnection({
      scope: "openid https://www.googleapis.com/auth/userinfo.email",
      expired: false,
    });
    const calls = googleTokenEndpointSays(200);

    expect(await listMemberManagedEvents(c.membershipId, ...window())).toEqual([]);
    expect(calls).toEqual([]);
    const s = await state(c.connectionId);
    expect(s.status).toBe("error");
    expect(s.last_error).toMatch(/permission wasn't granted/);

    // The owner is told once.
    const told = await api.sql<{ title: string }>(
      "select title from public.notifications where organization_id = $1",
      [c.org],
    );
    expect(told.map((n) => n.title)).toEqual(["Google Calendar disconnected"]);
  });

  it("for someone who has left, the dead grant is flagged without asking anyone to reconnect it", async () => {
    const { listMemberManagedEvents } = await import("@/lib/google-calendar");
    const c = await memberConnection({ scope: "openid https://www.googleapis.com/auth/userinfo.email", expired: false });
    await api.sql("update public.memberships set status = 'disabled' where id = $1", [c.membershipId]);
    googleTokenEndpointSays(200);

    expect(await listMemberManagedEvents(c.membershipId, ...window())).toEqual([]);
    expect((await state(c.connectionId)).status).toBe("error");
    expect(await api.sql("select id from public.notifications where organization_id = $1", [c.org])).toEqual([]);
  });

  it("a temporary Google failure while refreshing leaves the connection on", async () => {
    const { listMemberManagedEvents } = await import("@/lib/google-calendar");
    const c = await memberConnection({
      scope: "https://www.googleapis.com/auth/calendar.events openid",
      expired: true,
    });
    googleTokenEndpointSays(503);

    await expect(listMemberManagedEvents(c.membershipId, ...window())).rejects.toThrow(/503/);
    expect(await state(c.connectionId)).toEqual({ status: "active", last_error: null });
  });

  it("Google refusing the token (revoked) does switch it off", async () => {
    const { listMemberManagedEvents } = await import("@/lib/google-calendar");
    const c = await memberConnection({
      scope: "https://www.googleapis.com/auth/calendar.events openid",
      expired: true,
    });
    googleTokenEndpointSays(400);

    await expect(listMemberManagedEvents(c.membershipId, ...window())).rejects.toThrow(/400/);
    expect(await state(c.connectionId)).toMatchObject({ status: "error", last_error: "Token refresh failed: 400" });
  });
});

describe("which refresh failures are permanent", () => {
  it("only the provider refusing the token", async () => {
    const { refreshFailureIsPermanent } = await import("@/lib/oauth-refresh");
    expect([400, 401].map(refreshFailureIsPermanent)).toEqual([true, true]);
    expect([429, 500, 502, 503, 504].map(refreshFailureIsPermanent)).toEqual([false, false, false, false, false]);
  });

  it("a grant counts as calendar access only when it names calendar", async () => {
    const { grantIncludesCalendar } = await import("@/lib/google-calendar");
    expect(grantIncludesCalendar("openid https://www.googleapis.com/auth/userinfo.email")).toBe(false);
    expect(grantIncludesCalendar("https://www.googleapis.com/auth/calendar.events openid")).toBe(true);
    expect(grantIncludesCalendar(null)).toBe(true); // old rows with no scope recorded
  });
});

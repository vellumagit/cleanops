/**
 * One phone, two logins (2026-11-14).
 *
 * The app now re-saves the registration a device already holds whenever
 * someone opens it signed in (src/components/push-prompt.tsx, bindExisting).
 * That only helps if the route really hands the device over: one row per
 * device, owned by the last person to save it, and never by someone naming
 * a membership that is not theirs.
 *
 * The real route against the real stack (test/db/api.ts).
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addMember, addOrg } from "./harness";
import { request } from "./next-stubs";

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

const PHONE = "https://fcm.googleapis.com/fcm/send/one-phone";

async function save(userId: string | null, membershipId: string, endpoint = PHONE) {
  request.cookies = userId ? api.sessionCookies(userId) : [];
  const { POST } = await import("@/app/api/push/subscribe/route");
  return POST(
    new NextRequest("http://localhost/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subscription: { endpoint, keys: { p256dh: "p256dh-key", auth: "auth-key" } },
        membershipId,
        // Ignored by the route; sent because the app sends it.
        organizationId: "00000000-0000-0000-0000-000000000000",
      }),
    }),
  );
}

const owners = (endpoint = PHONE) =>
  api.sql<{ membership_id: string; organization_id: string }>(
    "select membership_id, organization_id from public.push_subscriptions where endpoint = $1",
    [endpoint],
  );

describe.skipIf(!hasPostgrest)("push subscribe: a device belongs to whoever is signed in on it", () => {
  it("the second person to open the app on a phone takes its pushes over", async () => {
    const org = await addOrg(api.sql);
    const jim = await addMember(api.sql, org, "employee", "Jim");
    const john = await addMember(api.sql, org, "employee", "John");

    expect((await save(jim.userId, jim.membershipId)).status).toBe(200);
    expect(await owners()).toEqual([{ membership_id: jim.membershipId, organization_id: org }]);

    expect((await save(john.userId, john.membershipId)).status).toBe(200);
    // One row for the phone, and it is John's now: Jim's pushes stop landing
    // on a phone he is no longer signed in on.
    expect(await owners()).toEqual([{ membership_id: john.membershipId, organization_id: org }]);

    // Saving again changes nothing (the app does this on every open).
    expect((await save(john.userId, john.membershipId)).status).toBe(200);
    expect(await owners()).toEqual([{ membership_id: john.membershipId, organization_id: org }]);
  });

  it("nobody can point a phone at a membership that is not theirs", async () => {
    const org = await addOrg(api.sql);
    const jim = await addMember(api.sql, org, "employee", "Jim");
    const john = await addMember(api.sql, org, "employee", "John");
    const endpoint = "https://fcm.googleapis.com/fcm/send/other-phone";

    expect((await save(jim.userId, jim.membershipId, endpoint)).status).toBe(200);
    // John, signed in, names Jim's membership.
    expect((await save(john.userId, jim.membershipId, endpoint)).status).toBe(403);
    // Signed out.
    expect((await save(null, john.membershipId, endpoint)).status).toBe(401);
    expect(await owners(endpoint)).toEqual([{ membership_id: jim.membershipId, organization_id: org }]);
  });
});

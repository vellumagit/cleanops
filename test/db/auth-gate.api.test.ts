/**
 * requireMembership(), the door every /app and /field render and most server
 * actions go through, after the 2026-11-21 speed work:
 *
 *   - the membership read also carries the org's settings (org-prefetch.ts),
 *     and that read must work against the real schema: if it ever failed,
 *     everyone would fall back to the old two-trip path without a sound but
 *     a log line;
 *   - the MFA gate's Auth-server question now starts BESIDE the membership
 *     read instead of after it, and must still decide in the old order:
 *     signed out -> /login, no membership -> /no-access, wrong role -> home,
 *     enrolled but not past the second factor -> /mfa-verify.
 *
 * The test stack has no GoTrue MFA, so /auth/v1/user is answered here for
 * the people marked as having an authenticator app; everyone else's goes to
 * the stack's own stand-in. Memberships reads are held back a little so a
 * gate that waited for them can be told apart from one that didn't.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addMember, addOrg, type Member } from "./harness";
import { request } from "./next-stubs";

vi.mock("next/headers", async () => ({
  ...(await import("./next-stubs")).nextHeaders(),
  // A page render under /app: the MFA gate only runs where middleware has
  // named the path.
  headers: async () => new Headers({ "x-pathname": "/app/payroll" }),
}));
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => ({
  ...(await import("./next-stubs")).nextNavigation(),
  // Marked the way Next marks it: the MFA gate fails OPEN on anything else
  // it catches, and re-throws only an error carrying this digest.
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirected to ${to}`), { digest: `NEXT_REDIRECT;replace;${to};307;` });
  },
}));

let api: Api;
let restoreEnv: () => void;
let restoreFetch: () => void = () => {};
let auth: typeof import("@/lib/auth");

const mfaUsers = new Set<string>();
type Seen = { what: "auth-user" | "memberships"; start: number; end: number };
let seen: Seen[] = [];
const MEMBERSHIPS_DELAY_MS = 150;

function standIn(a: Api): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const start = performance.now();
    if (url.startsWith(`${a.url}/auth/v1/user`)) {
      const token = (new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      let sub: string | undefined;
      try {
        sub = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")).sub;
      } catch {
        sub = undefined;
      }
      const res =
        sub && mfaUsers.has(sub)
          ? new Response(
              JSON.stringify({
                id: sub,
                aud: "authenticated",
                role: "authenticated",
                app_metadata: {},
                user_metadata: {},
                factors: [{ id: "factor-1", factor_type: "totp", status: "verified", friendly_name: "phone" }],
                created_at: new Date(0).toISOString(),
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            )
          : await real(input, init);
      seen.push({ what: "auth-user", start, end: performance.now() });
      return res;
    }
    if (url.includes("/rest/v1/memberships")) {
      await new Promise((r) => setTimeout(r, MEMBERSHIPS_DELAY_MS));
      const res = await real(input, init);
      seen.push({ what: "memberships", start, end: performance.now() });
      return res;
    }
    return real(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

let org: string;
let owner: Member;
let enrolledOwner: Member;
let enrolledCleaner: Member;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  restoreFetch = standIn(api);
  auth = await import("@/lib/auth");
  org = await addOrg(api.sql, "Gate Co");
  owner = await addMember(api.sql, org, "owner", "Plain Owner");
  enrolledOwner = await addMember(api.sql, org, "admin", "Enrolled Admin");
  enrolledCleaner = await addMember(api.sql, org, "employee", "Enrolled Cleaner");
  mfaUsers.add(enrolledOwner.userId);
  mfaUsers.add(enrolledCleaner.userId);
}, 240_000);

afterAll(async () => {
  restoreFetch();
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  seen = [];
});

/** requireMembership as this person; a redirect is an answer too. */
async function door(who: Member | null, allowed?: Parameters<typeof import("@/lib/auth").requireMembership>[0]) {
  request.cookies = who ? api.sessionCookies(who.userId) : [];
  try {
    const m = await auth.requireMembership(allowed);
    return { role: m.role, org: m.organization_id };
  } catch (err) {
    const r = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
    if (r) return { redirected: r[1] };
    throw err;
  }
}

describe.skipIf(!hasPostgrest)("requireMembership: settings ride along, the MFA gate runs beside", () => {
  it("lets a member in, reading the org's settings in the same query without falling back", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await door(owner)).toEqual({ role: "owner", org });
      const fellBack = errors.mock.calls.filter((c) => String(c[0]).includes("[auth] membership read with org settings failed"));
      expect(fellBack, "the membership read with org settings must work on the real schema").toEqual([]);
      expect(seen.filter((s) => s.what === "memberships")).toHaveLength(1);
    } finally {
      errors.mockRestore();
    }
  });

  it("asks the Auth server about MFA while the membership read is still out, not after it", async () => {
    expect(await door(owner)).toEqual({ role: "owner", org });
    const membershipsRead = seen.find((s) => s.what === "memberships");
    // The test stack signs HS256, so getClaims() asks /auth/v1/user once
    // before anything else (production verifies locally). The MFA gate's
    // question is the one after it.
    const authCalls = seen.filter((s) => s.what === "auth-user");
    expect(membershipsRead).toBeDefined();
    expect(authCalls.length).toBeGreaterThanOrEqual(2);
    const mfaQuestion = authCalls[authCalls.length - 1];
    expect(mfaQuestion.start).toBeLessThan(membershipsRead!.end);
  });

  it("still sends someone enrolled in MFA, past only their password, to the second factor", async () => {
    expect(await door(enrolledOwner)).toEqual({ redirected: "/mfa-verify?next=%2Fapp%2Fpayroll" });
  });

  it("still checks the role first: an enrolled cleaner at an office-only door goes home to /field", async () => {
    expect(await door(enrolledCleaner, ["owner", "admin", "manager"])).toEqual({ redirected: "/field" });
  });

  it("still says no access, not MFA, to someone signed in with no membership", async () => {
    const [stranger] = await api.sql<{ id: string }>(
      "insert into auth.users (email) values ('stranger@example.test') returning id",
    );
    await api.sql("insert into public.profiles (id, full_name) values ($1, 'Stranger') on conflict do nothing", [stranger.id]);
    mfaUsers.add(stranger.id);
    expect(await door({ userId: stranger.id, membershipId: "" })).toEqual({ redirected: "/no-access" });
  });

  it("sends the signed-out to /login without asking the Auth server anything", async () => {
    expect(await door(null)).toEqual({ redirected: "/login" });
    expect(seen.filter((s) => s.what === "auth-user")).toEqual([]);
  });
});

/**
 * How a client gets in (2026-11-22): they type their email, get one button
 * by email, press it, and are in. No password, and no invite first.
 *
 * Before, only a client the office had invited could sign in, and the invite
 * made them choose a password. Anyone else typed their email and nothing
 * happened.
 *
 * The rules run for real, on a real database: who is sent a link, whose
 * record a pressed link opens, and what happens to a login somebody else
 * registered first. The auth server itself is stood in for (the test stack
 * has none): making a login, minting a one-time token, spending it, and
 * scrambling a password are four small fakes below. So this proves the
 * rules, not that the real auth server answers the way the fakes do.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

type Sent = { to: string; subject: string; text?: string; html?: string };
const world = vi.hoisted(() => ({
  email: [] as Sent[],
  api: null as unknown as { sql: <T>(text: string, params?: unknown[]) => Promise<T[]>; sessionCookies: (id: string, email?: string) => Array<{ name: string; value: string }> },
  tokens: new Map<string, string>(),
  scrambled: [] as string[],
  cookies: (c: Array<{ name: string; value: string }>) => void c,
}));

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendOrgEmail: async (_o: string, a: Sent) => {
    world.email.push(a);
    return true;
  },
}));
// Every test here comes from one address; the per-connection limit is not
// what is being tested. The per-email limit stays real.
vi.mock("@/lib/rate-limit-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit-helpers")>()),
  checkIpRateLimit: async () => ({ allowed: true }),
}));
vi.mock("@/lib/client-sign-in-session", () => ({
  ensureLogin: async (_admin: unknown, email: string) => {
    const [have] = await world.api.sql("select 1 from auth.users where lower(email) = $1", [email]);
    if (!have) await world.api.sql("insert into auth.users (email, raw_user_meta_data) values ($1, '{\"is_client\":true}'::jsonb)", [email]);
    return { ok: true };
  },
  mintSignInToken: async (_admin: unknown, email: string) => {
    const token = `tok-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    world.tokens.set(token, email);
    return token;
  },
  // One use, like the real thing; and the browser is signed in afterwards.
  openSession: async (token: string) => {
    const email = world.tokens.get(token);
    if (!email) return null;
    world.tokens.delete(token);
    const [user] = await world.api.sql<{ id: string }>("select id from auth.users where lower(email) = $1", [email]);
    if (!user) return null;
    world.cookies(world.api.sessionCookies(user.id, email));
    return { userId: user.id, email };
  },
  scramblePassword: async (_admin: unknown, userId: string) => {
    world.scrambled.push(userId);
  },
}));

let api: Api;
let restoreEnv: () => void;
let login: typeof import("@/app/client/(public)/login/actions");
let enter: typeof import("@/app/client/(public)/enter/actions");
let portal: typeof import("@/app/app/clients/portal-actions");
let auth: typeof import("@/lib/client-auth");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  world.api = api as unknown as typeof world.api;
  world.cookies = (c) => {
    request.cookies = c;
  };
  login = await import("@/app/client/(public)/login/actions");
  enter = await import("@/app/client/(public)/enter/actions");
  portal = await import("@/app/app/clients/portal-actions");
  auth = await import("@/lib/client-auth");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  world.email.length = 0;
  world.scrambled.length = 0;
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
let seq = 0;
const address = (who: string) => `${who}.${Date.now()}.${++seq}@example.test`;

type Co = { org: string; name: string; owner: Member };
async function company(label = "Bright Homes"): Promise<Co> {
  const org = await addOrg(api.sql, label);
  const [{ name }] = await api.sql<{ name: string }>("select name from public.organizations where id = $1", [org]);
  return { org, name, owner: await addMember(api.sql, org, "owner", "Owner") };
}
async function onTheBooks(c: Co, name: string, email: string | null): Promise<string> {
  const id = await addClient(api.sql, c.org, name);
  await api.sql("update public.clients set name = $2, email = $3 where id = $1", [id, name, email]);
  return id;
}

/** Ask for a link as a stranger would: signed out. */
async function ask(email: string) {
  request.cookies = [];
  try {
    return await login.requestClientSignInAction({}, form({ email }));
  } finally {
    await settle();
  }
}
/** The link in the last email to this address. */
const linkFor = (email: string) => {
  const mail = world.email.filter((m) => m.to === email).at(-1);
  const token = /\/client\/enter\?t=([^\s"&<]+)/.exec(mail?.text ?? "")?.[1];
  return { mail, token: token ? decodeURIComponent(token) : null };
};
/** Press the button the link opens. A redirect is the answer. */
async function press(token: string, startSignedOut = true): Promise<string> {
  if (startSignedOut) request.cookies = [];
  try {
    await enter.enterClientAreaAction(form({ t: token }));
    return "no redirect";
  } catch (err) {
    const m = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
    if (m) return m[1];
    throw err;
  } finally {
    await settle();
  }
}
const profileOf = async (clientId: string) =>
  (await api.sql<{ p: string | null }>("select profile_id as p from public.clients where id = $1", [clientId]))[0].p;
const loginFor = async (email: string) =>
  (await api.sql<{ id: string }>("select id from auth.users where lower(email) = lower($1)", [email]))[0]?.id ?? null;

describe.skipIf(!hasPostgrest)("a client on the books signs in with their email", { timeout: 120_000 }, () => {
  it("never invited: asks, gets one button from their cleaner, presses it, and is in their own client area", async () => {
    const c = await company();
    const email = address("dana");
    const dana = await onTheBooks(c, "Dana Whitfield", email);
    expect(await loginFor(email), "no login before").toBeNull();

    expect(await ask(`  ${email.toUpperCase()} `), api.log()).toEqual({ sentTo: email });
    const { mail, token } = linkFor(email);
    expect(mail?.subject).toBe(`Your link to ${c.name}`);
    expect(mail?.text).toContain("Hi Dana,");
    expect(mail?.html).toContain("Open my cleans");
    expect(mail?.text).not.toMatch(/password/i);
    expect(token).toBeTruthy();
    // Asking is not getting in: nothing is connected until the button is pressed.
    expect(await profileOf(dana)).toBeNull();

    expect(await press(token!)).toBe("/client");
    const userId = await loginFor(email);
    expect(await profileOf(dana)).toBe(userId);
    // And the browser that pressed it is that client, in that company.
    const state = await auth.getClientAuthState();
    expect(state).toMatchObject({ status: "ok", client: { id: dana, organization_id: c.org, organization_name: c.name } });

    // The button works once.
    expect(await press(token!)).toBe("/client/login?link=expired");
    // Next time is the same: a new link, no setup, the same record.
    await ask(email);
    expect(await press(linkFor(email).token!)).toBe("/client");
    expect(await profileOf(dana)).toBe(userId);
  });

  it("an email nobody has on their books gets the same answer and no email; nonsense is refused", async () => {
    const c = await company();
    await onTheBooks(c, "Real Client", address("real"));
    const stranger = address("stranger");
    expect(await ask(stranger)).toEqual({ sentTo: stranger });
    expect(world.email).toEqual([]);
    expect(await loginFor(stranger), "no login is made for a stranger").toBeNull();

    for (const bad of ["", "dana", "dana@", "dana at home.com"]) {
      expect((await ask(bad)).error, bad).toMatch(/doesn't look like an email/);
    }
    expect(world.email).toEqual([]);
  });

  it("an email that only looks alike is a different person", async () => {
    const c = await company();
    const real = address("m.underwood");
    const lookalike = real.replace("m.underwood", "m_underwood");
    const client = await onTheBooks(c, "M Underwood", real);
    // _ and % are wildcards to the database's case-insensitive match.
    await ask(lookalike);
    await ask(real.replace("m.underwood", "%"));
    expect(world.email).toEqual([]);
    expect(await profileOf(client)).toBeNull();
  });

  it("an archived client is locked out: no link, and a link already sent opens nothing", async () => {
    const c = await company();
    const email = address("gone");
    const client = await onTheBooks(c, "Gone Client", email);
    await ask(email);
    const { token } = linkFor(email);
    await api.sql("update public.clients set archived_at = now() where id = $1", [client]);

    expect(await press(token!)).toBe("/client/login?link=no-client");
    expect(await profileOf(client)).toBeNull();
    world.email.length = 0;
    await ask(email);
    expect(world.email).toEqual([]);
  });

  it("asking over and over is stopped, and says the last link still works", async () => {
    const c = await company();
    const email = address("eager");
    await onTheBooks(c, "Eager Client", email);
    for (let i = 0; i < 4; i++) expect((await ask(email)).sentTo, `ask ${i + 1}`).toBe(email);
    const fifth = await ask(email);
    expect(fifth.error).toMatch(/Wait a few minutes/);
    expect(world.email.filter((m) => m.to === email)).toHaveLength(4);
  });
});

describe.skipIf(!hasPostgrest)("whose record a pressed link opens", { timeout: 120_000 }, () => {
  it("a login somebody registered first is no way in: its password is made useless when the real client arrives", async () => {
    const c = await company();
    const email = address("target");
    const client = await onTheBooks(c, "Target Client", email);
    // Anyone can register any address with the auth server, with a password
    // of their choosing, before the real person ever shows up.
    await api.sql("insert into auth.users (email, raw_user_meta_data) values ($1, '{}'::jsonb)", [email]);
    const squatted = (await loginFor(email))!;
    // Registering proves nothing: the record is not theirs.
    expect(await profileOf(client)).toBeNull();

    await ask(email);
    expect(await press(linkFor(email).token!)).toBe("/client");
    expect(await profileOf(client)).toBe(squatted);
    expect(world.scrambled, "that password now opens nothing").toEqual([squatted]);

    // Signing in again later doesn't touch the password again.
    world.scrambled.length = 0;
    await ask(email);
    await press(linkFor(email).token!);
    expect(world.scrambled).toEqual([]);
  });

  it("someone who works for a company and is also a client keeps their staff password", async () => {
    const c = await company();
    const other = await company("Other Co");
    const staff = await addMember(api.sql, other.org, "manager", "Staffer");
    const email = address("staffer");
    await api.sql("update auth.users set email = $2 where id = $1", [staff.userId, email]);
    const client = await onTheBooks(c, "Staffer At Home", email);

    await ask(email);
    expect(await press(linkFor(email).token!)).toBe("/client");
    expect(await profileOf(client)).toBe(staff.userId);
    expect(world.scrambled).toEqual([]);
  });

  it("the same email at two companies: the link is from the first, and opens that one record", async () => {
    const first = await company("First Co");
    const second = await company("Second Co");
    const email = address("both");
    const a = await onTheBooks(first, "Both Client", email);
    const b = await onTheBooks(second, "Both Client", email);

    await ask(email);
    expect(linkFor(email).mail?.subject).toBe(`Your link to ${first.name}`);
    expect(await press(linkFor(email).token!)).toBe("/client");
    expect(await profileOf(a)).toBe(await loginFor(email));
    expect(await profileOf(b), "one login opens one record").toBeNull();
  });

  it("a made-up, empty or oversized token opens nothing", async () => {
    const c = await company();
    const client = await onTheBooks(c, "Safe Client", address("safe"));
    for (const t of ["", "x", "tok-not-a-real-one-at-all-12345", "a".repeat(400)]) {
      expect(await press(t), t.slice(0, 20)).toBe("/client/login?link=expired");
    }
    expect(await profileOf(client)).toBeNull();
  });
});

describe.skipIf(!hasPostgrest)("the invite link", { timeout: 120_000 }, () => {
  const invite = async (c: Co, client: string) => {
    request.cookies = api.sessionCookies(c.owner.userId);
    try {
      const res = await portal.invitePortalAction(form({ client_id: client }));
      if (!res.ok) throw new Error(res.error);
      return /\/client\/claim\/([A-Za-z0-9_-]+)/.exec(res.claimUrl ?? "")![1];
    } finally {
      await settle();
    }
  };
  const open = async (token: string): Promise<string | { error?: string }> => {
    request.cookies = [];
    try {
      return await portal.openPortalInviteAction({}, form({ token }));
    } catch (err) {
      const m = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
      if (m) return m[1];
      throw err;
    } finally {
      await settle();
    }
  };

  it("one button signs the client straight in, with no password; the link is then used up", async () => {
    const c = await company();
    const email = address("patricia");
    const client = await onTheBooks(c, "Patricia Poohkay", email);
    const token = await invite(c, client);

    expect(await open(token), api.log()).toBe("/client");
    const [row] = await api.sql<{ p: string | null; token: string | null; accepted: boolean }>(
      "select profile_id as p, portal_invite_token as token, portal_accepted_at is not null as accepted from public.clients where id = $1",
      [client],
    );
    expect(row).toEqual({ p: await loginFor(email), token: null, accepted: true });
    expect(await auth.getClientAuthState()).toMatchObject({ status: "ok", client: { id: client } });

    expect(await open(token)).toEqual({ error: "Invalid or expired link." });
  });

  it("an expired invite, or a made-up one, is refused in words and opens nothing", async () => {
    const c = await company();
    const client = await onTheBooks(c, "Late Client", address("late"));
    const token = await invite(c, client);
    await api.sql("update public.clients set portal_invite_expires_at = now() - interval '1 day' where id = $1", [client]);
    expect(await open(token)).toEqual({ error: "This invite has expired. Ask for a new one." });
    expect(await open("not-a-real-invite-token-0000")).toEqual({ error: "Invalid or expired link." });
    expect(await profileOf(client)).toBeNull();
    // They are not stuck: their email still gets them in.
    const [{ email }] = await api.sql<{ email: string }>("select email from public.clients where id = $1", [client]);
    await ask(email);
    expect(await press(linkFor(email).token!)).toBe("/client");
  });

  it("an invite opens its own client's record, not another record with the same email", async () => {
    const c = await company();
    const email = address("twin");
    const older = await onTheBooks(c, "Twin Older", email);
    const invited = await onTheBooks(c, "Twin Invited", email);
    const token = await invite(c, invited);
    expect(await open(token)).toBe("/client");
    expect(await profileOf(invited)).toBe(await loginFor(email));
    expect(await profileOf(older)).toBeNull();
  });
});

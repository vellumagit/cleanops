/**
 * The front door and a person's own account: sign in, sign up (a new company
 * or a new hire's invite), forgot and reset password, the admin console's
 * "your profile", finishing setup, and switching push notifications off.
 *
 * The test stack has no GoTrue for sign-in, sign-up, recover or password
 * change, so this file stands in for exactly those four calls (and the login
 * delete sign-up uses to undo itself), keeping each to what GoTrue would
 * answer: a password check against what the test set, a user row in
 * auth.users, a session token the stack's PostgREST accepts. Everything after
 * the auth call (which home a person lands on, the company and membership a
 * sign-up makes, the invite it claims) is the app's own code against the real
 * database. What is NOT covered: GoTrue's own behaviour (its password rules,
 * email confirmation, the recovery email and link, MFA challenge itself).
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

const net = vi.hoisted(() => ({ ip: "203.0.113.1" }));
vi.mock("next/headers", async () => ({
  ...(await import("./next-stubs")).nextHeaders(),
  // The rate limits key on the caller's address; each test gets its own.
  headers: async () => new Headers({ "x-forwarded-for": net.ip }),
}));
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  isEmailConfigured: () => true,
  sendEmail: async () => true,
  sendOrgEmail: async () => true,
  sendOrgEmailDetailed: async () => ({ ok: true }),
}));

let api: Api;
let restoreEnv: () => void;
let restoreFetch: () => void = () => {};
let login: typeof import("@/app/(marketing)/login/actions");
let signup: typeof import("@/app/(marketing)/signup/actions");
let forgot: typeof import("@/app/(marketing)/forgot-password/actions");
let reset: typeof import("@/app/(marketing)/reset-password/actions");
let profile: typeof import("@/app/app/profile/actions");
let setup: typeof import("@/app/app/setup/actions");

/** What the GoTrue stand-in holds and was asked. */
const gotrue = {
  passwords: new Map<string, string>(),
  /** Logins whose account has a verified authenticator app. */
  mfa: new Set<string>(),
  recovered: [] as Array<{ email: string; redirectTo: string | null }>,
  /** Emails GoTrue refuses to send to right now (its project-wide email cap). */
  capped: new Set<string>(),
  passwordChanges: [] as Array<{ userId: string; password: string }>,
  signups: [] as string[],
};

function standInGoTrue(a: Api): () => void {
  const real = globalThis.fetch;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const claims = (init?: RequestInit) => {
    const h = new Headers(init?.headers);
    const token = (h.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    try {
      return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; email?: string };
    } catch {
      return {};
    }
  };
  const asUser = (id: string, email: string, factors: unknown[] = []) => ({
    id,
    aud: "authenticated",
    role: "authenticated",
    email,
    identities: [{ id, identity_id: id, provider: "email" }],
    app_metadata: {},
    user_metadata: {},
    factors,
    created_at: new Date(0).toISOString(),
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(`${a.url}/auth/v1/`)) {
      const u = new URL(url);
      const path = u.pathname;
      const method = String(init?.method ?? "GET").toUpperCase();
      const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>;

      if (path === "/auth/v1/token" && u.searchParams.get("grant_type") === "password" && method === "POST") {
        const email = String(body.email ?? "").toLowerCase();
        const [row] = await a.sql<{ id: string }>("select id from auth.users where lower(email) = $1", [email]);
        if (!row || gotrue.passwords.get(email) !== body.password) {
          return json(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
        }
        const now = Math.floor(Date.now() / 1000);
        return json(200, {
          access_token: a.tokenFor(row.id, email),
          token_type: "bearer",
          expires_in: 3600,
          expires_at: now + 3600,
          refresh_token: "stand-in-refresh",
          user: asUser(row.id, email),
        });
      }
      if (path === "/auth/v1/user" && method === "GET") {
        const c = claims(init);
        if (c.sub && gotrue.mfa.has(c.sub)) {
          return json(200, asUser(c.sub, c.email ?? "", [{ id: "factor-1", factor_type: "totp", status: "verified", friendly_name: "phone" }]));
        }
      }
      if (path === "/auth/v1/user" && method === "PUT") {
        const c = claims(init);
        if (!c.sub) return json(401, { code: 401, msg: "invalid token" });
        gotrue.passwordChanges.push({ userId: c.sub, password: String(body.password ?? "") });
        return json(200, asUser(c.sub, c.email ?? ""));
      }
      if (path === "/auth/v1/recover" && method === "POST") {
        const email = String(body.email ?? "").toLowerCase();
        if (gotrue.capped.has(email)) {
          return json(429, { code: 429, error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" });
        }
        gotrue.recovered.push({ email, redirectTo: u.searchParams.get("redirect_to") });
        return json(200, {});
      }
      if (path === "/auth/v1/signup" && method === "POST") {
        const email = String(body.email ?? "").toLowerCase();
        const [exists] = await a.sql("select 1 from auth.users where lower(email) = $1", [email]);
        if (exists) return json(422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
        const [row] = await a.sql<{ id: string }>(
          "insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id",
          [email, JSON.stringify(body.data ?? {})],
        );
        gotrue.signups.push(email);
        gotrue.passwords.set(email, String(body.password ?? ""));
        // Email confirmation on: a user and no session.
        return json(200, asUser(row.id, email));
      }
      const del = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(path);
      if (del && method === "DELETE") {
        await a.sql("delete from auth.users where id = $1", [del[1]]);
        return json(200, { id: del[1] });
      }
    }
    return real(input as RequestInfo, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

beforeAll(async () => {
  if (!hasPostgrest) return;
  delete process.env.TURNSTILE_SECRET_KEY;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  restoreFetch = standInGoTrue(api);
  login = await import("@/app/(marketing)/login/actions");
  signup = await import("@/app/(marketing)/signup/actions");
  forgot = await import("@/app/(marketing)/forgot-password/actions");
  reset = await import("@/app/(marketing)/reset-password/actions");
  profile = await import("@/app/app/profile/actions");
  setup = await import("@/app/app/setup/actions");
}, 240_000);

afterAll(async () => {
  restoreFetch();
  restoreEnv?.();
  await api?.stop();
});

let ipSeq = 10;
beforeEach(() => {
  request.cookies = [];
  request.after = [];
  net.ip = `203.0.113.${++ipSeq}`;
});

/** Pressed as this member (or signed out); a redirect is an answer too. */
async function as<T>(m: Member | null, press: () => Promise<T>): Promise<T | { redirected: string }> {
  request.cookies = m ? api.sessionCookies(m.userId) : [];
  try {
    return await press();
  } catch (err) {
    const r = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
    if (r) return { redirected: r[1] };
    throw err;
  } finally {
    await settle();
  }
}
const signedOut = <T>(press: () => Promise<T>) => as(null, press);

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const emailOf = async (m: Member) => (await api.sql<{ email: string }>("select email from auth.users where id = $1", [m.userId]))[0].email;
async function withPassword(m: Member, password = "correct horse battery") {
  const email = await emailOf(m);
  gotrue.passwords.set(email.toLowerCase(), password);
  return { email, password };
}

async function company() {
  const org = await addOrg(api.sql, "Account Co");
  await api.sql("update public.organizations set timezone = 'America/Regina' where id = $1", [org]);
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    admin: await addMember(api.sql, org, "admin", "Iryna"),
    olha: await addMember(api.sql, org, "manager", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
}

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("signing in", () => {
  it("lands the office on /app and a portal client on /client", async () => {
    const c = await company();
    const office = await withPassword(c.olha);
    expect(await signedOut(() => login.loginAction({}, form(office))), api.log()).toEqual({ redirected: "/app" });

    // A client with a portal login and no membership anywhere.
    const clientId = await addClient(api.sql, c.org, "Portal Client");
    const [u] = await api.sql<{ id: string }>("insert into auth.users (email) values ('portal.client@example.com') returning id");
    await api.sql("update public.clients set profile_id = $2 where id = $1", [clientId, u.id]);
    gotrue.passwords.set("portal.client@example.com", "client-password");
    expect(await signedOut(() => login.loginAction({}, form({ email: "portal.client@example.com", password: "client-password" })))).toEqual({
      redirected: "/client",
    });
  });

  // FIX-LATER: loginAction reads every active membership the cleaner can see (her whole company, by RLS) instead of her own, finds the owner's role and sends her to /app; only /app's own guard bounces her on to /field
  it.fails("lands a cleaner on /field", async () => {
    const c = await company();
    const cleaner = await withPassword(c.anna);
    expect(await signedOut(() => login.loginAction({}, form(cleaner)))).toEqual({ redirected: "/field" });
  });

  it("follows a safe ?next= and drops anything that could leave the site", async () => {
    const c = await company();
    const creds = await withPassword(c.anna);
    expect(await signedOut(() => login.loginAction({}, form({ ...creds, next: "/field/jobs" })))).toEqual({ redirected: "/field/jobs" });
    expect(await signedOut(() => login.loginAction({}, form({ ...creds, next: "/join?token=abc123" })))).toEqual({ redirected: "/join?token=abc123" });
    const office = await withPassword(c.olha);
    for (const next of ["//evil.example.com", "/\\evil.example.com", "https://evil.example.com", "/%2F%2Fevil.example.com", "/admin"]) {
      expect(await signedOut(() => login.loginAction({}, form({ ...office, next }))), next).toEqual({ redirected: "/app" });
    }
  });

  it("someone with an authenticator app goes to the second step, keeping a safe ?next=", async () => {
    const c = await company();
    const creds = await withPassword(c.owner);
    gotrue.mfa.add(c.owner.userId);
    expect(await signedOut(() => login.loginAction({}, form(creds)))).toEqual({ redirected: "/mfa-verify" });
    expect(await signedOut(() => login.loginAction({}, form({ ...creds, next: "/app/payroll" })))).toEqual({ redirected: "/mfa-verify?next=%2Fapp%2Fpayroll" });
    expect(await signedOut(() => login.loginAction({}, form({ ...creds, next: "//evil.example.com" })))).toEqual({ redirected: "/mfa-verify" });
  });

  it("a wrong password, a malformed email and a missing password are refused without saying whether the account exists", async () => {
    const c = await company();
    const creds = await withPassword(c.anna);
    const wrong = { _form: "That email and password don't match. Check them, or reset your password." };
    expect(await signedOut(() => login.loginAction({}, form({ email: creds.email, password: "nope" })))).toEqual({ errors: wrong, values: { email: creds.email } });
    expect(await signedOut(() => login.loginAction({}, form({ email: "nobody.here@example.com", password: "nope" })))).toEqual({
      errors: wrong,
      values: { email: "nobody.here@example.com" },
    });
    expect(await signedOut(() => login.loginAction({}, form({ email: "not-an-email", password: "x" })))).toMatchObject({ errors: { email: "Enter a valid email address" } });
    expect(await signedOut(() => login.loginAction({}, form({ email: creds.email, password: "" })))).toMatchObject({ errors: { password: "Password is required" } });
  });

  it("stops the eleventh try in a minute from one address", async () => {
    const c = await company();
    const creds = await withPassword(c.anna);
    for (let i = 0; i < 10; i++) {
      expect(await signedOut(() => login.loginAction({}, form({ email: creds.email, password: `guess-${i}` })))).toMatchObject({ errors: { _form: expect.stringContaining("don't match") } });
    }
    const stopped = (await signedOut(() => login.loginAction({}, form(creds)))) as { errors?: { _form?: string } };
    expect(stopped.errors?._form).toMatch(/^Too many login attempts\. Try again in \d+ seconds\.$/);
  });
});

describe.skipIf(!hasPostgrest)("signing up", () => {
  const newCompany = (over: Record<string, string> = {}) =>
    form({ fullName: "Natalia Shevchenko", organizationName: "Sparkle Prairie Cleaning", email: `founder${++ipSeq}@example.com`, password: "a-strong-passphrase", ...over });

  it("a new company gets its workspace with her as the owner, and she is sent to confirm her email", async () => {
    const f = newCompany();
    const email = String(f.get("email"));
    expect(await signedOut(() => signup.signupAction({}, f)), api.log()).toEqual({ redirected: `/login?confirm=1&email=${encodeURIComponent(email)}` });
    const rows = await api.sql<{ name: string; slug: string; trial: boolean; role: string; status: string; full_name: string }>(
      `select o.name, o.slug, o.trial_started_at is not null as trial, m.role::text as role, m.status::text as status, p.full_name
         from auth.users u join public.memberships m on m.profile_id = u.id
         join public.organizations o on o.id = m.organization_id join public.profiles p on p.id = u.id
        where u.email = $1`,
      [email],
    );
    expect(rows).toEqual([{ name: "Sparkle Prairie Cleaning", slug: expect.stringMatching(/^sparkle-prairie-cleaning/), trial: true, role: "owner", status: "active", full_name: "Natalia Shevchenko" }]);
  });

  it("refuses a weak form and a throwaway inbox before creating anything", async () => {
    const before = gotrue.signups.length;
    expect(await signedOut(() => signup.signupAction({}, newCompany({ password: "short" })))).toMatchObject({ errors: { password: "Password must be at least 10 characters" } });
    expect(await signedOut(() => signup.signupAction({}, newCompany({ organizationName: "" })))).toMatchObject({ errors: { organizationName: "Company name is required" } });
    expect(await signedOut(() => signup.signupAction({}, newCompany({ email: "nope" })))).toMatchObject({ errors: { email: "Enter a valid email address" } });
    expect(await signedOut(() => signup.signupAction({}, newCompany({ email: "someone@mailinator.com" })))).toMatchObject({
      errors: { _form: "That looks like a throwaway inbox. Please use a real business or personal email address." },
    });
    expect(gotrue.signups.length, "no login was created").toBe(before);
  });

  it("an email that already has an account is answered like any new sign-up, and no company is made", async () => {
    const c = await company();
    const email = await emailOf(c.anna);
    const orgsBefore = (await api.sql("select 1 from public.organizations")).length;
    expect(await signedOut(() => signup.signupAction({}, newCompany({ email, organizationName: "Second Company" })))).toEqual({
      redirected: `/login?confirm=1&email=${encodeURIComponent(email)}`,
    });
    expect((await api.sql("select 1 from public.organizations")).length).toBe(orgsBefore);
  });

  it("stops the sixth sign-up in a minute from one address", async () => {
    for (let i = 0; i < 5; i++) await signedOut(() => signup.signupAction({}, newCompany({ password: "short" })));
    // Validation failures don't count; these five real attempts do.
    for (let i = 0; i < 5; i++) await signedOut(() => signup.signupAction({}, newCompany({ email: `spree${i}@mailinator.com` })));
    const stopped = (await signedOut(() => signup.signupAction({}, newCompany()))) as { errors?: { _form?: string } };
    expect(stopped.errors?._form).toMatch(/^Too many signup attempts\./);
  });

  it("a new hire signing up from her invite joins that company with the invite's terms, and only with the address it was sent to", async () => {
    const c = await company();
    const [inv] = await api.sql<{ id: string; token: string }>(
      "insert into public.invitations (organization_id, email, role, engagement, pay_rate_cents) values ($1, 'oksana.new@example.com', 'employee', 'employee', 2100) returning id, token",
      [c.org],
    );
    const hire = (over: Record<string, string> = {}) =>
      form({ fullName: "Oksana Melnyk", email: "oksana.new@example.com", password: "a-strong-passphrase", inviteToken: inv.token, ...over });

    expect(await signedOut(() => signup.signupAction({}, hire({ email: "forwarded.to@example.com" })))).toMatchObject({
      errors: { _form: "This invitation was sent to oksana.new@example.com. Sign up with that email address to accept it." },
    });
    expect(await signedOut(() => signup.signupAction({}, hire({ inviteToken: "not-a-real-token" })))).toMatchObject({
      errors: { _form: "This invite link is invalid or has expired. Ask your admin to send a new one." },
    });
    const orgsBefore = (await api.sql("select 1 from public.organizations")).length;
    expect(await signedOut(() => signup.signupAction({}, hire())), api.log()).toEqual({ redirected: "/login?confirm=1&email=oksana.new%40example.com" });
    const members = await api.sql<{ org: string; role: string; pay: number; status: string }>(
      `select m.organization_id as org, m.role::text as role, m.pay_rate_cents as pay, m.status::text as status
         from public.memberships m join auth.users u on u.id = m.profile_id where u.email = 'oksana.new@example.com'`,
    );
    expect(members).toEqual([{ org: c.org, role: "employee", pay: 2100, status: "active" }]);
    expect((await api.sql("select 1 from public.organizations")).length, "no company of her own").toBe(orgsBefore);
    const [{ accepted }] = await api.sql<{ accepted: boolean }>("select accepted_at is not null as accepted from public.invitations where id = $1", [inv.id]);
    expect(accepted).toBe(true);
    // The link is spent.
    expect(await signedOut(() => signup.signupAction({}, hire()))).toMatchObject({ errors: { _form: expect.stringContaining("invalid or has expired") } });

    // Invited at an address that already has a login: sign in to accept, nothing claimed here.
    const annaEmail = await emailOf(c.anna);
    const other = await company();
    const [second] = await api.sql<{ token: string }>(
      "insert into public.invitations (organization_id, email, role, engagement) values ($1, $2, 'employee', 'employee') returning token",
      [other.org, annaEmail],
    );
    expect(await signedOut(() => signup.signupAction({}, hire({ email: annaEmail, inviteToken: second.token })))).toEqual({
      redirected: `/login?invite=${encodeURIComponent(second.token)}`,
    });
    expect(await api.sql("select 1 from public.memberships where organization_id = $1 and profile_id = $2", [other.org, c.anna.userId])).toHaveLength(0);
  });
});

describe.skipIf(!hasPostgrest)("forgot password", () => {
  it("sends the reset link back to the reset page, and answers the same for an address with no account", async () => {
    const c = await company();
    const email = await emailOf(c.anna);
    expect(await signedOut(() => forgot.forgotPasswordAction({}, form({ email: `  ${email}  ` }))), api.log()).toEqual({ sent: true, email });
    const asked = gotrue.recovered.filter((r) => r.email === email.toLowerCase());
    expect(asked).toHaveLength(1);
    expect(asked[0].redirectTo).toMatch(/\/auth\/callback\?next=\/reset-password$/);

    expect(await signedOut(() => forgot.forgotPasswordAction({}, form({ email: "no.account@example.com" })))).toEqual({ sent: true, email: "no.account@example.com" });
    expect(await signedOut(() => forgot.forgotPasswordAction({}, form({ email: "nope" })))).toEqual({ errors: { email: "Enter a valid email" }, email: "nope" });
  });

  it("a fourth request for one address inside 15 minutes is refused, and GoTrue's own email cap is said plainly", async () => {
    const c = await company();
    const email = (await emailOf(c.anna)).toLowerCase();
    for (let i = 0; i < 3; i++) {
      net.ip = `198.51.100.${i + 1}`; // different networks: the per-address limit is what's tested
      expect(await signedOut(() => forgot.forgotPasswordAction({}, form({ email })))).toEqual({ sent: true, email });
    }
    net.ip = "198.51.100.9";
    const fourth = (await signedOut(() => forgot.forgotPasswordAction({}, form({ email })))) as { errors?: { _form?: string } };
    expect(fourth.errors?._form).toMatch(/^Too many reset requests for this email\. Try again in \d+ minutes?\.$/);
    expect(gotrue.recovered.filter((r) => r.email === email)).toHaveLength(3);

    gotrue.capped.add("capped.person@example.com");
    expect(await signedOut(() => forgot.forgotPasswordAction({}, form({ email: "capped.person@example.com" })))).toEqual({
      errors: {
        _form:
          "Our system is temporarily limiting password reset emails. Please try again in about an hour, or contact support if you're locked out.",
      },
      email: "capped.person@example.com",
    });
  });
});

describe.skipIf(!hasPostgrest)("reset password", () => {
  it("sets the new password for the person the reset link signed in, and refuses a mismatch or a short one", async () => {
    const c = await company();
    expect(await as(c.anna, () => reset.resetPasswordAction({}, form({ password: "new-password-1", confirm_password: "new-password-2" })))).toEqual({
      errors: { confirm_password: "Passwords don't match" },
    });
    expect(await as(c.anna, () => reset.resetPasswordAction({}, form({ password: "short", confirm_password: "short" })))).toMatchObject({
      errors: { password: "Password must be at least 8 characters" },
    });
    expect(gotrue.passwordChanges.filter((p) => p.userId === c.anna.userId)).toEqual([]);

    expect(await as(c.anna, () => reset.resetPasswordAction({}, form({ password: "new-password-1", confirm_password: "new-password-1" }))), api.log()).toEqual({ done: true });
    expect(gotrue.passwordChanges.filter((p) => p.userId === c.anna.userId)).toEqual([{ userId: c.anna.userId, password: "new-password-1" }]);
  });

  it("without a session from the reset link, nothing is changed and she is told", async () => {
    const before = gotrue.passwordChanges.length;
    const res = (await signedOut(() => reset.resetPasswordAction({}, form({ password: "new-password-1", confirm_password: "new-password-1" })))) as {
      errors?: { _form?: string };
      done?: boolean;
    };
    expect(res.done).toBeUndefined();
    expect(res.errors?._form).toBeTruthy();
    expect(gotrue.passwordChanges.length).toBe(before);
  });
});

describe.skipIf(!hasPostgrest)("your profile", () => {
  it("anyone saves their own name and phone, and only their own", async () => {
    const c = await company();
    const profileOf = async (m: Member) =>
      (await api.sql<{ full_name: string; phone: string | null }>("select full_name, phone from public.profiles where id = $1", [m.userId]))[0];
    const annaBefore = await profileOf(c.anna);

    expect(await as(c.olha, () => profile.updateMyProfileAction({}, form({ full_name: "  Olha Kovalenko ", phone: "403-555-0199" }))), api.log()).toEqual({
      values: { full_name: "  Olha Kovalenko ", phone: "403-555-0199" },
    });
    expect(await profileOf(c.olha)).toEqual({ full_name: "Olha Kovalenko", phone: "403-555-0199" });
    expect(await as(c.olha, () => profile.updateMyProfileAction({}, form({ full_name: "Olha Kovalenko", phone: "" })))).toMatchObject({ values: {} });
    expect((await profileOf(c.olha)).phone, "a cleared phone is cleared").toBeNull();
    expect(await as(c.olha, () => profile.updateMyProfileAction({}, form({ full_name: "   ", phone: "" })))).toMatchObject({ errors: { full_name: expect.any(String) } });
    expect((await profileOf(c.olha)).full_name).toBe("Olha Kovalenko");
    expect(await profileOf(c.anna), "nobody else's profile moved").toEqual(annaBefore);
  });
});

describe.skipIf(!hasPostgrest)("finishing setup", () => {
  const completedAt = async (org: string) =>
    (await api.sql<{ done: boolean }>("select onboarding_completed_at is not null as done from public.organizations where id = $1", [org]))[0].done;

  it("the owner finishes setup once and goes to the dashboard; a manager or cleaner can't", async () => {
    const c = await company();
    await expect(as(c.olha, () => setup.completeOnboardingAction())).rejects.toThrow("You don't have permission to complete onboarding.");
    await expect(as(c.anna, () => setup.completeOnboardingAction())).rejects.toThrow("You don't have permission to complete onboarding.");
    expect(await completedAt(c.org)).toBe(false);

    expect(await as(c.owner, () => setup.completeOnboardingAction()), api.log()).toEqual({ redirected: "/app" });
    expect(await completedAt(c.org)).toBe(true);
    const audit = await api.sql<{ after: unknown }>("select after from public.audit_log where organization_id = $1 and entity = 'settings'", [c.org]);
    expect(audit.map((a) => a.after)).toEqual([{ onboarding_completed: true }]);
  });

  // FIX-LATER: completeOnboardingAction lets admins in, but organizations can only be updated by owners (RLS), so an admin's press changes nothing and still redirects as done
  it.fails("an admin finishing setup really finishes it", async () => {
    const c = await company();
    expect(await as(c.admin, () => setup.completeOnboardingAction())).toEqual({ redirected: "/app" });
    expect(await completedAt(c.org)).toBe(true);
  });
});

describe.skipIf(!hasPostgrest)("switching push notifications off", () => {
  async function device(org: string, m: Member, endpoint: string) {
    await api.sql(
      "insert into public.push_subscriptions (organization_id, membership_id, endpoint, keys_p256dh, keys_auth) values ($1, $2, $3, 'p256dh', 'auth')",
      [org, m.membershipId, endpoint],
    );
  }
  const has = async (endpoint: string) => (await api.sql("select 1 from public.push_subscriptions where endpoint = $1", [endpoint])).length === 1;
  async function off(m: Member | null, body: unknown) {
    request.cookies = m ? api.sessionCookies(m.userId) : [];
    const { POST } = await import("@/app/api/push/unsubscribe/route");
    const res = await POST(new NextRequest("http://localhost/api/push/unsubscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  }

  it("removes her own device, and never a teammate's", async () => {
    const c = await company();
    const annas = "https://fcm.googleapis.com/fcm/send/anna-phone";
    const olhas = "https://fcm.googleapis.com/fcm/send/olha-phone";
    await device(c.org, c.anna, annas);
    await device(c.org, c.olha, olhas);

    expect(await off(null, { endpoint: annas })).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(await off(c.anna, {})).toEqual({ status: 400, body: { error: "Missing endpoint" } });
    expect(await off(c.anna, { endpoint: olhas })).toEqual({ status: 200, body: { ok: true } });
    expect(await has(olhas), "Olha still gets her pushes").toBe(true);
    expect(await has(annas)).toBe(true);

    expect(await off(c.anna, { endpoint: annas }), api.log()).toEqual({ status: 200, body: { ok: true } });
    expect(await has(annas)).toBe(false);
  });
});

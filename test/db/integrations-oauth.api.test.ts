/**
 * Connecting and disconnecting the outside services, pressed the way the
 * office and the cleaners press them, against a real database behind the
 * real PostgREST. Google, Intuit and Sage are stood in for at their own
 * hosts; nothing leaves the machine.
 *
 *   Settings → Integrations   Google Calendar (the company's), QuickBooks,
 *                             Sage: Connect, the callback each provider sends
 *                             the browser back to, Disconnect; Sage's tax
 *                             region and account map; "request an integration"
 *   Field → Profile           a cleaner's own Google Calendar: connect,
 *                             callback, re-sync, disconnect, what it shows
 *
 * What each owes: a callback lands on the company and the person who started
 * it and on nobody else (not a forged one, not an expired one, not another
 * company's), the tokens are stored encrypted where the code later looks for
 * them, and Disconnect switches off exactly the connection it names.
 */
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";
import { installFakeGoogleCalendar, type FakeGoogle } from "./fake-google-calendar";

type Sent = { to: string; subject: string; text?: string; html?: string; replyTo?: string };
const outbox = vi.hoisted(() => ({ email: [] as Sent[] }));
vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  isEmailConfigured: () => true,
  sendEmail: async (a: Sent) => {
    outbox.email.push(a);
    return true;
  },
}));

const SITE = "https://app.example.com";
const ENV: Record<string, string> = {
  NEXT_PUBLIC_SITE_URL: SITE,
  INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  GOOGLE_CALENDAR_CLIENT_ID: "test-google-client",
  GOOGLE_CALENDAR_CLIENT_SECRET: "test-google-secret",
  QUICKBOOKS_CLIENT_ID: "test-qb-client",
  QUICKBOOKS_CLIENT_SECRET: "test-qb-secret",
  SAGE_CLIENT_ID: "test-sage-client",
  SAGE_CLIENT_SECRET: "test-sage-secret",
};
// getEnv() and the encryption key are read once and kept, so they are set
// before any app module runs.
const saved: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries(ENV)) {
  saved[k] = process.env[k];
  process.env[k] = v;
}

const gcalSettings = await import("@/app/app/settings/integrations/google-calendar-actions");
const qbSettings = await import("@/app/app/settings/integrations/quickbooks-actions");
const sageSettings = await import("@/app/app/settings/integrations/sage-actions");
const { requestIntegrationAction } = await import("@/app/app/settings/integrations/request-actions");
const profile = await import("@/app/field/profile/actions");
const { GET: gcalCallback } = await import("@/app/api/integrations/google-calendar/callback/route");
const { GET: qbCallback } = await import("@/app/api/integrations/quickbooks/callback/route");
const { GET: sageCallback } = await import("@/app/api/integrations/sage/callback/route");
const { encryptSecret, decryptSecret } = await import("@/lib/crypto");

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
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ---------------------------------------------------------------------------
// The providers, stood in for at their own hosts
// ---------------------------------------------------------------------------

const FULL_SCOPE = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email";
/** What Google hands back for an authorization code: whose account, what was ticked. */
const googleGrants = new Map<string, { token: string; email: string; scope?: string }>();
/** Authorization codes exchanged, per provider. */
const exchanged = { google: [] as string[], qb: [] as string[], sage: [] as string[] };
let google: FakeGoogle;
let restoreProviders: () => void = () => {};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  outbox.email.length = 0;
  exchanged.google.length = 0;
  exchanged.qb.length = 0;
  exchanged.sage.length = 0;
  google = installFakeGoogleCalendar();
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = new URLSearchParams(typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : "");
    if (url.startsWith("https://oauth2.googleapis.com/token") && body.get("grant_type") === "authorization_code") {
      const code = body.get("code") ?? "";
      exchanged.google.push(code);
      const g = googleGrants.get(code);
      if (!g) return json(400, { error: "invalid_grant" });
      return json(200, { access_token: g.token, refresh_token: `refresh-${g.token}`, expires_in: 3600, scope: g.scope ?? FULL_SCOPE, token_type: "Bearer" });
    }
    if (url.startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) {
      const token = (new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const g = [...googleGrants.values()].find((x) => x.token === token);
      return g ? json(200, { email: g.email }) : json(401, { error: "unauthenticated" });
    }
    if (url.startsWith("https://oauth.platform.intuit.com/")) {
      const code = body.get("code") ?? "";
      exchanged.qb.push(code);
      return json(200, { access_token: `qb-access-${code}`, refresh_token: `qb-refresh-${code}`, expires_in: 3600, token_type: "bearer" });
    }
    if (url.startsWith("https://oauth.accounting.sage.com/")) {
      const code = body.get("code") ?? "";
      exchanged.sage.push(code);
      return json(200, { access_token: `sage-access-${code}`, refresh_token: `sage-refresh-${code}`, expires_in: 300, scope: "full_access", resource_owner_id: `sage-owner-${code}` });
    }
    // Google Calendar itself goes to the stand-in; anything else at a provider is a test mistake.
    if (url.startsWith("https://www.googleapis.com/calendar/v3") || url.startsWith("https://oauth2.googleapis.com/token")) {
      return inner(input, init);
    }
    if (/^https:\/\/([a-z0-9-]+\.)*(intuit|sage|sageone|googleapis|google)\.com/.test(url)) {
      throw new Error(`test: unexpected call to ${url}`);
    }
    return inner(input, init);
  }) as typeof fetch;
  restoreProviders = () => {
    google.restore();
  };
});
afterEach(() => restoreProviders());

// ---------------------------------------------------------------------------
// People, places, presses
// ---------------------------------------------------------------------------

let seq = 0;
const uniq = (p: string) => `${p}-${++seq}-${randomBytes(3).toString("hex")}`;

async function company(name = "Integrations Co") {
  const org = await addOrg(api.sql, name);
  await api.sql("update public.organizations set timezone = 'America/Regina' where id = $1", [org]);
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    admin: await addMember(api.sql, org, "admin", "Iryna"),
    olha: await addMember(api.sql, org, "manager", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    bea: await addMember(api.sql, org, "employee", "Bea"),
    client: await addClient(api.sql, org, "Margaret MacLeod"),
  };
}
type Co = Awaited<ReturnType<typeof company>>;

/** Signed in as this member; a redirect is an answer too. */
async function as<T>(m: Member, press: () => Promise<T>, email?: string): Promise<T | { redirected: string }> {
  request.cookies = api.sessionCookies(m.userId, email);
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
const redirectOf = (r: unknown) => (r as { redirected?: string }).redirected ?? "";
const cookie = (name: string) => request.cookies.find((c) => c.name === name)?.value;

/** The browser coming back from a provider: these cookies, this address. */
async function back(GET: (r: NextRequest) => Promise<Response>, path: string, cookies: Array<{ name: string; value: string }>): Promise<string> {
  request.cookies = [...cookies];
  const res = await GET(new NextRequest(`${SITE}${path}`));
  await settle();
  return res.headers.get("location") ?? `status ${res.status}`;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 15:00 UTC (9:00 in Regina), `days` from today. */
const at = (days: number, hourUtc = 15) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
};
const plus = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

async function job(c: Co, scheduledAt: string, opts: { crew?: Member[]; status?: string; eventId?: string | null } = {}) {
  const [b] = await api.sql<{ id: string }>(
    `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, google_calendar_event_id)
     values ($1, $2, $3::timestamptz, 120, 'standard', $4::public.booking_status, $5) returning id`,
    [c.org, c.client, scheduledAt, opts.status ?? "confirmed", opts.eventId ?? null],
  );
  for (const m of opts.crew ?? []) {
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, acceptance_status) values ($1, $2, $3, 'accepted')",
      [c.org, b.id, m.membershipId],
    );
  }
  return b.id;
}

type ConnRow = {
  id: string;
  membership_id: string | null;
  provider: string;
  status: string;
  external_account_id: string | null;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  metadata: Record<string, unknown>;
  connected_by: string | null;
};
const connections = (org: string, provider?: string) =>
  api.sql<ConnRow>(
    `select id, membership_id, provider::text as provider, status::text as status, external_account_id,
            access_token_ciphertext, refresh_token_ciphertext, metadata, connected_by
       from public.integration_connections
      where organization_id = $1 and ($2::text is null or provider::text = $2)
      order by connected_at, id`,
    [org, provider ?? null],
  );
const active = async (org: string, provider?: string) => (await connections(org, provider)).filter((r) => r.status === "active");

/** A connection made earlier, straight into the table. */
async function connected(
  org: string,
  provider: "google_calendar" | "quickbooks" | "sage",
  token: string,
  opts: { member?: Member | null; email?: string | null; metadata?: Record<string, unknown>; realm?: string } = {},
): Promise<string> {
  const [r] = await api.sql<{ id: string }>(
    `insert into public.integration_connections
       (organization_id, membership_id, provider, status, scope, external_account_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, metadata)
     values ($1, $2, $3::public.integration_provider, 'active', $4, $5, $6, $7, now() + interval '1 hour', $8::jsonb) returning id`,
    [
      org,
      opts.member?.membershipId ?? null,
      provider,
      provider === "google_calendar" ? FULL_SCOPE : null,
      opts.realm ?? opts.email ?? null,
      encryptSecret(token),
      encryptSecret(`refresh-${token}`),
      JSON.stringify(opts.metadata ?? (provider === "google_calendar" ? { calendar_id: "primary" } : {})),
    ],
  );
  return r.id;
}

const sollosEvents = (token: string) => [...google.calendar(token).values()].filter((e) => (e.description ?? "").includes("Managed by Sollos"));
const eventIdOf = async (booking: string) =>
  (await api.sql<{ e: string | null }>("select google_calendar_event_id as e from public.bookings where id = $1", [booking]))[0].e;

// ===========================================================================
// Google Calendar — the company's
// ===========================================================================

describe.skipIf(!hasPostgrest)("Google Calendar for the company (Settings)", { timeout: 120_000 }, () => {
  it("the owner's Connect goes to Google, and the callback saves an encrypted company calendar and fills it with upcoming jobs", async () => {
    const c = await company();
    const upcoming = await job(c, at(2), { crew: [c.anna] });
    const cancelled = await job(c, at(3), { status: "cancelled" });

    const go = await as(c.owner, () => gcalSettings.connectGoogleCalendarAction());
    const to = new URL(redirectOf(go));
    expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(to.searchParams.get("redirect_uri")).toBe(`${SITE}/api/integrations/google-calendar/callback`);
    const state = to.searchParams.get("state")!;
    expect(cookie("gcal_oauth_state"), "the same-site cookie the callback checks").toBe(state);
    const browser = [...request.cookies];

    const code = uniq("code");
    const token = uniq("tok-office");
    googleGrants.set(code, { token, email: "office@example.com" });
    const landed = await back(gcalCallback, `/api/integrations/google-calendar/callback?code=${code}&state=${encodeURIComponent(state)}`, browser);
    expect(landed, api.log().slice(-800)).toBe(`${SITE}/app/settings/integrations?gcal_connected=true`);
    expect(cookie("gcal_oauth_state"), "single use").toBeUndefined();

    const rows = await connections(c.org, "google_calendar");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ membership_id: null, status: "active", external_account_id: "office@example.com", metadata: { calendar_id: "primary" } });
    expect(rows[0].access_token_ciphertext).not.toContain(token);
    expect(decryptSecret(rows[0].access_token_ciphertext!)).toBe(token);
    expect(decryptSecret(rows[0].refresh_token_ciphertext!)).toBe(`refresh-${token}`);

    const events = sollosEvents(token);
    expect(events.map((e) => e.description?.includes(`/app/bookings/${upcoming}`))).toEqual([true]);
    expect(await eventIdOf(upcoming)).toBe(events[0].id);
    expect(await eventIdOf(cancelled)).toBeNull();
  });

  it("only an owner or an admin can start it; a manager and a cleaner are sent back with nothing set", async () => {
    const c = await company();
    expect(redirectOf(await as(c.admin, () => gcalSettings.connectGoogleCalendarAction()))).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(await as(c.olha, () => gcalSettings.connectGoogleCalendarAction())).toEqual({ redirected: "/app" });
    expect(cookie("gcal_oauth_state")).toBeUndefined();
    expect(await as(c.anna, () => gcalSettings.connectGoogleCalendarAction())).toEqual({ redirected: "/field" });
    expect(cookie("gcal_oauth_state")).toBeUndefined();
  });

  it("a callback naming another company's owner, from a different signed-in owner, connects nothing", async () => {
    const mine = await company("Mine");
    const theirs = await company("Theirs");
    const code = uniq("code");
    googleGrants.set(code, { token: uniq("tok"), email: "intruder@example.com" });
    const landed = await back(
      gcalCallback,
      `/api/integrations/google-calendar/callback?code=${code}&state=${theirs.owner.membershipId}`,
      api.sessionCookies(mine.owner.userId),
    );
    expect(landed).toContain("gcal_error=");
    expect(await connections(theirs.org)).toEqual([]);
    expect(await connections(mine.org)).toEqual([]);
    expect(exchanged.google, "the code is never even exchanged").toEqual([]);
  });

  // FIX-LATER: the Google Calendar OAuth state is the bare membership id, so a forged state cookie + state connects any company's calendar to the sender's Google account
  it.fails("a forged state cookie naming another company's owner cannot connect that company's calendar to the sender's Google account", async () => {
    const victim = await company("Victim Co");
    await job(victim, at(2));
    const code = uniq("code");
    const attackerToken = uniq("tok-attacker");
    googleGrants.set(code, { token: attackerToken, email: "attacker@example.com" });
    // Not signed in at all. The cookie is the attacker's own browser's, set by hand.
    const landed = await back(
      gcalCallback,
      `/api/integrations/google-calendar/callback?code=${code}&state=${victim.owner.membershipId}`,
      [{ name: "gcal_oauth_state", value: victim.owner.membershipId }],
    );
    expect(await active(victim.org, "google_calendar"), "no connection for the victim").toEqual([]);
    expect(sollosEvents(attackerToken), "none of the victim's jobs on the attacker's calendar").toEqual([]);
    expect(landed).toContain("gcal_error=");
  });

  // FIX-LATER: same cause: with no state cookie the callback falls back to "is this the signed-in owner's membership id?", so a link carrying her (non-secret) id and someone else's code connects her company to that Google account
  it.fails("a callback the owner never started (no state cookie) is refused, so a link can't connect her company to someone else's Google account", async () => {
    const c = await company();
    const code = uniq("code");
    const attackerToken = uniq("tok-attacker");
    googleGrants.set(code, { token: attackerToken, email: "attacker@example.com" });
    const landed = await back(
      gcalCallback,
      `/api/integrations/google-calendar/callback?code=${code}&state=${c.owner.membershipId}`,
      api.sessionCookies(c.owner.userId),
    );
    expect(await active(c.org, "google_calendar")).toEqual([]);
    expect(landed).toContain("gcal_error=");
  });

  it("denied consent, a missing code and an email-only grant each come back as an error and save nothing", async () => {
    const c = await company();
    const session = api.sessionCookies(c.owner.userId);
    const base = "/api/integrations/google-calendar/callback";
    expect(await back(gcalCallback, `${base}?error=access_denied&state=${c.owner.membershipId}`, session)).toBe(
      `${SITE}/app/settings/integrations?gcal_error=access_denied`,
    );
    expect(await back(gcalCallback, `${base}?state=${c.owner.membershipId}`, session)).toContain(
      `gcal_error=${encodeURIComponent("Missing authorization code")}`,
    );
    const code = uniq("code");
    googleGrants.set(code, { token: uniq("tok"), email: "office@example.com", scope: "openid https://www.googleapis.com/auth/userinfo.email" });
    const stateCookie = { name: "gcal_oauth_state", value: c.owner.membershipId };
    expect(await back(gcalCallback, `${base}?code=${code}&state=${c.owner.membershipId}`, [...session, stateCookie])).toContain(
      `gcal_error=${encodeURIComponent("Calendar access wasn't granted.")}`.replace("'", "%27"),
    );
    expect(await connections(c.org)).toEqual([]);
  });

  it("reconnecting the same Google account rotates the tokens in place", async () => {
    const c = await company();
    const oldToken = uniq("tok-old");
    const id = await connected(c.org, "google_calendar", oldToken, { email: "office@example.com" });
    const code = uniq("code");
    const newToken = uniq("tok-new");
    googleGrants.set(code, { token: newToken, email: "office@example.com" });
    const landed = await back(
      gcalCallback,
      `/api/integrations/google-calendar/callback?code=${code}&state=${c.owner.membershipId}`,
      [...api.sessionCookies(c.owner.userId), { name: "gcal_oauth_state", value: c.owner.membershipId }],
    );
    expect(landed).toContain("gcal_connected=true");
    const rows = await connections(c.org, "google_calendar");
    expect(rows.map((r) => [r.id, r.status])).toEqual([[id, "active"]]);
    expect(decryptSecret(rows[0].access_token_ciphertext!)).toBe(newToken);
  });

  // FIX-LATER: getConnection caches a company's token for 30s; the switch-account callback reads it during cleanup, then re-pushes every job with the OLD token, so the old calendar gets them back and the new one stays empty
  it.fails("reconnecting with a different Google account moves the company's jobs to the new calendar", async () => {
    const c = await company();
    const oldToken = uniq("tok-a");
    await connected(c.org, "google_calendar", oldToken, { email: "old@example.com" });
    const start = at(2);
    const b = await job(c, start);
    const oldEvent = google.put(oldToken, { summary: "Standard clean", description: `Managed by Sollos — /app/bookings/${b}`, start: { dateTime: start }, end: { dateTime: plus(start, 120) } });
    await api.sql("update public.bookings set google_calendar_event_id = $2 where id = $1", [b, oldEvent.id]);

    const code = uniq("code");
    const newToken = uniq("tok-b");
    googleGrants.set(code, { token: newToken, email: "new@example.com" });
    const landed = await back(
      gcalCallback,
      `/api/integrations/google-calendar/callback?code=${code}&state=${c.owner.membershipId}`,
      [...api.sessionCookies(c.owner.userId), { name: "gcal_oauth_state", value: c.owner.membershipId }],
    );
    expect(landed).toContain("gcal_connected=true");
    expect((await connections(c.org, "google_calendar")).map((r) => [r.external_account_id, r.status])).toEqual([
      ["old@example.com", "disconnected"],
      ["new@example.com", "active"],
    ]);
    expect(google.calendar(oldToken).has(oldEvent.id), "the old event was taken off").toBe(false);
    // Fails here today: the job was pushed again, with the old token, onto the calendar just cleaned.
    expect(sollosEvents(oldToken), "the old calendar is left clean").toEqual([]);
    expect(sollosEvents(newToken).map((e) => e.description?.includes(b)), "the job is on the new calendar").toEqual([true]);
  });

  it("Disconnect takes the company's events off its calendar, clears the links and switches it off, for owners and admins only", async () => {
    const c = await company();
    const other = await company("Other Co");
    const token = uniq("tok-office");
    await connected(c.org, "google_calendar", token, { email: "office@example.com" });
    await connected(other.org, "google_calendar", uniq("tok-other"));
    const start = at(2);
    const b = await job(c, start);
    const ev = google.put(token, { summary: "Standard clean", description: `Managed by Sollos — /app/bookings/${b}`, start: { dateTime: start }, end: { dateTime: plus(start, 120) } });
    await api.sql("update public.bookings set google_calendar_event_id = $2 where id = $1", [b, ev.id]);
    const dentist = google.put(token, { summary: "Dentist", start: { dateTime: at(2, 20) }, end: { dateTime: at(2, 21) } });

    expect(await as(c.anna, () => gcalSettings.disconnectGoogleCalendarAction())).toEqual({ redirected: "/field" });
    expect(await as(c.olha, () => gcalSettings.disconnectGoogleCalendarAction())).toEqual({ redirected: "/app" });
    expect(await active(c.org, "google_calendar")).toHaveLength(1);
    expect(google.calendar(token).has(ev.id)).toBe(true);

    await as(c.owner, () => gcalSettings.disconnectGoogleCalendarAction());
    expect(google.calendar(token).has(ev.id)).toBe(false);
    expect(google.calendar(token).has(dentist.id), "her own events stay").toBe(true);
    expect(await eventIdOf(b)).toBeNull();
    expect((await connections(c.org, "google_calendar")).map((r) => r.status)).toEqual(["disconnected"]);
    expect(await active(other.org, "google_calendar"), "another company's stays on").toHaveLength(1);
  });

  // FIX-LATER: disconnectGoogleCalendarAction has no membership_id IS NULL filter, so the company's Disconnect also switches off every cleaner's personal calendar (and leaves their events stranded on it)
  it.fails("the company's Disconnect leaves each cleaner's own calendar connected", async () => {
    const c = await company();
    await connected(c.org, "google_calendar", uniq("tok-office"));
    await connected(c.org, "google_calendar", uniq("tok-anna"), { member: c.anna });
    await as(c.owner, () => gcalSettings.disconnectGoogleCalendarAction());
    const rows = await connections(c.org, "google_calendar");
    expect(rows.find((r) => r.membership_id === null)?.status).toBe("disconnected");
    expect(rows.find((r) => r.membership_id === c.anna.membershipId)?.status, "Anna's own calendar").toBe("active");
  });
});

// ===========================================================================
// Google Calendar — a cleaner's own (Field → Profile)
// ===========================================================================

describe.skipIf(!hasPostgrest)("a cleaner's own Google Calendar (Field → Profile)", { timeout: 120_000 }, () => {
  it("a cleaner connects her own calendar: the callback saves it under her membership and puts her jobs on it", async () => {
    const c = await company();
    const officeToken = uniq("tok-office");
    await connected(c.org, "google_calendar", officeToken);
    const hers = await job(c, at(2), { crew: [c.anna] });
    await job(c, at(2, 20), { crew: [c.bea] });
    await job(c, at(3), { crew: [c.anna], status: "cancelled" });
    const past = await job(c, at(-2), { crew: [c.anna] });

    const go = await as(c.anna, () => profile.connectMyGoogleCalendarAction());
    const to = new URL(redirectOf(go));
    expect(to.hostname).toBe("accounts.google.com");
    expect(to.searchParams.get("state")).toBe(`mbr:${c.anna.membershipId}`);
    expect(cookie("gcal_member_oauth_state")).toBe(c.anna.membershipId);
    const browser = [...request.cookies];

    const code = uniq("code");
    const token = uniq("tok-anna");
    googleGrants.set(code, { token, email: "anna@example.com" });
    const landed = await back(gcalCallback, `/api/integrations/google-calendar/callback?code=${code}&state=${encodeURIComponent(`mbr:${c.anna.membershipId}`)}`, browser);
    expect(landed, api.log().slice(-800)).toBe(`${SITE}/field/profile?gcal_connected=true`);

    const rows = await active(c.org, "google_calendar");
    expect(rows.map((r) => r.membership_id).sort()).toEqual([null, c.anna.membershipId].sort());
    const mine = rows.find((r) => r.membership_id === c.anna.membershipId)!;
    expect(mine.external_account_id).toBe("anna@example.com");
    expect(decryptSecret(mine.access_token_ciphertext!)).toBe(token);

    const events = sollosEvents(token);
    expect(events.map((e) => /\/field\/jobs\/([0-9a-f-]{36})/.exec(e.description ?? "")?.[1])).toEqual([hers]);
    expect(events.some((e) => e.description?.includes(past))).toBe(false);
    const maps = await api.sql<{ booking_id: string }>("select booking_id from public.booking_member_calendar_events where membership_id = $1", [c.anna.membershipId]);
    expect(maps.map((m) => m.booking_id)).toEqual([hers]);
    expect(sollosEvents(officeToken), "the company calendar isn't touched").toEqual([]);
  });

  it("a callback naming a teammate's membership, from her own session, connects nothing", async () => {
    const c = await company();
    const code = uniq("code");
    googleGrants.set(code, { token: uniq("tok-bea"), email: "bea@example.com" });
    const landed = await back(
      gcalCallback,
      `/api/integrations/google-calendar/callback?code=${code}&state=${encodeURIComponent(`mbr:${c.anna.membershipId}`)}`,
      api.sessionCookies(c.bea.userId),
    );
    expect(landed).toBe(`${SITE}/field/profile?gcal_error=${encodeURIComponent("Invalid session — please try again")}`);
    expect(await connections(c.org)).toEqual([]);
  });

  // FIX-LATER: same cause as the company flow: the member state is "mbr:<membership id>" and the cookie path checks nothing else, so a teammate who sets her own cookie takes over another cleaner's calendar connection (wiping her events)
  it.fails("a teammate who sets her own state cookie to Anna's membership can't take over Anna's calendar", async () => {
    const c = await company();
    const annaToken = uniq("tok-anna");
    await connected(c.org, "google_calendar", annaToken, { member: c.anna, email: "anna@example.com" });
    const code = uniq("code");
    const beaToken = uniq("tok-bea");
    googleGrants.set(code, { token: beaToken, email: "bea@example.com" });
    await back(
      gcalCallback,
      `/api/integrations/google-calendar/callback?code=${code}&state=${encodeURIComponent(`mbr:${c.anna.membershipId}`)}`,
      [...api.sessionCookies(c.bea.userId), { name: "gcal_member_oauth_state", value: c.anna.membershipId }],
    );
    const annas = (await active(c.org, "google_calendar")).filter((r) => r.membership_id === c.anna.membershipId);
    expect(annas.map((r) => r.external_account_id)).toEqual(["anna@example.com"]);
    expect(decryptSecret(annas[0].access_token_ciphertext!)).toBe(annaToken);
  });

  // FIX-LATER: getMemberConnection's 30s token cache: switching her calendar to another Google account re-pushes her jobs with the OLD token, onto the calendar she just left
  it.fails("switching her calendar to another Google account puts her jobs on the new one", async () => {
    const c = await company();
    const oldToken = uniq("tok-anna-old");
    await connected(c.org, "google_calendar", oldToken, { member: c.anna, email: "anna.old@example.com" });
    const start = at(2);
    const b = await job(c, start, { crew: [c.anna] });
    const ev = google.put(oldToken, { summary: "standard clean", description: `\nManaged by Sollos — /field/jobs/${b}`, start: { dateTime: start }, end: { dateTime: plus(start, 120) } });
    await api.sql("insert into public.booking_member_calendar_events (booking_id, membership_id, google_calendar_event_id) values ($1, $2, $3)", [b, c.anna.membershipId, ev.id]);

    const code = uniq("code");
    const newToken = uniq("tok-anna-new");
    googleGrants.set(code, { token: newToken, email: "anna.new@example.com" });
    const landed = await back(
      gcalCallback,
      `/api/integrations/google-calendar/callback?code=${code}&state=${encodeURIComponent(`mbr:${c.anna.membershipId}`)}`,
      [...api.sessionCookies(c.anna.userId), { name: "gcal_member_oauth_state", value: c.anna.membershipId }],
    );
    expect(landed).toContain("gcal_connected=true");
    expect(google.calendar(oldToken).has(ev.id), "the old event was taken off").toBe(false);
    // Fails here today: her job was pushed again, with the old token, onto the calendar she left.
    expect(sollosEvents(oldToken)).toEqual([]);
    expect(sollosEvents(newToken).map((e) => e.description?.includes(b))).toEqual([true]);
  });

  it("Re-sync, pressed by the cleaner, puts back a job missing from her calendar without doubling the one already there", async () => {
    const c = await company();
    const token = uniq("tok-anna");
    await connected(c.org, "google_calendar", token, { member: c.anna });
    const s1 = at(2);
    const there = await job(c, s1, { crew: [c.anna] });
    const ev = google.put(token, { summary: "standard clean", description: `\nManaged by Sollos — /field/jobs/${there}`, start: { dateTime: s1 }, end: { dateTime: plus(s1, 120) } });
    await api.sql("insert into public.booking_member_calendar_events (booking_id, membership_id, google_calendar_event_id) values ($1, $2, $3)", [there, c.anna.membershipId, ev.id]);
    const missing = await job(c, at(4), { crew: [c.anna] });

    await as(c.anna, () => profile.resyncMyGoogleCalendarAction());
    const ids = sollosEvents(token).map((e) => /\/field\/jobs\/([0-9a-f-]{36})/.exec(e.description ?? "")?.[1]).sort();
    expect(ids, api.log().slice(-500)).toEqual([there, missing].sort());
    const maps = await api.sql<{ booking_id: string }>("select booking_id from public.booking_member_calendar_events where membership_id = $1", [c.anna.membershipId]);
    expect(maps.map((m) => m.booking_id).sort()).toEqual([there, missing].sort());
  });

  it("Disconnect, pressed by the cleaner, takes her jobs off her calendar and switches off only her connection", async () => {
    const c = await company();
    const annaToken = uniq("tok-anna");
    await connected(c.org, "google_calendar", uniq("tok-office"));
    await connected(c.org, "google_calendar", annaToken, { member: c.anna });
    await connected(c.org, "google_calendar", uniq("tok-bea"), { member: c.bea });
    const start = at(2);
    const b = await job(c, start, { crew: [c.anna, c.bea] });
    const ev = google.put(annaToken, { summary: "standard clean", description: `\nManaged by Sollos — /field/jobs/${b}`, start: { dateTime: start }, end: { dateTime: plus(start, 120) } });
    await api.sql("insert into public.booking_member_calendar_events (booking_id, membership_id, google_calendar_event_id) values ($1, $2, $3), ($1, $4, 'bea-event')", [
      b,
      c.anna.membershipId,
      ev.id,
      c.bea.membershipId,
    ]);
    const pilates = google.put(annaToken, { summary: "Pilates", start: { dateTime: at(3, 1) }, end: { dateTime: at(3, 2) } });

    await as(c.anna, () => profile.disconnectMyGoogleCalendarAction());
    expect(google.calendar(annaToken).has(ev.id)).toBe(false);
    expect(google.calendar(annaToken).has(pilates.id)).toBe(true);
    const maps = await api.sql<{ membership_id: string }>("select membership_id from public.booking_member_calendar_events where booking_id = $1", [b]);
    expect(maps.map((m) => m.membership_id)).toEqual([c.bea.membershipId]);
    const rows = await connections(c.org, "google_calendar");
    expect(rows.find((r) => r.membership_id === c.anna.membershipId)?.status).toBe("disconnected");
    expect(rows.find((r) => r.membership_id === c.bea.membershipId)?.status).toBe("active");
    expect(rows.find((r) => r.membership_id === null)?.status).toBe("active");
  });

  it("what her calendar shows: a cleaner keeps her own jobs and picks a colour; showing every job is for managers", async () => {
    const c = await company();
    const scopeOf = async (m: Member) =>
      (await api.sql<{ s: string; c: string }>("select calendar_scope as s, calendar_color as c from public.memberships where id = $1", [m.membershipId]))[0];
    const f = (scope: string, color: string) => {
      const d = new FormData();
      d.set("calendar_scope", scope);
      d.set("calendar_color", color);
      return d;
    };

    expect(await as(c.anna, () => profile.updateCalendarScopeAction({}, f("all", "3")))).toEqual({ error: "Only managers can show all organization jobs." });
    expect(await scopeOf(c.anna)).toEqual({ s: "mine", c: "6" });
    expect(await as(c.anna, () => profile.updateCalendarScopeAction({}, f("mine", "9")))).toEqual({ ok: true });
    expect(await scopeOf(c.anna)).toEqual({ s: "mine", c: "9" });
    expect(await as(c.anna, () => profile.updateCalendarScopeAction({}, f("mine", "99")))).toEqual({ ok: true });
    expect((await scopeOf(c.anna)).c, "not a Google colour: back to the default").toBe("6");
    expect(await scopeOf(c.bea), "nobody else's changed").toEqual({ s: "mine", c: "6" });

    // A manager with a calendar connected: every job shows, hers in her colour.
    const token = uniq("tok-olha");
    await connected(c.org, "google_calendar", token, { member: c.olha });
    const own = await job(c, at(1), { crew: [c.olha] });
    const others = await job(c, at(1, 20), { crew: [c.anna] });
    expect(await as(c.olha, () => profile.updateCalendarScopeAction({}, f("all", "3")))).toEqual({ ok: true });
    expect(await scopeOf(c.olha)).toEqual({ s: "all", c: "3" });
    const byBooking = new Map(sollosEvents(token).map((e) => [/\/field\/jobs\/([0-9a-f-]{36})/.exec(e.description ?? "")?.[1], e]));
    expect([...byBooking.keys()].sort(), api.log().slice(-500)).toEqual([own, others].sort());
    expect(byBooking.get(own)?.colorId).toBe("3");
    expect(byBooking.get(others)?.colorId).toBeUndefined();
  });
});

// ===========================================================================
// QuickBooks
// ===========================================================================

const stateRows = (table: "quickbooks_oauth_states" | "sage_oauth_states", org: string) =>
  api.sql<{ state: string; membership_id: string; consumed_at: string | null }>(
    `select state, membership_id, consumed_at from public.${table} where organization_id = $1`,
    [org],
  );

describe.skipIf(!hasPostgrest)("QuickBooks (Settings)", { timeout: 120_000 }, () => {
  it("Connect stores a one-time state for this owner's company; the callback saves the QuickBooks company against it, once", async () => {
    const c = await company();
    const go = await as(c.owner, () => qbSettings.connectQuickBooksAction());
    const to = new URL(redirectOf(go));
    expect(to.origin + to.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
    const state = to.searchParams.get("state")!;
    expect(state).not.toContain(c.owner.membershipId);
    expect(await stateRows("quickbooks_oauth_states", c.org)).toEqual([{ state, membership_id: c.owner.membershipId, consumed_at: null }]);

    const session = api.sessionCookies(c.owner.userId);
    const path = `/api/integrations/quickbooks/callback?code=qb1&state=${encodeURIComponent(state)}&realmId=9130355`;
    expect(await back(qbCallback, path, session), api.log().slice(-500)).toBe(`${SITE}/app/settings/integrations?qb_connected=true`);
    const rows = await connections(c.org, "quickbooks");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", external_account_id: "9130355", connected_by: c.owner.membershipId, membership_id: null });
    expect(decryptSecret(rows[0].access_token_ciphertext!)).toBe("qb-access-qb1");
    expect(decryptSecret(rows[0].refresh_token_ciphertext!)).toBe("qb-refresh-qb1");
    expect((await stateRows("quickbooks_oauth_states", c.org))[0].consumed_at).not.toBeNull();

    // The browser asks for the same address again (prefetch, refresh).
    expect(await back(qbCallback, path, session)).toBe(`${SITE}/app/settings/integrations?qb_connected=true`);
    expect(exchanged.qb, "the code is exchanged once").toEqual(["qb1"]);
    expect(await connections(c.org, "quickbooks")).toHaveLength(1);

    // Connecting again replaces it; one active connection.
    const again = new URL(redirectOf(await as(c.admin, () => qbSettings.connectQuickBooksAction()))).searchParams.get("state")!;
    await back(qbCallback, `/api/integrations/quickbooks/callback?code=qb2&state=${encodeURIComponent(again)}&realmId=9130355`, api.sessionCookies(c.admin.userId));
    expect((await connections(c.org, "quickbooks")).map((r) => r.status)).toEqual(["disconnected", "active"]);
  });

  it("a manager or a cleaner can't start it", async () => {
    const c = await company();
    expect(await as(c.olha, () => qbSettings.connectQuickBooksAction())).toEqual({ redirected: "/app" });
    expect(await as(c.anna, () => qbSettings.connectQuickBooksAction())).toEqual({ redirected: "/field" });
    expect(await stateRows("quickbooks_oauth_states", c.org)).toEqual([]);
  });

  it("a forged, an expired, another company's or a signed-out callback connects nothing", async () => {
    const c = await company();
    const other = await company("Other Co");
    const session = api.sessionCookies(c.owner.userId);
    const cb = (state: string, realm = "4620816") => `/api/integrations/quickbooks/callback?code=${uniq("qb")}&state=${encodeURIComponent(state)}&realmId=${realm}`;

    expect(await back(qbCallback, cb("made-up-state"), session)).toContain(`qb_error=${encodeURIComponent("Invalid or expired session — please try again")}`);
    await api.sql(
      "insert into public.quickbooks_oauth_states (state, organization_id, membership_id, expires_at) values ('qb-expired-1', $1, $2, now() - interval '1 minute')",
      [c.org, c.owner.membershipId],
    );
    expect(await back(qbCallback, cb("qb-expired-1"), session)).toContain("took%20too%20long");
    // Issued to the other company's owner; presented by this one.
    await api.sql("insert into public.quickbooks_oauth_states (state, organization_id, membership_id) values ('qb-theirs-1', $1, $2)", [
      other.org,
      other.owner.membershipId,
    ]);
    expect(await back(qbCallback, cb("qb-theirs-1"), session)).toContain(`qb_error=${encodeURIComponent("Invalid session — please try again")}`);
    // Signed out entirely.
    await api.sql("insert into public.quickbooks_oauth_states (state, organization_id, membership_id) values ('qb-mine-1', $1, $2)", [c.org, c.owner.membershipId]);
    expect(await back(qbCallback, cb("qb-mine-1"), [])).toBe(`${SITE}/login`);
    expect(await back(qbCallback, `/api/integrations/quickbooks/callback?code=x&state=qb-mine-1`, session)).toContain("company%20id");
    // A state issued to someone who has since been made a manager.
    await api.sql("insert into public.quickbooks_oauth_states (state, organization_id, membership_id) values ('qb-demoted-1', $1, $2)", [c.org, c.admin.membershipId]);
    await api.sql("update public.memberships set role = 'manager' where id = $1", [c.admin.membershipId]);
    expect(await back(qbCallback, cb("qb-demoted-1"), api.sessionCookies(c.admin.userId))).toContain("qb_error=");

    expect(await connections(c.org)).toEqual([]);
    expect(await connections(other.org)).toEqual([]);
    expect(exchanged.qb).toEqual([]);
  });

  it("Disconnect switches off this company's QuickBooks only, for owners and admins", async () => {
    const c = await company();
    const other = await company("Other Co");
    await connected(c.org, "quickbooks", "qb-tok", { realm: "111" });
    await connected(other.org, "quickbooks", "qb-tok-2", { realm: "222" });
    expect(await as(c.anna, () => qbSettings.disconnectQuickBooksAction())).toEqual({ redirected: "/field" });
    expect(await as(c.olha, () => qbSettings.disconnectQuickBooksAction())).toEqual({ redirected: "/app" });
    expect(await active(c.org, "quickbooks")).toHaveLength(1);
    await as(c.owner, () => qbSettings.disconnectQuickBooksAction());
    expect((await connections(c.org, "quickbooks")).map((r) => r.status)).toEqual(["disconnected"]);
    expect(await active(other.org, "quickbooks")).toHaveLength(1);
  });
});

// ===========================================================================
// Sage
// ===========================================================================

describe.skipIf(!hasPostgrest)("Sage (Settings)", { timeout: 120_000 }, () => {
  it("Connect stores a one-time state for this owner's company; the callback saves the Sage business against it, once", async () => {
    const c = await company();
    const go = await as(c.owner, () => sageSettings.connectSageAction());
    const to = new URL(redirectOf(go));
    expect(to.origin + to.pathname).toBe("https://www.sageone.com/oauth2/auth/central");
    expect(to.searchParams.get("redirect_uri")).toBe(`${SITE}/api/integrations/sage/callback`);
    const state = to.searchParams.get("state")!;
    expect(await stateRows("sage_oauth_states", c.org)).toEqual([{ state, membership_id: c.owner.membershipId, consumed_at: null }]);

    const session = api.sessionCookies(c.owner.userId);
    const path = `/api/integrations/sage/callback?code=sg1&state=${encodeURIComponent(state)}`;
    expect(await back(sageCallback, path, session), api.log().slice(-500)).toBe(`${SITE}/app/settings/integrations?sage_connected=true`);
    const rows = await connections(c.org, "sage");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", external_account_id: "sage-owner-sg1", connected_by: c.owner.membershipId });
    expect(decryptSecret(rows[0].access_token_ciphertext!)).toBe("sage-access-sg1");
    expect(decryptSecret(rows[0].refresh_token_ciphertext!)).toBe("sage-refresh-sg1");

    expect(await back(sageCallback, path, session)).toBe(`${SITE}/app/settings/integrations?sage_connected=true`);
    expect(exchanged.sage).toEqual(["sg1"]);
  });

  it("a manager or a cleaner can't start it; a forged, expired or another company's callback connects nothing", async () => {
    const c = await company();
    const other = await company("Other Co");
    expect(await as(c.olha, () => sageSettings.connectSageAction())).toEqual({ redirected: "/app" });
    expect(await as(c.anna, () => sageSettings.connectSageAction())).toEqual({ redirected: "/field" });
    expect(await stateRows("sage_oauth_states", c.org)).toEqual([]);

    const session = api.sessionCookies(c.owner.userId);
    const cb = (state: string) => `/api/integrations/sage/callback?code=${uniq("sg")}&state=${encodeURIComponent(state)}`;
    expect(await back(sageCallback, cb("made-up"), session)).toContain("sage_error=");
    await api.sql("insert into public.sage_oauth_states (state, organization_id, membership_id, expires_at) values ('sg-expired-1', $1, $2, now() - interval '1 minute')", [
      c.org,
      c.owner.membershipId,
    ]);
    expect(await back(sageCallback, cb("sg-expired-1"), session)).toContain("took%20too%20long");
    await api.sql("insert into public.sage_oauth_states (state, organization_id, membership_id) values ('sg-theirs-1', $1, $2)", [other.org, other.owner.membershipId]);
    expect(await back(sageCallback, cb("sg-theirs-1"), session)).toContain(`sage_error=${encodeURIComponent("Invalid session — please try again")}`);
    await api.sql("insert into public.sage_oauth_states (state, organization_id, membership_id) values ('sg-mine-1', $1, $2)", [c.org, c.owner.membershipId]);
    expect(await back(sageCallback, cb("sg-mine-1"), [])).toBe(`${SITE}/login`);

    expect(await connections(c.org)).toEqual([]);
    expect(await connections(other.org)).toEqual([]);
    expect(exchanged.sage).toEqual([]);
  });

  it("the tax region is saved on this company's Sage connection, for owners and admins, and refused when Sage isn't connected", async () => {
    const c = await company();
    const other = await company("Other Co");
    expect(await as(c.owner, () => sageSettings.saveSageTaxRegionAction("CA-SK"))).toEqual({
      ok: false,
      error: "Sage isn't connected — connect it first, then set the region.",
    });
    await connected(c.org, "sage", "sage-tok", { metadata: { sales_ledger_account_id: "la-sales" } });
    await connected(other.org, "sage", "sage-tok-2", { metadata: { tax_address_region_id: "CA-ON" } });

    expect(await as(c.owner, () => sageSettings.saveSageTaxRegionAction("   "))).toEqual({ ok: false, error: "Pick a tax region first." });
    expect(await as(c.owner, () => sageSettings.saveSageTaxRegionAction("X".repeat(33)))).toEqual({ ok: false, error: "That doesn't look like a Sage region id." });
    expect(await as(c.olha, () => sageSettings.saveSageTaxRegionAction("CA-AB"))).toEqual({ redirected: "/app" });
    expect(await as(c.anna, () => sageSettings.saveSageTaxRegionAction("CA-AB"))).toEqual({ redirected: "/field" });
    expect(await as(c.admin, () => sageSettings.saveSageTaxRegionAction(" CA-SK "))).toEqual({ ok: true });

    expect((await active(c.org, "sage"))[0].metadata).toEqual({ sales_ledger_account_id: "la-sales", tax_address_region_id: "CA-SK" });
    expect((await active(other.org, "sage"))[0].metadata).toEqual({ tax_address_region_id: "CA-ON" });
  });

  it("the account map saves the owner's picks, clears a blank one back to auto-detect, and keeps everything else on the connection", async () => {
    const c = await company();
    expect(await as(c.owner, () => sageSettings.saveSageAccountMapAction({ sales_ledger_account_id: "abc" }))).toEqual({
      ok: false,
      error: "Sage isn't connected — connect it first.",
    });
    await connected(c.org, "sage", "sage-tok", {
      metadata: { tax_address_region_id: "CA-SK", bank_account_id: "bank-auto", reconcile_skip: { x: { reason: "r", at: "t" } } },
    });

    expect(await as(c.owner, () => sageSettings.saveSageAccountMapAction({ sales_ledger_account_id: "4000; drop table" }))).toEqual({
      ok: false,
      error: "That doesn't look like a Sage account id.",
    });
    expect(await as(c.olha, () => sageSettings.saveSageAccountMapAction({ sales_ledger_account_id: "abc" }))).toEqual({ redirected: "/app" });
    expect(
      await as(c.owner, () =>
        sageSettings.saveSageAccountMapAction({ sales_ledger_account_id: "la-sales-9", payroll_wages_ledger_account_id: " la-wages ", bank_account_id: "" }),
      ),
    ).toEqual({ ok: true });
    expect((await active(c.org, "sage"))[0].metadata).toEqual({
      tax_address_region_id: "CA-SK",
      reconcile_skip: { x: { reason: "r", at: "t" } },
      sales_ledger_account_id: "la-sales-9",
      payroll_wages_ledger_account_id: "la-wages",
    });
  });

  it("Disconnect switches off this company's Sage only, for owners and admins", async () => {
    const c = await company();
    const other = await company("Other Co");
    await connected(c.org, "sage", "sage-tok");
    await connected(other.org, "sage", "sage-tok-2");
    expect(await as(c.anna, () => sageSettings.disconnectSageAction())).toEqual({ redirected: "/field" });
    expect(await active(c.org, "sage")).toHaveLength(1);
    await as(c.admin, () => sageSettings.disconnectSageAction());
    expect((await connections(c.org, "sage")).map((r) => r.status)).toEqual(["disconnected"]);
    expect(await active(other.org, "sage")).toHaveLength(1);
  });
});

// ===========================================================================
// "Request an integration"
// ===========================================================================

describe.skipIf(!hasPostgrest)("Request an integration (Settings)", () => {
  it("emails support with the company's name and the sender as reply-to; an empty or overlong message is refused", async () => {
    const c = await company("Prairie Shine");
    const [{ name }] = await api.sql<{ name: string }>("select name from public.organizations where id = $1", [c.org]);
    const f = (message: string) => {
      const d = new FormData();
      d.set("message", message);
      return d;
    };
    expect(await as(c.owner, () => requestIntegrationAction(f("   ")), "owner@example.com")).toEqual({ ok: false, error: "Please add a short message first." });
    expect(await as(c.owner, () => requestIntegrationAction(f("x".repeat(2001))), "owner@example.com")).toMatchObject({ ok: false });
    expect(outbox.email).toHaveLength(0);

    expect(await as(c.owner, () => requestIntegrationAction(f("Can you connect <Jobber>?\nThanks")), "owner@example.com")).toEqual({ ok: true });
    expect(outbox.email).toHaveLength(1);
    const [mail] = outbox.email;
    expect(mail).toMatchObject({ to: "support@sollos3.com", subject: `Integration request — ${name}`, replyTo: "owner@example.com" });
    expect(mail.html).toContain("&lt;Jobber&gt;");
    expect(mail.html).not.toContain("<Jobber>");
    expect(mail.text).toContain(`Org: ${name}`);
  });
});

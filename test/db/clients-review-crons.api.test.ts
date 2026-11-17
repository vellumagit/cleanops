/**
 * The three daily jobs that write to clients after a clean, run as Vercel
 * runs them (GET with the cron secret) against a real database behind the
 * real PostgREST. Outbound email is caught.
 *
 *   booking-review-requests   "How did we do?" after a finished job
 *   gbp-review-requests       the Google review ask, then reminders
 *   rebooking-prompt          "It's been a while" to a client with nothing booked
 *
 * What each owes: ask each client once (and again only on the cadence it
 * promises), never someone who opted out, and nothing at all for a company
 * that hasn't switched it on. Svit's house contact default is "none", so a
 * company here is set to "email" when a send is wanted.
 *
 * These jobs read every company at once, so the two tests that fill the
 * database with hundreds of rows run last.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg } from "./harness";
import { request, settle } from "./next-stubs";

type Sent = { to: string; subject: string; text?: string; html?: string; unsubscribeUrl?: string };
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
  sendOrgEmail: async (_o: string, a: Sent) => {
    outbox.email.push(a);
    return true;
  },
  sendOrgEmailDetailed: async (_o: string, a: Sent) => {
    outbox.email.push(a);
    return { ok: true, id: "re_test" };
  },
}));

const { GET: bookingReviewCron } = await import("@/app/api/cron/booking-review-requests/route");
const { GET: gbpCron } = await import("@/app/api/cron/gbp-review-requests/route");
const { GET: rebookingCron } = await import("@/app/api/cron/rebooking-prompt/route");
const gbpUnsubscribe = await import("@/app/api/u/g/[token]/route");
const marketingUnsubscribe = await import("@/app/api/u/m/[token]/route");
const { resetGbpAction } = await import("@/app/app/clients/actions");

let api: Api;
let restoreEnv: () => void;
const CRON_SECRET = "client-review-crons-test-secret";

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  process.env.CRON_SECRET = CRON_SECRET;
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  outbox.email.length = 0;
});

async function cron(get: (r: NextRequest) => Promise<Response>, path: string, secret = CRON_SECRET) {
  const res = await get(new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${secret}` } }));
  await settle();
  return res;
}
const BOOKING_REVIEWS = (s = CRON_SECRET) => cron(bookingReviewCron, "/api/cron/booking-review-requests", s);
const GBP = () => cron(gbpCron, "/api/cron/gbp-review-requests");
const REBOOKING = () => cron(rebookingCron, "/api/cron/rebooking-prompt");

let seq = 0;
async function company(settings: Record<string, unknown>, opts: { contactDefault?: string; reviewUrl?: string | null } = {}) {
  const org = await addOrg(api.sql, "Review Co");
  await api.sql(
    `update public.organizations
        set timezone = 'America/Regina', automations_enabled = true, automation_settings = $2::jsonb,
            default_contact_preference = $3, google_review_url = $4
      where id = $1`,
    [org, JSON.stringify(settings), opts.contactDefault ?? "email", opts.reviewUrl === undefined ? "https://g.page/r/review-co" : opts.reviewUrl],
  );
  return { org, owner: await addMember(api.sql, org, "owner", "Svitlana"), anna: await addMember(api.sql, org, "employee", "Anna") };
}
type Co = Awaited<ReturnType<typeof company>>;

async function person(c: Co, name: string, fields: Record<string, unknown> = {}) {
  const id = await addClient(api.sql, c.org, name);
  const cols: Record<string, unknown> = { email: `${name.toLowerCase().replace(/\W+/g, ".")}.${++seq}@example.com`, ...fields };
  const keys = Object.keys(cols);
  await api.sql(
    `update public.clients set ${keys.map((k, i) => `${k} = $${i + 2}${k === "contact_overrides" ? "::jsonb" : ""}`).join(", ")} where id = $1`,
    [id, ...Object.values(cols).map((v) => (v && typeof v === "object" ? JSON.stringify(v) : v))],
  );
  const [{ email }] = await api.sql<{ email: string | null }>("select email from public.clients where id = $1", [id]);
  return { id, email };
}
type Person = Awaited<ReturnType<typeof person>>;

/** A visit `minutesAgo` before now (negative: in the future). */
async function visit(c: Co, p: Person, minutesAgo: number, status = "completed", duration = 120) {
  const [b] = await api.sql<{ id: string }>(
    `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status)
     values ($1, $2, now() - make_interval(mins => $3), $4, 'standard', $5::public.booking_status) returning id`,
    [c.org, p.id, minutesAgo, duration, status],
  );
  return b.id;
}
const DAY = 24 * 60;
const mailTo = (p: Person) => outbox.email.filter((m) => m.to === p.email);
const clientRow = async (p: Person) => (await api.sql<Record<string, unknown>>("select * from public.clients where id = $1", [p.id]))[0];
const daysFromNow = (iso: unknown) => Math.round((new Date(String(iso)).getTime() - Date.now()) / 86_400_000);

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("booking review requests", { timeout: 180_000 }, () => {
  const ON = { review_request_after_completion: { enabled: true } };

  it("asks each client once, about their latest finished job, after the company's delay; never twice", async () => {
    const c = await company(ON);
    const weekly = await person(c, "Weekly Client");
    const older = await visit(c, weekly, 3 * DAY);
    const latest = await visit(c, weekly, 2 * DAY);
    const justDone = await person(c, "Just Done");
    await visit(c, justDone, 90, "completed", 60); // ended 30 minutes ago; the company waits 2 hours
    const longAgo = await person(c, "Long Ago");
    await visit(c, longAgo, 40 * DAY);
    const cancelled = await person(c, "Cancelled Job");
    await visit(c, cancelled, 2 * DAY, "cancelled");
    const noEmail = await person(c, "No Email", { email: null });
    await visit(c, noEmail, 2 * DAY);

    expect((await BOOKING_REVIEWS("wrong-secret-0123456789")).status).toBe(401);
    expect(outbox.email).toHaveLength(0);

    const res = await BOOKING_REVIEWS();
    expect(res.status, api.log().slice(-300)).toBe(200);
    expect(mailTo(weekly)).toHaveLength(1);
    expect(mailTo(weekly)[0].html).toMatch(/\/review\/[A-Za-z0-9._-]+/);
    for (const p of [justDone, longAgo, cancelled]) expect(mailTo(p), p.email ?? "").toHaveLength(0);
    const stamped = await api.sql<{ id: string; sent: boolean }>(
      "select id, review_request_sent_at is not null as sent from public.bookings where client_id = $1 order by scheduled_at",
      [weekly.id],
    );
    expect(stamped).toEqual([
      { id: older, sent: false },
      { id: latest, sent: true },
    ]);

    outbox.email.length = 0;
    await BOOKING_REVIEWS();
    expect(mailTo(weekly), "asked once").toHaveLength(0);
  });

  it("skips anyone who opted out, reviewed lately or follows a 'none' house default, and every company that hasn't switched it on", async () => {
    const c = await company(ON);
    const dnc = await person(c, "Do Not Contact", { contact_preference: "do_not_contact" });
    const growthOff = await person(c, "Growth Off", { contact_preference: "custom", contact_overrides: { growth: "off" } });
    const muted = await person(c, "Muted", { contact_preference: "custom", contact_overrides: { muted_events: ["review_request"] } });
    const reviewed = await person(c, "Reviewed Lately");
    await api.sql("insert into public.reviews (organization_id, client_id, rating, submitted_at) values ($1, $2, 5, now() - interval '10 days')", [c.org, reviewed.id]);
    const svit = await company(ON, { contactDefault: "none" });
    const inherits = await person(svit, "Inherits None");
    const optedIn = await person(svit, "Opted In", { contact_preference: "custom", contact_overrides: { growth: "email" } });
    const off = await company({});
    const offClient = await person(off, "Switched Off");
    const masterOff = await company(ON);
    await api.sql("update public.organizations set automations_enabled = false where id = $1", [masterOff.org]);
    const masterOffClient = await person(masterOff, "Master Off");
    for (const [co, p] of [[c, dnc], [c, growthOff], [c, muted], [c, reviewed], [svit, inherits], [svit, optedIn], [off, offClient], [masterOff, masterOffClient]] as const) {
      await visit(co, p, 2 * DAY);
    }

    expect((await BOOKING_REVIEWS()).status).toBe(200);
    expect(outbox.email.map((m) => m.to)).toEqual([optedIn.email]);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("Google review requests", { timeout: 180_000 }, () => {
  const ON = { gbp_review_request: { enabled: true } };

  it("asks 48 hours after a first job, reminds a week later and then monthly, and stops at the cap", async () => {
    const c = await company(ON);
    const ready = await person(c, "Ready Client");
    await visit(c, ready, 3 * DAY);
    const tooSoon = await person(c, "Too Soon");
    await visit(c, tooSoon, 1 * DAY);
    const tooOld = await person(c, "Too Old");
    await visit(c, tooOld, 20 * DAY);
    const atCap = await person(c, "At The Cap", {
      gbp_review_state: "pending",
      gbp_reminders_sent: 5,
      gbp_next_reminder_at: new Date(Date.now() - 60_000).toISOString(),
      gbp_redirect_token: `capredirect${Date.now()}`,
      gbp_unsubscribe_token: `capunsub${Date.now()}`,
    });

    expect((await GBP()).status, api.log().slice(-300)).toBe(200);
    expect(mailTo(ready)).toHaveLength(1);
    let row = await clientRow(ready);
    expect(row.gbp_review_state).toBe("pending");
    expect(daysFromNow(row.gbp_next_reminder_at)).toBe(7);
    expect(mailTo(ready)[0].html).toContain(`/r/g/${row.gbp_redirect_token}`);
    expect(mailTo(ready)[0].unsubscribeUrl).toMatch(new RegExp(`/api/u/g/${row.gbp_unsubscribe_token}$`));
    expect(mailTo(tooSoon)).toHaveLength(0);
    expect(mailTo(tooOld)).toHaveLength(0);
    expect(mailTo(atCap)).toHaveLength(0);
    expect((await clientRow(atCap)).gbp_review_state, "five reminders is the cap").toBe("lapsed");
    expect((await clientRow(tooSoon)).gbp_review_state).toBe("never_asked");

    outbox.email.length = 0;
    await GBP();
    expect(mailTo(ready), "asked once").toHaveLength(0);

    // A week on: the first reminder, then the monthly cadence.
    await api.sql("update public.clients set gbp_next_reminder_at = now() - interval '1 minute' where id = $1", [ready.id]);
    await GBP();
    expect(mailTo(ready)).toHaveLength(1);
    row = await clientRow(ready);
    expect(row.gbp_reminders_sent).toBe(1);
    expect(daysFromNow(row.gbp_next_reminder_at)).toBe(30);
    outbox.email.length = 0;
    await GBP();
    expect(mailTo(ready)).toHaveLength(0);

    // The office presses Reset on the lapsed client: the next run reminds them.
    await (async () => {
      request.cookies = api.sessionCookies(c.owner.userId);
      const f = new FormData();
      f.set("id", atCap.id);
      await resetGbpAction(f);
      await settle();
    })();
    await GBP();
    expect(mailTo(atCap)).toHaveLength(1);
    expect((await clientRow(atCap)).gbp_reminders_sent).toBe(1);
  });

  it("an unsubscribe from the email, an opt-out or do-not-contact stops it; so does a company with no review link or the switch off", async () => {
    const c = await company(ON);
    const leaver = await person(c, "Leaver");
    await visit(c, leaver, 3 * DAY);
    const optedOut = await person(c, "Opted Out", { gbp_review_state: "opted_out" });
    await visit(c, optedOut, 3 * DAY);
    const dnc = await person(c, "Do Not Contact", { contact_preference: "do_not_contact" });
    await visit(c, dnc, 3 * DAY);
    const noLink = await company(ON, { reviewUrl: null });
    const noLinkClient = await person(noLink, "No Link");
    await visit(noLink, noLinkClient, 3 * DAY);
    const off = await company({});
    const offClient = await person(off, "Switched Off");
    await visit(off, offClient, 3 * DAY);
    const svit = await company(ON, { contactDefault: "none" });
    const inherits = await person(svit, "Inherits None");
    await visit(svit, inherits, 3 * DAY);

    await GBP();
    expect(outbox.email.map((m) => m.to)).toEqual([leaver.email]);
    for (const p of [dnc, noLinkClient, offClient, inherits]) expect((await clientRow(p)).gbp_review_state, p.email ?? "").toBe("never_asked");

    // The client presses the mailbox's one-click unsubscribe on that email.
    const token = String((await clientRow(leaver)).gbp_unsubscribe_token);
    const res = await gbpUnsubscribe.POST(new NextRequest(`http://localhost/api/u/g/${token}`, { method: "POST" }), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(200);
    expect((await clientRow(leaver)).gbp_review_state).toBe("opted_out");
    await api.sql("update public.clients set gbp_next_reminder_at = now() - interval '1 minute' where id = $1", [leaver.id]);
    outbox.email.length = 0;
    await GBP();
    expect(mailTo(leaver)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("rebooking prompt", { timeout: 180_000 }, () => {
  const ON = { rebooking_prompt_email: { enabled: true } };

  it("nudges a client whose last clean was two weeks to six months ago with nothing booked, once a month", async () => {
    const c = await company(ON);
    const lapsed = await person(c, "Lapsed Client");
    await visit(c, lapsed, 20 * DAY);
    const booked = await person(c, "Booked Again");
    await visit(c, booked, 20 * DAY);
    await visit(c, booked, -3 * DAY, "confirmed");
    const recent = await person(c, "Recent Client");
    await visit(c, recent, 5 * DAY);
    const ancient = await person(c, "Ancient Client");
    await visit(c, ancient, 200 * DAY);
    const dnc = await person(c, "Do Not Contact", { contact_preference: "do_not_contact" });
    await visit(c, dnc, 20 * DAY);
    const off = await company({});
    const offClient = await person(off, "Switched Off");
    await visit(off, offClient, 20 * DAY);
    const [{ email: ownerEmail }] = await api.sql<{ email: string }>("select email from auth.users where id = $1", [c.owner.userId]);

    expect((await REBOOKING()).status, api.log().slice(-300)).toBe(200);
    expect(outbox.email.map((m) => m.to)).toEqual([lapsed.email]);
    const [mail] = mailTo(lapsed);
    expect(mail.html).toContain(`mailto:${ownerEmail}`);
    const row = await clientRow(lapsed);
    expect(row.last_rebook_prompt_at).not.toBeNull();
    expect(row.gbp_unsubscribe_token).toBeTruthy();
    expect(mail.unsubscribeUrl).toMatch(new RegExp(`/api/u/m/${row.gbp_unsubscribe_token}$`));

    outbox.email.length = 0;
    await REBOOKING();
    expect(outbox.email, "once a month").toHaveLength(0);
    await api.sql("update public.clients set last_rebook_prompt_at = now() - interval '31 days' where id = $1", [lapsed.id]);
    await REBOOKING();
    expect(mailTo(lapsed), "a month on, again").toHaveLength(1);
  });

  it("the unsubscribe link in the email stops the next one", async () => {
    const c = await company(ON);
    const p = await person(c, "Unsubscriber");
    await visit(c, p, 20 * DAY);
    await REBOOKING();
    const token = String((await clientRow(p)).gbp_unsubscribe_token);
    expect(mailTo(p)[0].unsubscribeUrl).toContain(`/api/u/m/${token}`);

    const opened = await marketingUnsubscribe.GET(new NextRequest(`http://localhost/api/u/m/${token}`), { params: Promise.resolve({ token }) });
    await marketingUnsubscribe.POST(new NextRequest(`http://localhost/api/u/m/${token}`, { method: "POST" }), { params: Promise.resolve({ token }) });
    await api.sql("update public.clients set last_rebook_prompt_at = now() - interval '40 days' where id = $1", [p.id]);
    outbox.email.length = 0;
    await REBOOKING();
    expect(mailTo(p), "unsubscribed from these").toHaveLength(0);
    expect(opened.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Last: these leave hundreds of rows that every later run would read.

describe.skipIf(!hasPostgrest)("a busy database", { timeout: 240_000 }, () => {
  // FIX-LATER: sendBookingReviewRequests reads the 200 oldest unasked completed jobs across every company, and jobs it skips (company switched off, house default "none") are never stamped, so they hold the window and newer jobs are never asked.
  it.fails("booking review requests reach a company switched on even when 200 older jobs elsewhere will never be asked", async () => {
    const quiet = await company({});
    const regular = await person(quiet, "Regular Elsewhere");
    await api.sql(
      `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status)
       select $1, $2, now() - interval '10 days' - make_interval(mins => g), 60, 'standard', 'completed' from generate_series(1, 200) g`,
      [quiet.org, regular.id],
    );
    const c = await company({ review_request_after_completion: { enabled: true } });
    const waiting = await person(c, "Waiting Client");
    await visit(c, waiting, 1 * DAY);
    await BOOKING_REVIEWS();
    expect(mailTo(waiting)).toHaveLength(1);
  });

  // FIX-LATER: sendRebookingPrompts takes the first 500 clients with an email (no order) and never marks the ones that don't qualify, so in a company past 500 clients the rest are never considered.
  it.fails("the rebooking prompt reaches a client past the first 500 in a big company", async () => {
    const c = await company({ rebooking_prompt_email: { enabled: true } });
    await api.sql(
      `insert into public.clients (organization_id, name, email)
       select $1, 'Never Cleaned ' || g, 'never.cleaned.' || g || '.' || $2 || '@example.com' from generate_series(1, 500) g`,
      [c.org, String(Date.now())],
    );
    const due = await person(c, "Due For A Clean");
    await visit(c, due, 20 * DAY);
    await REBOOKING();
    expect(mailTo(due)).toHaveLength(1);
  });
});

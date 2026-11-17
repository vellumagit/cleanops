/**
 * The crons that email Sollos's own customers (org owners), and the admin
 * endpoint that feeds one of them, through their real routes against a real
 * database behind the real PostgREST.
 *
 *   monthly-ops-digest   last month's numbers to owners and admins
 *   product-changelog    "what's new in Sollos" to opted-in owners, Fridays
 *   admin/changelog      writing the entries that email carries
 *   trial-expiring       3, 1 and 0 days before a trial ends
 *
 * Resend's SDK is caught (the app's email code runs); anything that would
 * leave the test stack is answered locally.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));

const outbox = vi.hoisted(() => ({
  mail: [] as Array<{ to: string; subject: string; html: string; text: string; headers: Record<string, string> }>,
  refuse: new Set<string>(),
  external: [] as string[],
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: { to: string[]; subject: string; html: string; text?: string; headers?: Record<string, string> }) => {
        const to = String(payload.to[0]).replace(/^.*<([^>]+)>$/, "$1");
        if (outbox.refuse.has(to)) return { data: null, error: { name: "validation_error", message: "test: Resend refused" } };
        outbox.mail.push({ to, subject: payload.subject, html: payload.html, text: payload.text ?? "", headers: payload.headers ?? {} });
        return { data: { id: `msg-${outbox.mail.length}` }, error: null };
      },
    };
  },
}));

const SECRET = "crons-digests-trials-secret-0123456";
const SITE = "https://sollos.example.test";
const TZ = "America/Regina";
let api: Api;
let restoreEnv: () => void;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  for (const k of ["CRON_SECRET", "RESEND_API_KEY", "NEXT_PUBLIC_SITE_URL", "CLIENT_EMAILS_PAUSED"]) saved[k] = process.env[k];
  process.env.CRON_SECRET = SECRET;
  process.env.RESEND_API_KEY = "re_test_not_a_real_key";
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  delete process.env.CLIENT_EMAILS_PAUSED;
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return realFetch(input, init);
    outbox.external.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
    return new Response("not here (test stub)", { status: 404 });
  });
}, 240_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  outbox.mail.length = 0;
  outbox.refuse.clear();
  outbox.external.length = 0;
});

type Handler = (req: NextRequest) => Promise<Response>;
async function call(
  handler: Handler,
  path: string,
  opts: { auth?: string | null; method?: string; body?: string } = {},
) {
  const auth = opts.auth === undefined ? `Bearer ${SECRET}` : opts.auth;
  const res = await handler(
    new NextRequest(`${SITE}${path}`, {
      method: opts.method ?? "GET",
      headers: { ...(auth ? { authorization: auth } : {}), ...(opts.body ? { "content-type": "application/json" } : {}) },
      body: opts.body,
    }),
  );
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, body: body as Record<string, unknown> };
}

const DAY = 86_400_000;
type Company = { org: string; owner: Member; admin: Member; manager: Member; employee: Member };
async function company(name: string, o: { automations?: boolean; settings?: Record<string, { enabled: boolean }> } = {}): Promise<Company> {
  const org = await addOrg(api.sql, name);
  await api.sql(
    `update public.organizations set timezone = $2, currency_code = 'CAD', automations_enabled = $3,
            automation_settings = $4::jsonb, email_daily_cap = null where id = $1`,
    [org, TZ, o.automations ?? true, JSON.stringify(o.settings ?? {})],
  );
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    admin: await addMember(api.sql, org, "admin", "Office Admin"),
    manager: await addMember(api.sql, org, "manager", "Manager"),
    employee: await addMember(api.sql, org, "employee", "Anna"),
  };
}
const emailOf = async (m: Member) =>
  (await api.sql<{ email: string }>("select email from auth.users where id = $1", [m.userId]))[0].email;
const mailTo = async (m: Member) => {
  const e = await emailOf(m);
  return outbox.mail.filter((x) => x.to === e);
};

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("these routes refuse anyone without the cron secret", { timeout: 120_000 }, () => {
  it("monthly-ops-digest, product-changelog, trial-expiring and admin/changelog answer 401 and do nothing", async () => {
    const monthly = (await import("@/app/api/cron/monthly-ops-digest/route")).GET as Handler;
    const changelog = (await import("@/app/api/cron/product-changelog/route")).GET as Handler;
    const trial = (await import("@/app/api/cron/trial-expiring/route")).GET as Handler;
    const admin = await import("@/app/api/admin/changelog/route");
    for (const auth of [null, "Bearer wrong-secret-wrong-secret-00", SECRET]) {
      expect((await call(monthly, "/api/cron/monthly-ops-digest", { auth })).status).toBe(401);
      expect((await call(changelog, "/api/cron/product-changelog?force=1", { auth })).status).toBe(401);
      expect((await call(trial, "/api/cron/trial-expiring", { auth })).status).toBe(401);
      expect((await call(admin.GET as Handler, "/api/admin/changelog", { auth })).status).toBe(401);
      expect(
        (await call(admin.POST as Handler, "/api/admin/changelog", { auth, method: "POST", body: JSON.stringify({ title: "x", body: "y" }) })).status,
      ).toBe(401);
    }
    expect(await api.sql("select 1 from public.changelog_entries")).toHaveLength(0);
    expect(outbox.mail).toHaveLength(0);
  });
});

describe.skipIf(!hasPostgrest)("monthly-ops-digest: last month's numbers to owners and admins", { timeout: 120_000 }, () => {
  it("counts last month's paid revenue and completed jobs, names the top client and cleaner; only where it is on", async () => {
    const { GET } = await import("@/app/api/cron/monthly-ops-digest/route");
    const on = await company("Monthly On", { settings: { monthly_ops_digest: { enabled: true } } });
    const off = await company("Monthly Off", { settings: { monthly_ops_digest: { enabled: false } } });
    const master = await company("Monthly Master Off", { automations: false, settings: { monthly_ops_digest: { enabled: true } } });

    // Mid last month and mid this month, in UTC (well clear of any boundary).
    const now = new Date();
    const lastMonth = (day: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, day, 18)).toISOString();
    const thisMonth = (day: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 18)).toISOString();
    const top = await addClient(api.sql, on.org, "Lori Moeller");
    const second = await addClient(api.sql, on.org, "Ken Hicks");
    const paid = (client: string, cents: number, paidAt: string | null, status = "paid") =>
      api.sql(
        `insert into public.invoices (organization_id, client_id, status, amount_cents, due_date, sent_at, paid_at)
         values ($1, $2, $3::public.invoice_status, $4, current_date, now(), $5)`,
        [on.org, client, status, cents, paidAt],
      );
    await paid(top, 50_000, lastMonth(10));
    await paid(top, 12_000, lastMonth(12));
    await paid(second, 20_000, lastMonth(14));
    await paid(second, 99_900, thisMonth(2)); // this month: not in last month's digest
    await paid(top, 77_700, null, "void");
    const done = async (at: string, crew: Member[], status = "completed") => {
      const [b] = await api.sql<{ id: string }>(
        `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status)
         values ($1, $2, $3, 120, 'standard', $4::public.booking_status) returning id`,
        [on.org, top, at, status],
      );
      for (const m of crew) {
        await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id) values ($1, $2, $3)", [on.org, b.id, m.membershipId]);
      }
    };
    await done(lastMonth(10), [on.employee]);
    await done(lastMonth(11), [on.employee, on.manager]);
    await done(lastMonth(12), [on.employee]);
    await done(thisMonth(1), [on.manager]);
    await done(thisMonth(3), [on.manager]);
    await done(thisMonth(4), [on.manager]);
    await done(thisMonth(5), [on.manager]);
    await api.sql("insert into public.clients (organization_id, name, created_at) values ($1, 'Emma Drebit', $2)", [on.org, lastMonth(20)]);

    const run = await call(GET, "/api/cron/monthly-ops-digest");
    expect(run.status, JSON.stringify(run.body) + api.log()).toBe(200);

    const [mail] = await mailTo(on.owner);
    expect(mail, api.log()).toBeDefined();
    expect(await mailTo(on.admin)).toHaveLength(1);
    expect(await mailTo(on.manager)).toHaveLength(0);
    expect(await mailTo(on.employee)).toHaveLength(0);
    const text = mail.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("$820.00"); // 500 + 120 + 200; not this month's, not the void
    expect(text).not.toContain("$999.00");
    expect(text).toMatch(/Jobs completed 3\b/);
    expect(text).toMatch(/New clients 1\b/);
    expect(text.indexOf("Lori Moeller")).toBeGreaterThan(-1);
    expect(text.indexOf("Lori Moeller")).toBeLessThan(text.indexOf("Ken Hicks"));
    expect(text).toContain("Anna"); // three jobs last month; the manager's four are this month

    for (const c of [off, master]) {
      expect(await mailTo(c.owner)).toHaveLength(0);
      expect(await mailTo(c.admin)).toHaveLength(0);
    }
  });
});

describe.skipIf(!hasPostgrest)("admin/changelog and product-changelog: written once, mailed once to opted-in owners", { timeout: 120_000 }, () => {
  it("admin/changelog validates and stores entries; the Friday send mails published ones to opted-in owners, once", async () => {
    const admin = await import("@/app/api/admin/changelog/route");
    const { GET } = await import("@/app/api/cron/product-changelog/route");
    const POST = admin.POST as Handler;

    // Writing entries.
    expect((await call(POST, "/api/admin/changelog", { method: "POST", body: "{not json" })).status).toBe(400);
    expect((await call(POST, "/api/admin/changelog", { method: "POST", body: JSON.stringify({ title: "Only a title" }) })).status).toBe(400);
    expect(
      (await call(POST, "/api/admin/changelog", { method: "POST", body: JSON.stringify({ title: "x".repeat(201), body: "ok" }) })).status,
    ).toBe(400);
    const published = await call(POST, "/api/admin/changelog", {
      method: "POST",
      body: JSON.stringify({ title: "  Faster calendar  ", body: "The schedule loads quicker.\n\n- Fewer clicks\n- Clearer times" }),
    });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body.entry).toMatchObject({ title: "Faster calendar" });
    expect((published.body.entry as { published_at: string | null }).published_at).not.toBeNull();
    const draft = await call(POST, "/api/admin/changelog", {
      method: "POST",
      body: JSON.stringify({ title: "Secret draft", body: "Not ready", publish: false }),
    });
    expect((draft.body.entry as { published_at: string | null }).published_at).toBeNull();
    const listed = await call(admin.GET as Handler, "/api/admin/changelog");
    expect((listed.body.entries as Array<{ title: string }>).map((e) => e.title).sort()).toEqual(["Faster calendar", "Secret draft"]);

    // Who opted in.
    const inOrg = await company("Changelog In", { settings: { product_changelog_email: { enabled: true } } });
    const unsubscribed = await addMember(api.sql, inOrg.org, "owner", "Second Owner");
    await api.sql("update public.memberships set product_updates_unsubscribed_at = now() where id = $1", [unsubscribed.membershipId]);
    const outOrg = await company("Changelog Out", { settings: { product_changelog_email: { enabled: false } } });
    const masterOff = await company("Changelog Master Off", { automations: false, settings: { product_changelog_email: { enabled: true } } });

    // A dry run counts and sends nothing.
    const dry = await call(GET, "/api/cron/product-changelog?dry_run=1");
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body).toMatchObject({ ok: true, dry_run: true, entries: 1, sent: 0 });
    expect(outbox.mail).toHaveLength(0);
    expect(await api.sql("select 1 from public.changelog_entries where sent_at is not null")).toHaveLength(0);

    // Outside 9 AM in Edmonton, the scheduled call stands down.
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Edmonton", hour: "numeric", hour12: false }).format(new Date()));
    if (hour !== 9) {
      const skipped = await call(GET, "/api/cron/product-changelog");
      expect(skipped.body.skipped, JSON.stringify(skipped.body)).toBeDefined();
      expect(outbox.mail).toHaveLength(0);
    }

    // The real send.
    const sent = await call(GET, "/api/cron/product-changelog?force=1");
    expect(sent.status, JSON.stringify(sent.body) + api.log()).toBe(200);
    const [mail] = await mailTo(inOrg.owner);
    expect(mail, JSON.stringify(sent.body)).toBeDefined();
    expect(mail.html).toContain("Faster calendar");
    expect(mail.html).toContain("<li");
    expect(mail.html).not.toContain("Secret draft");
    expect(mail.headers["List-Unsubscribe"]).toMatch(new RegExp(`^<${SITE}/api/u/p/.{8,}>$`));
    for (const quiet of [unsubscribed, inOrg.admin, inOrg.manager, outOrg.owner, masterOff.owner]) {
      expect(await mailTo(quiet)).toHaveLength(0);
    }
    const stamped = await api.sql<{ title: string; sent: boolean }>(
      "select title, sent_at is not null as sent from public.changelog_entries order by title",
    );
    expect(stamped).toEqual([
      { title: "Faster calendar", sent: true },
      { title: "Secret draft", sent: false },
    ]);

    // Next Friday with nothing new: silence.
    outbox.mail.length = 0;
    const again = await call(GET, "/api/cron/product-changelog?force=1");
    expect(again.body).toMatchObject({ entries: 0, sent: 0 });
    expect(outbox.mail).toHaveLength(0);
  });

  it("a run where every send fails does not use up the announcement", async () => {
    const { GET } = await import("@/app/api/cron/product-changelog/route");
    const c = await company("Changelog Bounce", { settings: { product_changelog_email: { enabled: true } } });
    // Only this org's owner is opted in for this run (the others are switched off, then back).
    const paused = await api.sql<{ id: string }>(
      "update public.organizations set automations_enabled = false where id <> $1 and automations_enabled returning id",
      [c.org],
    );
    try {
      await api.sql("insert into public.changelog_entries (title, body, published_at) values ('Bounced news', 'Body', now())");
      outbox.refuse.add(await emailOf(c.owner));
      const run = await call(GET, "/api/cron/product-changelog?force=1");
      expect(run.body).toMatchObject({ sent: 0 });
      expect(
        await api.sql("select 1 from public.changelog_entries where title = 'Bounced news' and sent_at is null"),
      ).toHaveLength(1);
      outbox.refuse.clear();
      await call(GET, "/api/cron/product-changelog?force=1");
      expect(await mailTo(c.owner)).toHaveLength(1);
    } finally {
      await api.sql("update public.organizations set automations_enabled = true where id = any($1::uuid[])", [paused.map((p) => p.id)]);
    }
  });

  it("an owner of two opted-in companies gets one copy", async () => {
    const { GET } = await import("@/app/api/cron/product-changelog/route");
    const first = await company("Changelog Twin A", { settings: { product_changelog_email: { enabled: true } } });
    const second = await company("Changelog Twin B", { settings: { product_changelog_email: { enabled: true } } });
    await api.sql(
      "insert into public.memberships (organization_id, profile_id, role, status) values ($1, $2, 'owner', 'active')",
      [second.org, first.owner.userId],
    );
    await api.sql("insert into public.changelog_entries (title, body, published_at) values ('Twin news', 'Body', now())");
    expect((await call(GET, "/api/cron/product-changelog?force=1")).status).toBe(200);
    expect(await mailTo(first.owner)).toHaveLength(1);
  });
});

describe.skipIf(!hasPostgrest)("trial-expiring: 3, 1 and 0 days before a trial ends, once each", { timeout: 120_000 }, () => {
  // An hour inside the day: `daysLeft` days minus an hour remain, which rounds up to daysLeft.
  const startedDaysAgo = (daysLeft: number) => new Date(Date.now() - (14 - daysLeft) * DAY - 3_600_000).toISOString();

  async function trialOrg(name: string, daysLeft: number | null) {
    const c = await company(name);
    await api.sql("update public.organizations set trial_started_at = $2 where id = $1", [c.org, daysLeft === null ? null : startedDaysAgo(daysLeft)]);
    return c;
  }

  it("reminds owners and admins at 3 days on a self-managed trial and 1 day on a Stripe trial, once", async () => {
    const { GET } = await import("@/app/api/cron/trial-expiring/route");
    const three = await trialOrg("Trial Three", 3);
    const five = await trialOrg("Trial Five", 5);
    const legacy = await trialOrg("Legacy Org", null);
    const stripe = await trialOrg("Stripe Trial", 3); // its Stripe trial is what counts, not the local clock
    await api.sql(
      "insert into public.subscriptions (organization_id, status, trial_ends_at) values ($1, 'trialing', $2)",
      [stripe.org, new Date(Date.now() + DAY - 3_600_000).toISOString()],
    );

    const run = await call(GET, "/api/cron/trial-expiring");
    expect(run.status, JSON.stringify(run.body) + api.log()).toBe(200);
    expect(run.body).toEqual({ sent: 4 });

    const [m3] = await mailTo(three.owner);
    expect(m3?.subject).toMatch(/^3 days left in your free trial/);
    expect(await mailTo(three.admin)).toHaveLength(1);
    expect(await mailTo(three.manager)).toHaveLength(0);
    const sm = await mailTo(stripe.owner);
    // Under a day left reads as "ends today" (the template's choice for daysLeft <= 1).
    expect(sm.map((m) => m.subject)).toEqual([expect.stringMatching(/^Your free trial ends today — /)]);
    for (const quiet of [five, legacy]) expect(await mailTo(quiet.owner)).toHaveLength(0);

    // Later the same day: nothing again.
    outbox.mail.length = 0;
    expect((await call(GET, "/api/cron/trial-expiring")).body).toEqual({ sent: 0 });
    expect(outbox.mail).toHaveLength(0);
  });

  it("a comped workspace (billing_override) is not told its trial is ending", async () => {
    const { GET } = await import("@/app/api/cron/trial-expiring/route");
    const comp = await trialOrg("Comped Org", 3);
    await api.sql("update public.organizations set billing_override = 'comp' where id = $1", [comp.org]);
    await call(GET, "/api/cron/trial-expiring");
    expect(await mailTo(comp.owner)).toHaveLength(0);
  });

  it("a workspace that already subscribed (Stripe status active) is not told its trial is ending", async () => {
    const { GET } = await import("@/app/api/cron/trial-expiring/route");
    const paying = await trialOrg("Paying Org", 1);
    await api.sql("insert into public.subscriptions (organization_id, status) values ($1, 'active')", [paying.org]);
    await call(GET, "/api/cron/trial-expiring");
    expect(await mailTo(paying.owner)).toHaveLength(0);
  });

  it("a reminder Resend refused is not counted as sent", async () => {
    const { GET } = await import("@/app/api/cron/trial-expiring/route");
    const bounce = await trialOrg("Bounce Org", 3);
    await api.sql("delete from public.memberships where id = $1", [bounce.admin.membershipId]);
    outbox.refuse.add(await emailOf(bounce.owner));
    const run = await call(GET, "/api/cron/trial-expiring");
    expect(run.body).toEqual({ sent: 0 });
  });
});

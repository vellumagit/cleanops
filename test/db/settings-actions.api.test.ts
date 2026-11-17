/**
 * The rest of Settings, pressed the way the owner presses it, against a real
 * database behind the real PostgREST. Outbound email is caught; rate limits
 * are the real ones, in a fresh bucket per test.
 *
 *   Webhooks            add (unsafe addresses refused), pause, delete
 *   Services            add, archive, bring back
 *   Bonus rules         save, save again
 *   Holidays            pick a region, clear it
 *   Client messages     one client's notification choices
 *   Sender email        save, the verification email, the link in it
 *   Danger zone         schedule deletion, cancel it
 *
 * The checks that matter: each button changes this company's setting and no
 * other company's, the wrong role changes nothing, and a refused press leaves
 * the setting as it was.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

type Sent = { to: string; subject: string; text?: string; html?: string };
const outbox = vi.hoisted(() => ({ email: [] as Sent[] }));
const limits = vi.hoisted(() => ({ epoch: 0 }));
vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...real,
    checkRateLimit: (key: string, max?: number, windowMs?: number) => real.checkRateLimit(`${limits.epoch}:${key}`, max, windowMs),
  };
});
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
}));

const hooks = await import("@/app/app/settings/webhooks/actions");
const services = await import("@/app/app/settings/services/actions");
const bonus = await import("@/app/app/settings/bonus-rules/actions");
const currency = await import("@/app/app/settings/currency/actions");
const automations = await import("@/app/app/settings/automations/actions");
const email = await import("@/app/app/settings/email/actions");
const data = await import("@/app/app/settings/data/actions");
const { GET: verifySender } = await import("@/app/api/verify-sender/route");

let api: Api;
let restoreEnv: () => void;
const SITE = "https://app.sollos.example.com";
let savedSite: string | undefined;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  savedSite = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
}, 240_000);

afterAll(async () => {
  vi.useRealTimers();
  if (savedSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = savedSite;
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  outbox.email.length = 0;
  limits.epoch += 1;
});

/** Signed in as this member; a redirect is an answer too. */
async function as<T>(m: Member, press: () => Promise<T>, extraCookies: Array<{ name: string; value: string }> = []): Promise<T | { redirected: string }> {
  request.cookies = [...api.sessionCookies(m.userId), ...extraCookies];
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

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const x of v) f.append(k, x);
    else f.set(k, v);
  }
  return f;
};

async function company() {
  const org = await addOrg(api.sql, "Settings Co");
  await api.sql("update public.organizations set timezone = 'America/Regina', created_at = now() - interval '60 days' where id = $1", [org]);
  const [{ name }] = await api.sql<{ name: string }>("select name from public.organizations where id = $1", [org]);
  return {
    org,
    name,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    olha: await addMember(api.sql, org, "manager", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
}

const orgRow = async (org: string) =>
  (
    await api.sql<{
      holiday_region: string | null;
      sender_email: string | null;
      sender_email_token: string | null;
      sender_email_verified_at: string | null;
      deletion_scheduled_at: string | null;
    }>(
      "select holiday_region, sender_email, sender_email_token, sender_email_verified_at::text as sender_email_verified_at, deletion_scheduled_at::text as deletion_scheduled_at from public.organizations where id = $1",
      [org],
    )
  )[0];

describe.skipIf(!hasPostgrest)("Settings → Webhooks", { timeout: 90_000 }, () => {
  const webhooks = (org: string) =>
    api.sql<{ id: string; name: string; url: string; events: string[]; is_active: boolean; secret: string; created_by: string | null }>(
      "select id, name, url, events, is_active, secret, created_by from public.webhooks where organization_id = $1 order by created_at",
      [org],
    );

  it("the owner adds one for a public https address, with a secret of its own", async () => {
    const c = await company();
    await as(c.owner, () =>
      hooks.createWebhookAction(form({ name: "Zapier", url: "https://hooks.example.com/sollos", events: ["invoice.created", "booking.created"] })),
    );
    const [w, ...rest] = await webhooks(c.org);
    expect(rest).toEqual([]);
    expect(w).toMatchObject({
      name: "Zapier",
      url: "https://hooks.example.com/sollos",
      events: ["invoice.created", "booking.created"],
      is_active: true,
      created_by: c.owner.membershipId,
    });
    expect(w.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses addresses inside the network, plain http, and anyone but the owner or an admin", async () => {
    const c = await company();
    const unsafe = [
      "http://hooks.example.com/sollos",
      "https://localhost/hook",
      "https://app.localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://172.20.1.1/hook",
      "https://192.168.1.10/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/hook",
      "https://[::ffff:169.254.169.254]/hook",
      "https://[fd00::1]/hook",
      "https://metadata.google.internal/hook",
      "https://printer.local/hook",
      "https://user:pass@hooks.example.com/hook",
      "not a url",
    ];
    for (const url of unsafe) {
      await as(c.owner, () => hooks.createWebhookAction(form({ name: "Bad", url, events: ["invoice.created"] })));
    }
    await as(c.owner, () => hooks.createWebhookAction(form({ name: "No events", url: "https://hooks.example.com/a" })));
    await as(c.owner, () => hooks.createWebhookAction(form({ name: "", url: "https://hooks.example.com/b", events: ["invoice.created"] })));
    await as(c.olha, () => hooks.createWebhookAction(form({ name: "Olha", url: "https://hooks.example.com/c", events: ["invoice.created"] })));
    await as(c.anna, () => hooks.createWebhookAction(form({ name: "Anna", url: "https://hooks.example.com/d", events: ["invoice.created"] })));
    expect(await webhooks(c.org)).toEqual([]);
  });

  it("pause and delete reach this company's webhook only, and only for the owner or an admin", async () => {
    const c = await company();
    const other = await company();
    await as(c.owner, () => hooks.createWebhookAction(form({ name: "Mine", url: "https://hooks.example.com/mine", events: ["invoice.paid"] })));
    await as(other.owner, () => hooks.createWebhookAction(form({ name: "Theirs", url: "https://hooks.example.com/theirs", events: ["invoice.paid"] })));
    const [mine] = await webhooks(c.org);
    const [theirs] = await webhooks(other.org);

    await as(c.olha, () => hooks.toggleWebhookAction(form({ id: mine.id, is_active: "false" })));
    expect((await webhooks(c.org))[0].is_active, "a manager can't").toBe(true);
    await as(c.owner, () => hooks.toggleWebhookAction(form({ id: mine.id, is_active: "false" })));
    expect((await webhooks(c.org))[0].is_active).toBe(false);
    await as(c.owner, () => hooks.toggleWebhookAction(form({ id: mine.id, is_active: "true" })));
    expect((await webhooks(c.org))[0].is_active).toBe(true);

    await as(c.owner, () => hooks.toggleWebhookAction(form({ id: theirs.id, is_active: "false" })));
    await as(c.owner, () => hooks.deleteWebhookAction(form({ id: theirs.id })));
    expect(await webhooks(other.org)).toEqual([theirs]);

    await as(c.anna, () => hooks.deleteWebhookAction(form({ id: mine.id })));
    expect(await webhooks(c.org)).toHaveLength(1);
    await as(c.owner, () => hooks.deleteWebhookAction(form({ id: mine.id })));
    expect(await webhooks(c.org)).toEqual([]);
  });
});

describe.skipIf(!hasPostgrest)("Settings → Services", { timeout: 90_000 }, () => {
  const serviceForm = (over: Record<string, string> = {}) =>
    form({
      category: "deep",
      name: "Spring deep clean",
      description: "Baseboards, inside cabinets, oven",
      default_duration_minutes: "240",
      default_price_cents: "320.00",
      color: "#00aaff",
      sort_order: "10",
      is_active: "on",
      ...over,
    });
  const serviceRow = async (org: string, name: string) =>
    (
      await api.sql<{ id: string; category: string; default_duration_minutes: number | null; default_price_cents: number | null; is_active: boolean; archived_at: string | null; created_by: string | null }>(
        "select id, category::text as category, default_duration_minutes, default_price_cents, is_active, archived_at::text as archived_at, created_by from public.service_types where organization_id = $1 and name = $2",
        [org, name],
      )
    )[0];

  it("the owner adds a service; a second with the same name is refused politely; nobody else can add one", async () => {
    const c = await company();
    expect(await as(c.owner, () => services.createServiceTypeAction({}, serviceForm()))).toEqual({ ok: true });
    expect(await serviceRow(c.org, "Spring deep clean")).toMatchObject({
      category: "deep",
      default_duration_minutes: 240,
      default_price_cents: 32000,
      is_active: true,
      archived_at: null,
      created_by: c.owner.membershipId,
    });
    expect(await as(c.owner, () => services.createServiceTypeAction({}, serviceForm()))).toMatchObject({
      errors: { name: "A service with that name already exists." },
    });
    expect(await as(c.owner, () => services.createServiceTypeAction({}, serviceForm({ name: "Odd colour", color: "blue" })))).toMatchObject({
      errors: { color: "Color must be a hex code like #00aaff" },
    });
    expect(await as(c.olha, () => services.createServiceTypeAction({}, serviceForm({ name: "Olha's service" })))).toEqual({ redirected: "/app" });
    expect(await as(c.anna, () => services.createServiceTypeAction({}, serviceForm({ name: "Anna's service" })))).toEqual({ redirected: "/field" });
    expect(await serviceRow(c.org, "Olha's service")).toBeUndefined();
    expect(await serviceRow(c.org, "Anna's service")).toBeUndefined();
  });

  it("renaming a service renames upcoming visits and recurring series that use it; past visits and other services keep their names", async () => {
    const c = await company();
    await as(c.owner, () => services.createServiceTypeAction({}, serviceForm({ name: "Deep clean" })));
    await as(c.owner, () => services.createServiceTypeAction({}, serviceForm({ name: "Move-out" })));
    const deep = (await serviceRow(c.org, "Deep clean")).id;
    const moveOut = (await serviceRow(c.org, "Move-out")).id;
    const client = await addClient(api.sql, c.org, "Rename Client");
    const visit = async (service: string, label: string, when: string) =>
      (
        await api.sql<{ id: string }>(
          `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, service_type_id, service_type_label, status)
           values ($1, $2, now() + ($5 || ' days')::interval, 120, 'deep', $3, $4, 'confirmed') returning id`,
          [c.org, client, service, label, when],
        )
      )[0].id;
    const upcoming = await visit(deep, "Deep clean", "3");
    const past = await visit(deep, "Deep clean", "-3");
    const otherService = await visit(moveOut, "Move-out", "4");
    const [series] = await api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes, service_type, service_type_id, service_type_label, total_cents)
       values ($1, $2, 'weekly', '09:00', current_date, 120, 'deep', $3, 'Deep clean', 15000) returning id`,
      [c.org, client, deep],
    );
    const label = async (table: "bookings" | "booking_series", id: string) =>
      (await api.sql<{ l: string | null }>(`select service_type_label as l from public.${table} where id = $1`, [id]))[0].l;

    expect(await as(c.owner, () => services.updateServiceTypeAction(deep, {}, serviceForm({ name: "Top-to-bottom clean" }))), api.log().slice(-600)).toEqual({ ok: true });
    expect(await label("bookings", upcoming)).toBe("Top-to-bottom clean");
    expect(await label("booking_series", series.id)).toBe("Top-to-bottom clean");
    expect(await label("bookings", past), "last week's visit keeps the name it was done under").toBe("Deep clean");
    expect(await label("bookings", otherService)).toBe("Move-out");

    // A save that doesn't change the name leaves a visit's own label alone.
    await api.sql("update public.bookings set service_type_label = 'Hand-written label' where id = $1", [upcoming]);
    expect(await as(c.owner, () => services.updateServiceTypeAction(deep, {}, serviceForm({ name: "Top-to-bottom clean", sort_order: "20" })))).toEqual({ ok: true });
    expect(await label("bookings", upcoming)).toBe("Hand-written label");
  });

  it("archive takes a service out of the list and bring-back restores it, for this company's services only", async () => {
    const c = await company();
    const other = await company();
    await as(c.owner, () => services.createServiceTypeAction({}, serviceForm({ name: "Window wash" })));
    await as(other.owner, () => services.createServiceTypeAction({}, serviceForm({ name: "Their window wash" })));
    const mine = await serviceRow(c.org, "Window wash");
    const theirs = await serviceRow(other.org, "Their window wash");

    await as(c.owner, () => services.archiveServiceTypeAction(mine.id));
    expect(await serviceRow(c.org, "Window wash")).toMatchObject({ is_active: false, archived_at: expect.any(String) });
    await as(c.owner, () => services.unarchiveServiceTypeAction(mine.id));
    expect(await serviceRow(c.org, "Window wash")).toMatchObject({ is_active: true, archived_at: null });

    expect(await as(c.olha, () => services.archiveServiceTypeAction(mine.id))).toEqual({ redirected: "/app" });
    expect((await serviceRow(c.org, "Window wash")).is_active).toBe(true);
    await as(c.owner, () => services.archiveServiceTypeAction(theirs.id));
    expect((await serviceRow(other.org, "Their window wash")).is_active, "another company's service is out of reach").toBe(true);
    await api.sql("update public.service_types set is_active = false, archived_at = now() where id = $1", [theirs.id]);
    await as(c.owner, () => services.unarchiveServiceTypeAction(theirs.id));
    expect((await serviceRow(other.org, "Their window wash")).is_active).toBe(false);
  });

  it("archiving a service that isn't ours leaves no 'archived' entry in our audit log", async () => {
    const c = await company();
    const other = await company();
    await as(other.owner, () => services.createServiceTypeAction({}, serviceForm({ name: "Not yours" })));
    const theirs = await serviceRow(other.org, "Not yours");
    await as(c.owner, () => services.archiveServiceTypeAction(theirs.id));
    expect(await api.sql("select action from public.audit_log where organization_id = $1 and entity_id = $2", [c.org, theirs.id])).toEqual([]);
  });
});

describe.skipIf(!hasPostgrest)("Settings → Bonus rules", { timeout: 90_000 }, () => {
  const bonusForm = (over: Record<string, string> = {}) =>
    form({
      enabled: "on",
      min_avg_rating: "4.8",
      min_reviews_count: "5",
      period_days: "30",
      amount_cents: "50.00",
      efficiency_enabled: "",
      efficiency_min_hours_saved: "5",
      efficiency_min_jobs: "10",
      efficiency_amount_cents: "25.00",
      ...over,
    });
  const rules = (org: string) =>
    api.sql<{ enabled: boolean; min_avg_rating: string; amount_cents: number; efficiency_enabled: boolean; efficiency_amount_cents: number }>(
      "select enabled, min_avg_rating::text as min_avg_rating, amount_cents, efficiency_enabled, efficiency_amount_cents from public.bonus_rules where organization_id = $1",
      [org],
    );

  it("saves the company's one rule set, and saving again changes it rather than adding another", async () => {
    const c = await company();
    const first = await as(c.owner, () => bonus.upsertBonusRuleAction({}, bonusForm()));
    expect(first).not.toHaveProperty("errors");
    expect(await rules(c.org)).toEqual([{ enabled: true, min_avg_rating: "4.80", amount_cents: 5000, efficiency_enabled: false, efficiency_amount_cents: 2500 }]);
    await as(c.olha, () => bonus.upsertBonusRuleAction({}, bonusForm({ enabled: "", efficiency_enabled: "on", amount_cents: "75" })));
    expect(await rules(c.org)).toEqual([{ enabled: false, min_avg_rating: "4.80", amount_cents: 7500, efficiency_enabled: true, efficiency_amount_cents: 2500 }]);
  });

  it("refuses a cleaner and an out-of-range rule, and leaves the saved rules alone", async () => {
    const c = await company();
    await as(c.owner, () => bonus.upsertBonusRuleAction({}, bonusForm()));
    const cleaner = await as(c.anna, () => bonus.upsertBonusRuleAction({}, bonusForm({ amount_cents: "999" })));
    expect(cleaner).toMatchObject({ errors: { _form: expect.any(String) } });
    expect(await as(c.owner, () => bonus.upsertBonusRuleAction({}, bonusForm({ min_avg_rating: "6" })))).toMatchObject({
      errors: { min_avg_rating: "Average rating must be between 1 and 5" },
    });
    expect((await rules(c.org))[0].amount_cents).toBe(5000);
  });
});

describe.skipIf(!hasPostgrest)("Settings → Holidays", { timeout: 90_000 }, () => {
  it("saves a country and province, refuses one that isn't on the list, and clears", async () => {
    const c = await company();
    const other = await company();
    expect(await as(c.owner, () => currency.saveHolidayRegionAction({}, form({ holiday_country: "ca", holiday_state: "ab" })))).toEqual({ success: true });
    expect((await orgRow(c.org)).holiday_region).toBe("CA-AB");
    expect((await orgRow(other.org)).holiday_region, "only this company").toBeNull();

    expect(await as(c.owner, () => currency.saveHolidayRegionAction({}, form({ holiday_country: "ZZ" })))).toEqual({
      errors: { holiday_country: "Pick a country from the list." },
    });
    expect(await as(c.owner, () => currency.saveHolidayRegionAction({}, form({ holiday_country: "CA", holiday_state: "XX" })))).toEqual({
      errors: { holiday_country: "Pick a country from the list." },
    });
    expect(await as(c.olha, () => currency.saveHolidayRegionAction({}, form({ holiday_country: "US" })))).toEqual({
      errors: { _form: "You don't have permission." },
    });
    expect((await orgRow(c.org)).holiday_region).toBe("CA-AB");

    expect(await as(c.owner, () => currency.saveHolidayRegionAction({}, form({ holiday_country: "" })))).toEqual({ success: true });
    expect((await orgRow(c.org)).holiday_region).toBeNull();
  });
});

describe.skipIf(!hasPostgrest)("Settings → Automations: one client's messages", { timeout: 90_000 }, () => {
  const prefs = async (client: string) =>
    (
      await api.sql<{ contact_preference: string; contact_overrides: Record<string, unknown> | null }>(
        "select contact_preference, contact_overrides from public.clients where id = $1",
        [client],
      )
    )[0];

  it("saves a client's choices, keeping only values it knows", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Quiet Client");
    await as(c.owner, () =>
      automations.setClientNotificationPrefsAction(
        form({
          client_id: client,
          contact_preference: "custom",
          override_booking: "email",
          override_billing: "off",
          override_growth: "carrier-pigeon",
          muted_events: JSON.stringify(["reminder", "drop table", "review_request"]),
          advanced: "true",
        }),
      ),
    );
    expect(await prefs(client)).toEqual({
      contact_preference: "custom",
      contact_overrides: { booking: "email", billing: "off", muted_events: ["reminder", "review_request"], advanced: true },
    });

    await as(c.owner, () => automations.setClientNotificationPrefsAction(form({ client_id: client, contact_preference: "do_not_contact", muted_events: "{not json" })));
    expect(await prefs(client)).toEqual({ contact_preference: "do_not_contact", contact_overrides: {} });
  });

  it("changes nothing for a manager, an unknown choice, or another company's client", async () => {
    const c = await company();
    const other = await company();
    const client = await addClient(api.sql, c.org, "Mine Prefs");
    const theirs = await addClient(api.sql, other.org, "Their Prefs");
    const before = await prefs(client);
    const theirBefore = await prefs(theirs);

    await as(c.olha, () => automations.setClientNotificationPrefsAction(form({ client_id: client, contact_preference: "do_not_contact" })));
    await as(c.owner, () => automations.setClientNotificationPrefsAction(form({ client_id: client, contact_preference: "spam_them" })));
    await as(c.owner, () => automations.setClientNotificationPrefsAction(form({ client_id: theirs, contact_preference: "do_not_contact" })));
    expect(await prefs(client)).toEqual(before);
    expect(await prefs(theirs)).toEqual(theirBefore);
  });
});

describe.skipIf(!hasPostgrest)("Settings → Sender email and its verification link", { timeout: 90_000 }, () => {
  const verify = async (query: string) => {
    const res = await verifySender(new NextRequest(`http://localhost/api/verify-sender${query}`, { headers: { "x-forwarded-for": "198.51.100.7" } }));
    return { status: res.status, location: res.headers.get("location") };
  };

  it("saves the address, mails a link to it, and the link verifies it once", async () => {
    const c = await company();
    const res = await as(c.owner, () => email.saveSenderEmailAction({}, form({ sender_email: "  Office@Svit-Clean.example.com " })));
    expect(res).toEqual({ success: true });
    const saved = await orgRow(c.org);
    expect(saved).toMatchObject({ sender_email: "office@svit-clean.example.com", sender_email_verified_at: null });
    expect(saved.sender_email_token).toMatch(/^[a-z0-9]+.[A-Za-z0-9_-]{40,}$/);
    expect(outbox.email.map((m) => m.to)).toEqual(["office@svit-clean.example.com"]);
    expect(outbox.email[0].subject).toBe(`Verify your sender email for ${c.name}`);
    expect(outbox.email[0].text).toContain(`${SITE}/api/verify-sender?token=${saved.sender_email_token}&org=${c.org}`);

    const other = await company();
    expect((await verify(`?token=${saved.sender_email_token}&org=${other.org}`)).location, "the token is this company's only").toBe(
      `${SITE}/app/settings/email?verified=invalid`,
    );
    expect((await verify(`?token=wrong&org=${c.org}`)).location).toBe(`${SITE}/app/settings/email?verified=invalid`);
    expect((await verify(`?org=${c.org}`)).location).toBe(`${SITE}/app/settings/email?verified=invalid`);
    expect((await orgRow(c.org)).sender_email_verified_at).toBeNull();

    const ok = await verify(`?token=${saved.sender_email_token}&org=${c.org}`);
    expect(ok.status).toBe(307);
    expect(ok.location).toBe(`${SITE}/app/settings/email?verified=success`);
    expect(await orgRow(c.org)).toMatchObject({ sender_email: "office@svit-clean.example.com", sender_email_token: null, sender_email_verified_at: expect.any(String) });
    expect((await verify(`?token=${saved.sender_email_token}&org=${c.org}`)).location, "single use").toBe(`${SITE}/app/settings/email?verified=invalid`);
    expect((await orgRow(other.org)).sender_email_verified_at).toBeNull();
  });

  it("refuses a free-mail or malformed address and anyone but the owner or an admin; an empty save clears it", async () => {
    const c = await company();
    await api.sql(
      "update public.organizations set sender_email = 'office@svit.example.com', sender_email_verified_at = now(), sender_email_token = null where id = $1",
      [c.org],
    );
    expect(await as(c.owner, () => email.saveSenderEmailAction({}, form({ sender_email: "svit@gmail.com" })))).toMatchObject({
      errors: { sender_email: expect.stringMatching(/business domain/) },
    });
    expect(await as(c.owner, () => email.saveSenderEmailAction({}, form({ sender_email: "not-an-email" })))).toEqual({
      errors: { sender_email: "Enter a valid email address." },
    });
    expect(await as(c.olha, () => email.saveSenderEmailAction({}, form({ sender_email: "olha@svit.example.com" })))).toEqual({
      errors: { _form: "You don't have permission." },
    });
    expect(await orgRow(c.org)).toMatchObject({ sender_email: "office@svit.example.com", sender_email_verified_at: expect.any(String) });
    expect(outbox.email).toEqual([]);

    expect(await as(c.owner, () => email.saveSenderEmailAction({}, form({ sender_email: "" })))).toEqual({ success: true });
    expect(await orgRow(c.org)).toMatchObject({ sender_email: null, sender_email_verified_at: null, sender_email_token: null });
  });

  it("a save refused by the daily limit leaves the verified sender as it was", async () => {
    const c = await company();
    for (let i = 0; i < 5; i++) {
      expect(await as(c.owner, () => email.saveSenderEmailAction({}, form({ sender_email: "office@svit.example.com" })))).toEqual({ success: true });
    }
    const { sender_email_token } = await orgRow(c.org);
    expect((await verify(`?token=${sender_email_token}&org=${c.org}`)).location).toBe(`${SITE}/app/settings/email?verified=success`);

    const refused = await as(c.owner, () => email.saveSenderEmailAction({}, form({ sender_email: "typo@svit.example.com" })));
    expect(refused).toEqual({ errors: { _form: "Five verification emails a day is the limit. Try again tomorrow." } });
    expect(await orgRow(c.org)).toMatchObject({ sender_email: "office@svit.example.com", sender_email_verified_at: expect.any(String) });
  });

  it("the link stops working after the 24 hours its email promises", async () => {
    const c = await company();
    await as(c.owner, () => email.saveSenderEmailAction({}, form({ sender_email: "late@svit.example.com" })));
    expect(outbox.email[0].text).toContain("Expires in 24 hours");
    const { sender_email_token } = await orgRow(c.org);
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(Date.now() + 48 * 3_600_000) });
    try {
      expect((await verify(`?token=${sender_email_token}&org=${c.org}`)).location).toBe(`${SITE}/app/settings/email?verified=invalid`);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe.skipIf(!hasPostgrest)("Settings → Data: the danger zone", { timeout: 90_000 }, () => {
  it("the owner schedules deletion by typing the name, and cancels it; nobody else can", async () => {
    const c = await company();
    const other = await company();
    expect(await as(c.owner, () => data.scheduleOrgDeletionAction({}, form({ confirm_name: "wrong name", expected_name: c.name })))).toEqual({
      error: "Confirmation name didn't match. Deletion NOT scheduled.",
    });
    expect((await orgRow(c.org)).deletion_scheduled_at).toBeNull();

    expect(await as(c.olha, () => data.scheduleOrgDeletionAction({}, form({ confirm_name: c.name, expected_name: c.name })))).toEqual({ redirected: "/app" });
    expect(await as(c.anna, () => data.scheduleOrgDeletionAction({}, form({ confirm_name: c.name, expected_name: c.name })))).toEqual({ redirected: "/field" });
    expect((await orgRow(c.org)).deletion_scheduled_at).toBeNull();

    expect(await as(c.owner, () => data.scheduleOrgDeletionAction({}, form({ confirm_name: ` ${c.name} `, expected_name: c.name })))).toEqual({ ok: true });
    expect((await orgRow(c.org)).deletion_scheduled_at).not.toBeNull();
    expect((await orgRow(other.org)).deletion_scheduled_at, "only this company").toBeNull();

    expect(await as(c.olha, () => data.cancelOrgDeletionAction())).toEqual({ redirected: "/app" });
    expect((await orgRow(c.org)).deletion_scheduled_at, "a manager can't cancel it either").not.toBeNull();
    await as(c.owner, () => data.cancelOrgDeletionAction());
    expect((await orgRow(c.org)).deletion_scheduled_at).toBeNull();
  });

  it("the name typed must be the name of the company being deleted", async () => {
    const a = await company();
    const b = await company();
    // Svitlana owns both. The danger zone was opened for A; she has since
    // switched to B in another tab.
    await api.sql("insert into public.memberships (organization_id, profile_id, role, status) values ($1, $2, 'owner', 'active')", [b.org, a.owner.userId]);
    const res = await as(
      a.owner,
      () => data.scheduleOrgDeletionAction({}, form({ confirm_name: a.name, expected_name: a.name })),
      [{ name: "cleanops_active_org", value: b.org }],
    );
    const bAfter = (await orgRow(b.org)).deletion_scheduled_at;
    await api.sql("update public.organizations set deletion_scheduled_at = null where id in ($1, $2)", [a.org, b.org]);
    expect(bAfter, `B (${b.name}) was not the name typed`).toBeNull();
    expect(res).toMatchObject({ error: expect.any(String) });
  });
});

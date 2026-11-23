/**
 * A company's own booking page (roadmap phase 1, 2026-11-22).
 *
 * A company has no page until it makes one in Settings: it claims the name,
 * builds a draft, previews it, publishes it. A visitor to a published page
 * can ask for a clean with no sign-in, and that lands in the office's
 * requests inbox.
 *
 * The real actions and lookups, on a real database, as the people who use
 * them: the owner, a manager, a cleaner, another company, and a stranger.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

type Sent = { to: string; subject: string; text?: string };
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
  sendEmail: async () => true,
  sendOrgEmail: async (_o: string, a: Sent) => {
    outbox.email.push(a);
    return true;
  },
  sendOrgEmailDetailed: async (_o: string, a: Sent) => {
    outbox.email.push(a);
    return { ok: true };
  },
}));
vi.mock("@/lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/push")>()),
  sendPushToMembership: async () => 1,
}));
// One address presses everything here; the per-connection limit is not
// what is being tested. The per-email limit stays real.
vi.mock("@/lib/rate-limit-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit-helpers")>()),
  checkIpRateLimit: async () => ({ allowed: true }),
}));

let api: Api;
let restoreEnv: () => void;
let settings: typeof import("@/app/app/settings/online-booking/actions");
let pages: typeof import("@/lib/booking-page");
let book: typeof import("@/app/book/[slug]/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  delete process.env.TURNSTILE_SECRET_KEY;
  settings = await import("@/app/app/settings/online-booking/actions");
  pages = await import("@/lib/booking-page");
  book = await import("@/app/book/[slug]/actions");
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

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const one of v) f.append(k, one);
    else f.set(k, v);
  }
  return f;
};
async function as<T>(who: Member | null, press: () => Promise<T>): Promise<T> {
  request.cookies = who ? api.sessionCookies(who.userId) : [];
  try {
    return await press();
  } finally {
    await settle();
  }
}

let seq = 0;
const unique = (word: string) => `${word}-${Date.now().toString(36)}-${++seq}`;

type Co = { org: string; name: string; owner: Member; admin: Member; manager: Member; anna: Member; services: { standard: string; deep: string } };
async function company(label = "Bright Homes"): Promise<Co> {
  const org = await addOrg(api.sql, label);
  await api.sql("update public.organizations set timezone = 'America/Regina', automations_enabled = true, contact_phone = '(780) 555-0199' where id = $1", [org]);
  const [{ name }] = await api.sql<{ name: string }>("select name from public.organizations where id = $1", [org]);
  const svc = async (n: string, cents: number | null) =>
    (
      await api.sql<{ id: string }>(
        "insert into public.service_types (organization_id, name, default_price_cents) values ($1, $2, $3) returning id",
        [org, n, cents],
      )
    )[0].id;
  return {
    org,
    name,
    owner: await addMember(api.sql, org, "owner", "Owner"),
    admin: await addMember(api.sql, org, "admin", "Admin"),
    manager: await addMember(api.sql, org, "manager", "Manager"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    services: { standard: await svc("Standard clean", 15000), deep: await svc("Deep clean", null) },
  };
}
const pageRow = async (c: Co) =>
  (await api.sql<{ slug: string; status: string; headline: string | null; intro: string | null }>(
    "select slug::text as slug, status, headline, intro from public.booking_pages where organization_id = $1",
    [c.org],
  ))[0] ?? null;
const create = (c: Co, who: Member, name: string) => as(who, () => settings.createBookingPageAction({}, form({ name })));
const publish = (c: Co, on = true) => as(c.owner, () => settings.setBookingPagePublishedAction({}, form({ publish: on ? "1" : "0" })));
/** A published page with Standard clean showing its price. */
async function livePage(c: Co): Promise<string> {
  const slug = unique("live");
  await create(c, c.owner, slug);
  await as(c.owner, () =>
    settings.saveBookingPageAction(
      {},
      form({
        name: slug,
        headline: "House cleaning you can count on",
        intro: "Family run since 2019.",
        show: [c.services.standard],
        [`listed_${c.services.standard}`]: "1",
        [`price_${c.services.standard}`]: "from",
        [`listed_${c.services.deep}`]: "1",
        [`price_${c.services.deep}`]: "hidden",
      }),
    ),
  );
  await publish(c);
  return slug;
}

describe.skipIf(!hasPostgrest)("making the page", { timeout: 120_000 }, () => {
  it("nobody has one until they make it; the owner makes a draft; a manager and a cleaner can't", async () => {
    const c = await company();
    expect(await pageRow(c), "nothing is made for a new company").toBeNull();
    const slug = unique("svit");

    expect(await create(c, c.manager, slug)).toEqual({ error: "Only owners and admins can set up the booking page." });
    expect(await create(c, c.anna, slug)).toEqual({ error: "Only owners and admins can set up the booking page." });
    expect(await pageRow(c)).toBeNull();

    const made = await create(c, c.owner, `  ${slug.toUpperCase()}  `);
    expect(made.error, api.log()).toBeUndefined();
    expect(made.ok).toMatch(/as a draft/);
    expect(await pageRow(c)).toEqual({ slug, status: "draft", headline: null, intro: null });
    // Pressed again: still one page, and no error.
    expect((await create(c, c.owner, unique("other"))).ok).toMatch(/already exists/);
    expect((await pageRow(c))!.slug).toBe(slug);
  });

  it("a name is tidied, and a reserved, too-short or taken one is refused in words", async () => {
    const c = await company();
    const rival = await company("Rival Co");
    expect((await create(c, c.owner, "admin")).error).toMatch(/can't be used as a link name/);
    expect((await create(c, c.owner, "ab")).error).toMatch(/at least 3/);
    expect((await create(c, c.owner, "!!!")).error).toBe("Type a name for your link.");
    expect(await pageRow(c)).toBeNull();

    const slug = unique("shared");
    expect((await create(rival, rival.owner, slug)).ok).toBeTruthy();
    expect(await create(c, c.owner, slug)).toEqual({ error: `"${slug}" is already someone's link. Try another name.` });
    // The same name in capitals is the same name.
    expect((await create(c, c.owner, slug.toUpperCase())).error).toMatch(/already someone's link/);
    expect(await pageRow(c)).toBeNull();
  });
});

describe.skipIf(!hasPostgrest)("who can open it", { timeout: 120_000 }, () => {
  it("a draft exists only for that company's office; publishing opens it to anyone; taking it down closes it and keeps it", async () => {
    const c = await company();
    const other = await company("Other Co");
    const slug = unique("draft");
    await create(c, c.owner, slug);

    const open = (who: Member | null) => as(who, () => pages.publicBookingPage(slug));
    expect(await open(null), "a stranger").toBeNull();
    expect(await open(c.anna), "a cleaner of the company").toBeNull();
    expect(await open(other.owner), "another company's owner").toBeNull();
    for (const office of [c.owner, c.admin, c.manager]) {
      expect(await open(office)).toMatchObject({ preview: true, page: { slug, status: "draft" }, company: { name: c.name } });
    }
    // A preview takes no requests.
    expect(await as(c.owner, () => book.askForCleanAction({}, form({ slug, name: "Me", email: "me@example.test", service_other: "A clean" })))).toEqual({
      error: "This is a preview, so the form is switched off. Publish your page and it will take requests.",
    });

    expect((await publish(c)).ok).toMatch(/is live/);
    expect(await open(null)).toMatchObject({ preview: false, page: { status: "published" } });
    expect(await open(other.owner)).toMatchObject({ preview: false });

    expect((await publish(c, false)).ok).toMatch(/taken down/);
    expect(await open(null)).toBeNull();
    expect((await pageRow(c))!.slug, "kept").toBe(slug);
    expect(await as(c.manager, () => settings.setBookingPagePublishedAction({}, form({ publish: "1" })))).toEqual({
      error: "Only owners and admins can set up the booking page.",
    });
    expect((await pageRow(c))!.status).toBe("draft");
  });

  it("a name nobody claimed, or one that isn't a name, opens nothing", async () => {
    for (const slug of [unique("nobody"), "", "admin", "../etc", "A B", "x".repeat(200)]) {
      expect(await as(null, () => pages.publicBookingPage(slug)), slug.slice(0, 20)).toBeNull();
    }
  });
});

describe.skipIf(!hasPostgrest)("what is on it", { timeout: 120_000 }, () => {
  it("the words, and only the ticked services, each with its price shown the way it was set", async () => {
    const c = await company();
    const slug = await livePage(c);
    const seen = await as(null, () => pages.publicBookingPage(slug));
    expect(seen?.page).toMatchObject({ headline: "House cleaning you can count on", intro: "Family run since 2019." });
    expect(seen?.company).toMatchObject({ name: c.name, contact_phone: "(780) 555-0199" });
    expect(seen?.services.map((s) => [s.name, s.booking_page_price])).toEqual([["Standard clean", "from"]]);

    // Another company's service can't be switched on from this form.
    const other = await company("Other Co");
    await as(c.owner, () =>
      settings.saveBookingPageAction({}, form({ name: slug, show: [other.services.standard], [`listed_${other.services.standard}`]: "1", [`price_${other.services.standard}`]: "fixed" })),
    );
    const [theirs] = await api.sql<{ show: boolean; mode: string }>(
      "select show_on_booking_page as show, booking_page_price as mode from public.service_types where id = $1",
      [other.services.standard],
    );
    expect(theirs).toEqual({ show: false, mode: "hidden" });
    // And a service this save didn't list keeps what it had.
    const again = await as(null, () => pages.publicBookingPage(slug));
    expect(again?.services.map((s) => s.name)).toEqual(["Standard clean"]);
  });

  it("renaming moves the link: the new one opens, the old one doesn't; a taken name is refused and nothing changes", async () => {
    const c = await company();
    const rival = await company("Rival Co");
    const slug = await livePage(c);
    const rivalSlug = await livePage(rival);
    const next = unique("renamed");

    const saved = await as(c.owner, () => settings.saveBookingPageAction({}, form({ name: next, headline: "New headline", intro: "" })));
    expect(saved.ok, api.log()).toMatch(new RegExp(`sollos3\\.com/book/${next}\\. The old link no longer works`));
    expect(await as(null, () => pages.publicBookingPage(slug))).toBeNull();
    expect((await as(null, () => pages.publicBookingPage(next)))?.page.headline).toBe("New headline");

    const clash = await as(c.owner, () => settings.saveBookingPageAction({}, form({ name: rivalSlug, headline: "Hijack", intro: "" })));
    expect(clash.error).toMatch(/already someone's link/);
    expect(await pageRow(c)).toMatchObject({ slug: next, headline: "New headline" });
    expect((await as(null, () => pages.publicBookingPage(rivalSlug)))?.company.name).toBe(rival.name);
  });
});

describe.skipIf(!hasPostgrest)("a visitor asks for a clean", { timeout: 120_000 }, () => {
  const ask = (slug: string, over: Record<string, string> = {}) =>
    as(null, () =>
      book.askForCleanAction(
        {},
        form({ slug, name: "Dana Whitfield", email: `dana.${Date.now()}.${++seq}@example.test`, phone: "780 555 0142", service_other: "A regular house clean", preferred_time_window: "morning", address: "12 Elm St", notes: "Two cats", ...over }),
      ),
    );
  const requestsFor = (c: Co) =>
    api.sql<{ client: string; service: string; status: string; window: string | null; address: string | null; notes: string | null }>(
      "select client_id as client, service_type as service, status, preferred_time_window as window, address, notes from public.booking_requests where organization_id = $1 order by created_at",
      [c.org],
    );

  it("someone new becomes a lead, the request reaches the office's inbox, and both are told", async () => {
    const c = await company();
    const slug = await livePage(c);
    const email = `new.${Date.now()}@example.test`;

    expect(await ask(slug, { email, service_id: c.services.standard, service_other: "" }), api.log()).toEqual({ ok: true });
    const [person] = await api.sql<{ id: string; name: string; lifecycle: string; lead_source: string | null; phone: string | null }>(
      "select id, name, lifecycle, lead_source, phone from public.clients where organization_id = $1 and lower(email) = $2",
      [c.org, email],
    );
    expect(person).toMatchObject({ name: "Dana Whitfield", lifecycle: "lead", lead_source: "web_form" });
    expect(await requestsFor(c)).toEqual([
      { client: person.id, service: "Standard clean", status: "pending", window: "morning", address: "12 Elm St", notes: "Two cats" },
    ]);
    const told = await api.sql<{ r: string; body: string }>(
      "select recipient_membership_id as r, body from public.notifications where organization_id = $1 and title = 'New booking request'",
      [c.org],
    );
    expect(told.map((n) => n.r).sort()).toEqual([c.owner.membershipId, c.admin.membershipId, c.manager.membershipId].sort());
    expect(told[0].body).toContain("from your booking page");
    // The visitor hears back from the company, by name, and nothing is promised.
    const mail = outbox.email.find((m) => m.to === email);
    expect(mail?.subject).toBe(`${c.name} got your request`);
    expect(mail?.text).toContain("Nothing is booked yet.");
  });

  it("an email already on the books goes on that person's record, who stays what they were", async () => {
    const c = await company();
    const slug = await livePage(c);
    const existing = await addClient(api.sql, c.org, "Existing Erin");
    await api.sql("update public.clients set email = 'erin.books@example.test' where id = $1", [existing]);

    expect(await ask(slug, { email: "ERIN.BOOKS@example.test", name: "Erin E." })).toEqual({ ok: true });
    expect((await requestsFor(c)).map((r) => r.client)).toEqual([existing]);
    const people = await api.sql<{ id: string; lifecycle: string }>(
      "select id, lifecycle from public.clients where organization_id = $1 and lower(email) = 'erin.books@example.test'",
      [c.org],
    );
    expect(people).toEqual([{ id: existing, lifecycle: "client" }]);
  });

  it("is refused in words when it can't be answered, and nothing is filed", async () => {
    const c = await company();
    const slug = await livePage(c);
    expect(await ask(slug, { name: "  " })).toEqual({ error: "Tell us your name." });
    expect((await ask(slug, { email: "dana at home" })).error).toMatch(/We need an email address/);
    expect((await ask(slug, { email: "" })).error).toMatch(/We need an email address/);
    expect(await ask(slug, { service_other: "" })).toEqual({ error: "Tell us what you'd like cleaned." });
    expect((await ask(slug, { notes: "My card is 4242 4242 4242 4242" })).error).toBeTruthy();
    expect((await ask(slug, { preferred_date: "next tuesday" })).error).toMatch(/Pick the date from the calendar/);
    expect(await ask(unique("nowhere"))).toEqual({ error: "This page isn't available any more." });
    expect(await requestsFor(c)).toEqual([]);
  });

  it("a script that fills the hidden field is thanked and ignored", async () => {
    const c = await company();
    const slug = await livePage(c);
    expect(await ask(slug, { website: "http://spam.example" })).toEqual({ ok: true });
    expect(await requestsFor(c)).toEqual([]);
    const [{ n }] = await api.sql<{ n: number }>("select count(*)::int as n from public.clients where organization_id = $1", [c.org]);
    expect(n).toBe(0);
    expect(outbox.email).toEqual([]);
  });

  it("the same address can't flood the inbox: three in an hour, then it is told to call", async () => {
    const c = await company();
    const slug = await livePage(c);
    const email = `eager.${Date.now()}@example.test`;
    for (let i = 0; i < 3; i++) expect(await ask(slug, { email }), `ask ${i + 1}`).toEqual({ ok: true });
    expect((await ask(slug, { email })).error).toMatch(/You've sent a few requests already/);
    expect(await requestsFor(c)).toHaveLength(3);
  });

  it("a page that was taken down takes no more requests", async () => {
    const c = await company();
    const slug = await livePage(c);
    await publish(c, false);
    expect(await ask(slug)).toEqual({ error: "This page isn't available any more." });
    expect(await requestsFor(c)).toEqual([]);
  });
});

/**
 * A visitor books a time on a company's page (roadmap phase 3, 2026-11-22).
 *
 * The real actions on a real database, as a stranger with no sign-in: what
 * times they are shown, what a booking writes, who hears about it, what
 * happens when the time has gone, and everything that is refused.
 *
 * The clock is the real one, so the days used are a few days out on
 * Regina's calendar (UTC-6 all year), open every day nine to five.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addCrew, addMember, addOrg, type Member } from "./harness";
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
let book: typeof import("@/app/book/[slug]/time/actions");
let office: typeof import("@/app/app/bookings/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  delete process.env.TURNSTILE_SECRET_KEY;
  settings = await import("@/app/app/settings/online-booking/actions");
  book = await import("@/app/book/[slug]/time/actions");
  office = await import("@/app/app/bookings/actions");
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

/** A day `n` days out on Regina's calendar. */
const dayOut = (n: number) => new Date(Date.now() - 6 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
/** A Regina wall-clock time as an instant. */
const regina = (ymd: string, hhmm: string) => Date.parse(`${ymd}T${hhmm}:00Z`) + 6 * 3_600_000;
const D = dayOut(3);

let seq = 0;
type Mode = "off" | "approve" | "instant";
type Co = { org: string; name: string; slug: string; owner: Member; admin: Member; manager: Member; anna: Member; bea: Member; standard: string; noLength: string; hidden: string };
/** A published page, open every day nine to five, hourly starts, Anna taking online bookings. */
async function company(mode: Mode, opts: { sharesHours?: boolean; takers?: "anna" | "both" } = {}): Promise<Co> {
  const org = await addOrg(api.sql, "Book Online");
  await api.sql("update public.organizations set timezone = 'America/Regina', automations_enabled = true, automation_settings = $2::jsonb where id = $1", [
    org,
    JSON.stringify({ divide_crew_hours: { enabled: opts.sharesHours === true } }),
  ]);
  const [{ name }] = await api.sql<{ name: string }>("select name from public.organizations where id = $1", [org]);
  const person = async (role: "owner" | "admin" | "manager" | "employee", n: string) => {
    const m = await addMember(api.sql, org, role, n);
    await api.sql("update public.memberships set display_name = $2 where id = $1", [m.membershipId, n]);
    return m;
  };
  const svc = async (n: string, minutes: number | null, show: boolean) =>
    (
      await api.sql<{ id: string }>(
        "insert into public.service_types (organization_id, name, default_duration_minutes, default_price_cents, show_on_booking_page, booking_page_price) values ($1, $2, $3, 15000, $4, 'fixed') returning id",
        [org, n, minutes, show],
      )
    )[0].id;
  const c: Co = {
    org,
    name,
    slug: `online-${Date.now().toString(36)}-${++seq}`,
    owner: await person("owner", "Olivia"),
    admin: await person("admin", "Adam"),
    manager: await person("manager", "Mara"),
    anna: await person("employee", "Anna"),
    bea: await person("employee", "Bea"),
    standard: await svc("Standard clean", 120, true),
    noLength: await svc("Windows", null, true),
    hidden: await svc("Office clean", 120, false),
  };
  const hours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: "09:00", end: "17:00" }]]));
  await api.sql(
    "insert into public.booking_pages (organization_id, slug, status, time_booking, opening_hours, slot_step_minutes, gap_minutes, min_notice_hours) values ($1, $2, 'published', $3, $4::jsonb, 60, 30, 24)",
    [org, c.slug, mode, JSON.stringify(hours)],
  );
  for (const [n, m] of Object.entries({ owner: c.owner, admin: c.admin, manager: c.manager })) {
    await api.sql("update public.memberships set contact_email = $2 where id = $1", [m.membershipId, `${n}.${m.membershipId.slice(0, 6)}@office.test`]);
  }
  const takers = opts.takers === "both" ? [c.anna, c.bea] : [c.anna];
  await api.sql("update public.memberships set takes_online_bookings = true where id = any($1::uuid[])", [takers.map((m) => m.membershipId)]);
  return c;
}

const times = (c: Co, serviceId = c.standard, from: string | null = null) => as(null, () => book.openTimesAction(c.slug, serviceId, from));
/** The start labels offered on one day, or [] when the day isn't listed. */
async function labelsOn(c: Co, ymd: string) {
  const res = await times(c, c.standard, ymd);
  return res.days.find((d) => d.ymd === ymd)?.times.map((t) => t.label) ?? [];
}
const press = (c: Co, over: Record<string, string> = {}, who: Member | null = null) =>
  as(who, () =>
    book.bookTimeAction(
      {},
      form({
        slug: c.slug,
        service_id: c.standard,
        at: String(regina(D, "10:00")),
        name: "Dana Whitfield",
        email: `dana.${Date.now()}.${++seq}@example.test`,
        phone: "780 555 0142",
        address: "12 Elm Street",
        notes: "",
        ...over,
      }),
    ),
  );
type Visit = { id: string; status: string; at: string; minutes: number; lead: string | null; client: string; online: boolean; service: string | null; cents: number; address: string | null };
const visits = (c: Co) =>
  api.sql<Visit>(
    `select id, status::text as status, scheduled_at as at, duration_minutes as minutes, assigned_to as lead, client_id as client,
            booked_online_at is not null as online, service_type_label as service, total_cents as cents, address
       from public.bookings where organization_id = $1 order by created_at`,
    [c.org],
  );
const crewOf = async (bookingId: string) =>
  (await api.sql<{ m: string; p: boolean }>("select membership_id as m, is_primary as p from public.booking_assignees where booking_id = $1 order by is_primary desc, membership_id", [bookingId]));
const lifecycle = async (clientId: string) => (await api.sql<{ l: string }>("select lifecycle as l from public.clients where id = $1", [clientId]))[0].l;
const notices = (c: Co, title: string) =>
  api.sql<{ r: string; body: string; href: string }>("select recipient_membership_id as r, body, href from public.notifications where organization_id = $1 and title = $2", [c.org, title]);
/** Emails that reached the office (owner, admin, manager addresses). */
const officeMail = () => outbox.email.filter((m) => m.to.endsWith("@office.test"));
const HOURLY = ["9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM"];

describe.skipIf(!hasPostgrest)("switched off, which is how every page starts", { timeout: 120_000 }, () => {
  it("shows no times and books nothing", async () => {
    const c = await company("off");
    expect(await times(c)).toEqual({ days: [], nextFrom: null, error: "This can't be booked online right now." });
    expect((await press(c)).error).toMatch(/can't be booked online any more/);
    expect(await visits(c)).toEqual([]);
  });

  it("the owner switches it on with the hours; a manager can't", async () => {
    const c = await company("off");
    const fields: Record<string, string> = { min_notice_hours: "24", max_days_ahead: "60", gap_minutes: "30", slot_step_minutes: "60", time_booking: "instant" };
    for (const d of [0, 1, 2, 3, 4, 5, 6]) Object.assign(fields, { [`open_${d}`]: "on", [`start_${d}`]: "09:00", [`end_${d}`]: "17:00" });
    expect(await as(c.manager, () => settings.saveOpenTimeRulesAction({}, form(fields)))).toEqual({ error: "Only owners and admins can set up the booking page." });
    expect((await times(c)).error).toBeTruthy();
    expect((await as(c.owner, () => settings.saveOpenTimeRulesAction({}, form(fields)))).error, api.log()).toBeUndefined();
    expect(await labelsOn(c, D)).toEqual(HOURLY);
    // A value that isn't one of the three changes nothing.
    await as(c.owner, () => settings.saveOpenTimeRulesAction({}, form({ ...fields, time_booking: "everyone" })));
    expect(await labelsOn(c, D)).toEqual(HOURLY);
  });
});

describe.skipIf(!hasPostgrest)("booked straight away", { timeout: 120_000 }, () => {
  it("the visitor sees days and times and nothing else; a booking is a real, confirmed visit, with nobody on it, and the office is emailed", async () => {
    const c = await company("instant");
    const shown = await times(c);
    expect(shown.error).toBeUndefined();
    expect(shown.days.length).toBeGreaterThan(5);
    expect(shown.nextFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Days and start times only: nobody's name or id, no reasons.
    const raw = JSON.stringify(shown);
    for (const m of [c.anna, c.bea, c.owner]) expect(raw).not.toContain(m.membershipId);
    expect(Object.keys(shown.days[0]).sort()).toEqual(["label", "times", "ymd"]);
    expect(Object.keys(shown.days[0].times[0]).sort()).toEqual(["at", "label"]);
    expect(shown.days.find((d) => d.ymd === D)?.times.map((t) => t.label)).toEqual(HOURLY);

    const email = `new.${Date.now()}@example.test`;
    const done = await press(c, { email, notes: "Two cats, key under the mat" });
    expect(done.error, api.log()).toBeUndefined();
    expect(done.done?.held).toBe(false);
    expect(done.done?.when).toMatch(/ at 10:00 AM$/);

    const [v, ...rest] = await visits(c);
    expect(rest).toEqual([]);
    // Nobody is put on it: the office chooses who (2026-11-25).
    expect(v).toMatchObject({ status: "confirmed", minutes: 120, lead: null, online: true, service: "Standard clean", cents: 15000, address: "12 Elm Street" });
    expect(Date.parse(v.at)).toBe(regina(D, "10:00"));
    expect(await crewOf(v.id)).toEqual([]);
    // Someone new: on the books, and a client now that they have a visit.
    const [person] = await api.sql<{ id: string; name: string; lead_source: string | null }>("select id, name, lead_source from public.clients where organization_id = $1 and lower(email) = $2", [c.org, email]);
    expect(person).toMatchObject({ id: v.client, name: "Dana Whitfield", lead_source: "web_form" });
    expect(await lifecycle(v.client)).toBe("client");
    // Their words reach the crew as the client's note for this visit.
    expect(await api.sql("select kind, body, status from public.client_job_requests where booking_id = $1", [v.id])).toEqual([
      { kind: "job_note", body: "Two cats, key under the mat", status: "resolved" },
    ]);
    // The office is told, with a link to the visit, in the app and by email,
    // and asked to put a cleaner on it.
    const told = await notices(c, "New online booking: Dana Whitfield");
    expect(told.map((n) => n.r).sort()).toEqual([c.owner.membershipId, c.admin.membershipId, c.manager.membershipId].sort());
    expect(told[0].body).toContain("Dana Whitfield booked Standard clean");
    expect(told[0].body).toContain("Nobody is on it yet: put a cleaner on it.");
    expect(told[0].href).toBe(`/app/bookings/${v.id}`);
    expect(officeMail().map((m) => m.to.split(".")[0]).sort()).toEqual(["admin", "manager", "owner"]);
    // The visitor is told, even though this company never switched on its
    // confirmation emails: the page promised one.
    const mail = outbox.email.filter((m) => m.to === email);
    expect(mail.map((m) => m.subject)).toEqual([`You're booked with ${c.name}`]);
    expect(mail[0].text).toContain(done.done!.when);
    expect(mail[0].text).toMatch(/See or change this visit: \S+\/v\//);

    // That time, and anything inside the gap either side, is gone.
    expect(await labelsOn(c, D)).toEqual(["1:00 PM", "2:00 PM", "3:00 PM"]);
  });

  it("the time has gone: the second visitor is told, and nothing half-made is left", async () => {
    const c = await company("instant");
    expect((await press(c)).done).toBeTruthy();
    expect(await press(c)).toEqual({ taken: true });
    // One that overlaps it, and one inside the gap.
    expect(await press(c, { at: String(regina(D, "11:00")) })).toEqual({ taken: true });
    expect(await press(c, { at: String(regina(D, "12:00")) })).toEqual({ taken: true });
    expect((await visits(c)).length).toBe(1);
  });

  it("only a start that was really offered can be booked", async () => {
    const c = await company("instant");
    for (const at of [regina(D, "03:00"), regina(D, "10:20"), regina(D, "16:00"), regina(dayOut(0), "23:00"), regina(dayOut(200), "10:00"), 12345]) {
      expect(await press(c, { at: String(at) }), String(at)).toEqual({ taken: true });
    }
    expect(await press(c, { at: "soon" })).toEqual({ taken: true });
    expect(await visits(c)).toEqual([]);
  });

  it("nobody is put on it, but it holds a person's time: two free means two visitors, the third is told it went", async () => {
    const c = await company("instant", { takers: "both" });
    expect((await press(c)).done, api.log()).toBeTruthy();
    // Still offered: Bea (or Anna) is free at ten.
    expect(await labelsOn(c, D)).toContain("10:00 AM");
    expect((await press(c)).done, api.log()).toBeTruthy();
    // Both are spoken for now, though neither is named.
    expect(await press(c)).toEqual({ taken: true });
    expect((await visits(c)).map((v) => v.lead)).toEqual([null, null]);
    // Someone on a job then counts as busy as before: with one of them on
    // an office job at two, a single visitor can still have two.
    const client = await addClient(api.sql, c.org, "Jordan");
    const officeJob = await addBooking(api.sql, c.org, client, { scheduledAt: new Date(regina(D, "14:00")).toISOString(), durationMinutes: 60 });
    await addCrew(api.sql, c.org, officeJob, c.anna.membershipId);
    expect((await press(c, { at: String(regina(D, "14:00")) })).done, api.log()).toBeTruthy();
    expect(await press(c, { at: String(regina(D, "14:00")) })).toEqual({ taken: true });
  });

  it("once the office puts someone on it, the hold becomes that person's", async () => {
    const c = await company("instant", { takers: "both" });
    expect((await press(c)).done).toBeTruthy();
    const [v] = await visits(c);
    await addCrew(api.sql, c.org, v.id, c.anna.membershipId);
    await api.sql("update public.bookings set assigned_to = $2 where id = $1", [v.id, c.anna.membershipId]);
    // Bea is still free at ten; Anna isn't, and nothing is held twice.
    expect((await press(c)).done, api.log()).toBeTruthy();
    expect(await press(c)).toEqual({ taken: true });
  });

  it("a job for two holds two people for their share, with nobody named", async () => {
    const c = await company("instant", { sharesHours: true, takers: "both" });
    await api.sql("update public.service_types set online_crew_size = 2 where id = $1", [c.standard]);
    // Two hours shared by two is an hour on site, so 4:00 is offered.
    expect(await labelsOn(c, D)).toEqual([...HOURLY, "4:00 PM"]);
    expect((await press(c)).done, api.log()).toBeTruthy();
    const [v] = await visits(c);
    expect(v.minutes, "the one-person length is what is stored").toBe(120);
    expect(await crewOf(v.id)).toEqual([]);
    expect(v.lead).toBeNull();
    // 10 to 11 each, half an hour clear either side.
    expect(await labelsOn(c, D)).toEqual(["12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"]);
  });

  it("an email already on the books: the visit goes on that record, and the page says nothing about them", async () => {
    const c = await company("instant");
    const existing = await addClient(api.sql, c.org, "Existing Erin");
    await api.sql("update public.clients set email = 'erin.online@example.test', address = '99 Secret Lane', notes = 'Alarm code 4411' where id = $1", [existing]);
    const done = await press(c, { email: "ERIN.ONLINE@example.test", name: "Erin" });
    expect(Object.keys(done)).toEqual(["done"]);
    expect(JSON.stringify(done)).not.toMatch(/Secret|4411|Existing/);
    const [v] = await visits(c);
    expect(v).toMatchObject({ client: existing, address: "12 Elm Street" });
    const [{ address }] = await api.sql<{ address: string }>("select address from public.clients where id = $1", [existing]);
    expect(address, "their saved address is not overwritten").toBe("99 Secret Lane");
  });
});

describe.skipIf(!hasPostgrest)("the office confirms each one", { timeout: 120_000 }, () => {
  it("the visit is pending and holds the time; the visitor is told it isn't confirmed; confirming it tells them it is", async () => {
    const c = await company("approve");
    const email = `held.${Date.now()}@example.test`;
    const done = await press(c, { email });
    expect(done.error, api.log()).toBeUndefined();
    expect(done.done?.held).toBe(true);

    const [v] = await visits(c);
    expect(v).toMatchObject({ status: "pending", lead: null, online: true });
    expect(await lifecycle(v.client), "still a lead until it is confirmed").toBe("lead");
    const mail = outbox.email.filter((m) => m.to === email);
    expect(mail.map((m) => m.subject)).toEqual([`${c.name} is holding your time`]);
    expect(mail[0].text).toContain("It isn't confirmed yet.");
    expect(mail[0].text).toContain(done.done!.when);
    const told = await notices(c, "Online booking to confirm: Dana Whitfield");
    expect(told).toHaveLength(3);
    expect(told[0].body).toContain("The time is held.");
    expect(told[0].body).toContain("put a cleaner on it");
    expect(officeMail()).toHaveLength(3);
    // Held: nobody else can take it.
    expect(await press(c)).toEqual({ taken: true });
    expect(await labelsOn(c, D)).toEqual(["1:00 PM", "2:00 PM", "3:00 PM"]);

    // The office says yes, from the status dropdown.
    outbox.email.length = 0;
    const confirm = await as(c.manager, () => office.setBookingStatusAction(form({ id: v.id, status: "confirmed" })));
    expect(confirm, api.log()).toEqual({ ok: true });
    expect((await visits(c))[0].status).toBe("confirmed");
    expect(outbox.email.filter((m) => m.to === email).map((m) => m.subject)).toEqual([`You're booked with ${c.name}`]);
    expect(await lifecycle(v.client)).toBe("client");
  });

  it("a company with its confirmation emails switched on sends its own, once", async () => {
    const c = await company("instant");
    await api.sql("update public.organizations set automation_settings = automation_settings || $2::jsonb where id = $1", [
      c.org,
      JSON.stringify({ booking_confirmation_email: { enabled: true } }),
    ]);
    const email = `usual.${Date.now()}@example.test`;
    expect((await press(c, { email })).done, api.log()).toBeTruthy();
    const mail = outbox.email.filter((m) => m.to === email);
    expect(mail, "one email, and it is the company's own").toHaveLength(1);
    expect(mail[0].subject).not.toBe(`You're booked with ${c.name}`);
  });

  it("declining it gives the time back", async () => {
    const c = await company("approve");
    await press(c);
    const [v] = await visits(c);
    expect(await as(c.owner, () => office.setBookingStatusAction(form({ id: v.id, status: "cancelled" }))), api.log()).toEqual({ ok: true });
    expect(await labelsOn(c, D)).toEqual(HOURLY);
  });

  it("an office-made pending visit confirmed from the dropdown stays quiet, as before", async () => {
    const c = await company("approve");
    const client = await addClient(api.sql, c.org, "Phoned In");
    await api.sql("update public.clients set email = 'phoned@example.test' where id = $1", [client]);
    const id = await addBooking(api.sql, c.org, client, { scheduledAt: new Date(regina(D, "13:00")).toISOString(), status: "pending" });
    expect(await as(c.owner, () => office.setBookingStatusAction(form({ id, status: "confirmed" })))).toEqual({ ok: true });
    expect(outbox.email.filter((m) => m.to === "phoned@example.test")).toEqual([]);
  });
});

describe.skipIf(!hasPostgrest)("what is refused", { timeout: 120_000 }, () => {
  it("in words, and nothing is saved", async () => {
    const c = await company("instant");
    expect(await press(c, { name: "  " })).toEqual({ error: "Tell us your name." });
    expect((await press(c, { email: "dana at home" })).error).toMatch(/We need an email address/);
    expect(await press(c, { address: "" })).toEqual({ error: "Tell us the address of the place to clean." });
    expect((await press(c, { notes: "My card is 4242 4242 4242 4242" })).error).toBeTruthy();
    expect((await press(c, { website: "http://spam.example" })).error).toBeTruthy();
    // Not on the page, no length, somebody else's, nobody's.
    const other = await company("instant");
    for (const service_id of [c.hidden, c.noLength, other.standard, "not-an-id", ""]) {
      expect((await press(c, { service_id })).error, service_id).toMatch(/can't be booked online any more/);
      expect((await times(c, service_id)).error, service_id).toBe("This can't be booked online right now.");
    }
    expect((await press(c, { slug: "no-such-page-here" })).error).toMatch(/can't be booked online any more/);
    expect(await visits(c)).toEqual([]);
    expect(await visits(other)).toEqual([]);
    const [{ n }] = await api.sql<{ n: number }>("select count(*)::int as n from public.clients where organization_id = $1", [c.org]);
    expect(n, "nobody was added to the books").toBe(0);
  });

  it("a draft: the office can look through the times, and nothing is booked", async () => {
    const c = await company("instant");
    await api.sql("update public.booking_pages set status = 'draft' where organization_id = $1", [c.org]);
    expect((await times(c)).error, "a stranger").toBe("This can't be booked online right now.");
    expect((await press(c)).error).toMatch(/can't be booked online any more/);
    expect((await as(c.owner, () => book.openTimesAction(c.slug, c.standard, null))).days.length).toBeGreaterThan(0);
    expect((await press(c, {}, c.owner)).error).toBe("This is a preview, so nothing is booked. Publish your page and it will take bookings.");
    expect(await visits(c)).toEqual([]);
  });

  it("the same address can't fill the calendar: three in an hour, then it is told to call", async () => {
    const c = await company("instant");
    const email = `eager.${Date.now()}@example.test`;
    for (const [i, hhmm] of ["09:00", "12:00", "15:00"].entries()) {
      expect((await press(c, { email, at: String(regina(dayOut(4 + i), hhmm)) })).done, `booking ${i + 1}: ${api.log()}`).toBeTruthy();
    }
    expect((await press(c, { email, at: String(regina(dayOut(8), "09:00")) })).error).toMatch(/You've made a few bookings already/);
    expect((await visits(c)).length).toBe(3);
  });

  it("nobody ticked, or no hours: there is nothing to pick", async () => {
    const c = await company("instant");
    await api.sql("update public.memberships set takes_online_bookings = false where organization_id = $1", [c.org]);
    expect(await times(c)).toMatchObject({ days: [] });
    expect(await press(c)).toEqual({ taken: true });
    expect(await visits(c)).toEqual([]);
  });
});

describe.skipIf(!hasPostgrest)("an online booking nobody is on yet", { timeout: 120_000 }, () => {
  const movable = async (id: string) =>
    (
      await api.sql<import("@/lib/visit-move").MovableVisit>(
        `select id, organization_id, client_id, series_id, scheduled_at, duration_minutes, status::text as status, archived_at,
                assigned_to, service_type_label, service_type::text as service_type
           from public.bookings where id = $1`,
        [id],
      )
    )[0];

  it("is on the dashboard as needing a cleaner until someone is put on it", async () => {
    const c = await company("instant");
    expect((await press(c)).done, api.log()).toBeTruthy();
    const [v] = await visits(c);
    const { collectNeedsYou } = await import("@/lib/needs-you");
    const before = (await collectNeedsYou(c.org)).items.filter((it) => it.kind === "needs_cleaner");
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ key: `cleaner:${v.id}`, href: `/app/bookings/${v.id}` });
    expect(before[0].title).toMatch(/^Dana Whitfield, .+: booked online, needs a cleaner$/);
    expect(before[0].actions).toEqual([{ kind: "link", label: "Put a cleaner on it", href: `/app/bookings/${v.id}/edit` }]);

    await addCrew(api.sql, c.org, v.id, c.anna.membershipId);
    expect((await collectNeedsYou(c.org)).items.filter((it) => it.kind === "needs_cleaner")).toEqual([]);
  });

  it("the client can still move it themselves, to a time someone who takes online bookings is free", async () => {
    const c = await company("instant");
    expect((await press(c)).done, api.log()).toBeTruthy();
    const [v] = await visits(c);
    const { visitMoveState, visitOpenTimes, moveVisit } = await import("@/lib/visit-move");
    const visit = await movable(v.id);
    expect((await visitMoveState(visit)).allowed).toBe(true);
    const open = await visitOpenTimes(visit, D);
    expect(open.ok).toBe(true);
    // Its own hold doesn't stand in its way: 9 and 11 are offered again,
    // but not its current ten o'clock.
    const onD = open.ok ? open.days.find((d) => d.ymd === D)?.times.map((t) => t.label) : [];
    expect(onD).toEqual(HOURLY.filter((l) => l !== "10:00 AM"));

    const moved = await moveVisit({ id: v.client, name: "Dana Whitfield" }, visit, regina(D, "14:00"));
    expect(moved, api.log()).toMatchObject({ ok: true });
    const [after] = await visits(c);
    expect(Date.parse(after.at)).toBe(regina(D, "14:00"));
    expect(after.lead).toBeNull();
    const told = await notices(c, "Dana Whitfield moved a visit");
    expect(told[0].body).toContain("Nobody is on it yet: put a cleaner on it.");
    // Ten is free again, two isn't.
    expect(await labelsOn(c, D)).toEqual(["9:00 AM", "10:00 AM", "11:00 AM"]);
  });

  it("an office-made visit with nobody on it still can't be moved by the client", async () => {
    const c = await company("instant");
    const client = await addClient(api.sql, c.org, "Phoned In");
    const id = await addBooking(api.sql, c.org, client, { scheduledAt: new Date(regina(D, "13:00")).toISOString() });
    const { visitMoveState } = await import("@/lib/visit-move");
    expect(await visitMoveState(await movable(id))).toMatchObject({ allowed: false });
  });
});

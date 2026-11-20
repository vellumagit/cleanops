/**
 * The website's forms, posted the way the website posts them, against a real
 * database behind the real PostgREST. Outbound email is caught.
 *
 *   the quote calculator     a lead, a draft estimate, an inbox item; both sides told
 *   the contact form         a lead with the message, an inbox item; both sides told
 *   the job application      an applicant with every field kept
 *   social & chat            ManyChat / GoHighLevel posts: a lead from the right
 *                            network, the office told, the person NOT emailed
 *   Settings → Intake forms  make, switch off, re-key and delete a form
 *
 * These are the doors new customers come in by, and nobody signs in to use
 * them: the token in the URL is the only gate. So the checks are that a live
 * token works whatever it's posted to, a dead one doesn't, bots get nothing,
 * and someone already on the books isn't moved backwards.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

type Sent = { to: string; subject: string; text?: string; html?: string };
const outbox = vi.hoisted(() => ({ email: [] as Sent[] }));
// A fresh set of rate-limit buckets per test, so the limits are the real ones
// but one test's posts never count against the next.
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
    checkRateLimit: (key: string, max?: number, windowMs?: number) =>
      real.checkRateLimit(`${limits.epoch}:${key}`, max, windowMs),
  };
});
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: async (a: Sent) => {
    outbox.email.push(a);
    return true;
  },
  sendOrgEmail: async (_o: string, a: Sent) => {
    outbox.email.push(a);
    return true;
  },
}));

const { POST: estimateRequest } = await import("@/app/api/estimate-request/[token]/route");
const { POST: contactRequest } = await import("@/app/api/contact-request/[token]/route");
const { POST: intake } = await import("@/app/api/intake/[token]/route");
const { POST: socialLead } = await import("@/app/api/social-lead/[token]/route");
const forms = await import("@/app/app/settings/intake-forms/actions");

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
  outbox.email.length = 0;
  limits.epoch += 1;
});

type Route = (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => Promise<Response>;

/** Post to a form route the way a browser or a form service would. */
async function post(
  route: Route,
  token: string,
  body: Record<string, unknown> | URLSearchParams,
  query = "",
): Promise<Response> {
  const isForm = body instanceof URLSearchParams;
  const req = new NextRequest(`http://localhost/api/form/${token}${query}`, {
    method: "POST",
    body: isForm ? body.toString() : JSON.stringify(body),
    headers: {
      "content-type": isForm ? "application/x-www-form-urlencoded" : "application/json",
      "x-forwarded-for": "203.0.113.9",
    },
  });
  try {
    return await route(req, { params: Promise.resolve({ token }) });
  } finally {
    await settle();
  }
}

/** Signed in as this member; a redirect is an answer too. */
async function as<T>(m: Member, press: () => Promise<T>): Promise<T | { redirected: string }> {
  request.cookies = api.sessionCookies(m.userId);
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

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

let seq = 0;
async function company() {
  const n = ++seq;
  const org = await addOrg(api.sql, "Forms Co");
  const contactEmail = `office${n}@forms.example.com`;
  await api.sql(
    `update public.organizations
        set timezone = 'America/Regina', automations_enabled = true,
            contact_email = $2, contact_phone = '+15875550100', default_contact_preference = 'email'
      where id = $1`,
    [org, contactEmail],
  );
  const owner = await addMember(api.sql, org, "owner", "Svitlana");
  const manager = await addMember(api.sql, org, "manager", "Office");
  const token = async (type: string, active = true) => {
    const t = `frm_test${n}${type.replace(/_/g, "")}${active ? "" : "off"}${Math.random().toString(36).slice(2, 10)}`;
    await api.sql(
      "insert into public.intake_forms (organization_id, name, type, token, active) values ($1, $2, $3, $4, $5)",
      [org, `${type} form`, type, t, active],
    );
    return t;
  };
  return {
    org,
    owner,
    manager,
    contactEmail,
    quote: await token("estimate_request"),
    contact: await token("contact"),
    jobs: await token("job_application"),
    quoteOff: await token("estimate_request", false),
    social: await token("social_lead"),
  };
}

const calculator = (over: Record<string, unknown> = {}) => ({
  fullName: "Dana Reyes",
  email: `dana.reyes${++seq}@example.com`,
  phone: "(587) 555-0142",
  address: "12 Elm St",
  city: "Calgary",
  bedrooms: 3,
  bathrooms: 2,
  pets: 1,
  oven: 1,
  fridge: 0,
  schedule: "Bi-weekly",
  cleaningDate: "2026-11-24",
  priceInitialLow: 240,
  priceInitialHigh: 290,
  priceRecurringLow: 150,
  priceRecurringHigh: 170,
  estInitMins: 300,
  hearAboutUs: "Google",
  notes: "Side door code is 4410",
  website: "",
  ...over,
});

type ClientRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  lifecycle: string;
  lead_stage: string | null;
  lead_source: string | null;
  lead_note: string | null;
};
const clientsNamed = (org: string, name: string) =>
  api.sql<ClientRow>(
    "select id, name, email, phone, address, lifecycle, lead_stage, lead_source, lead_note from public.clients where organization_id = $1 and name = $2",
    [org, name],
  );

describe.skipIf(!hasPostgrest)("the website quote calculator", () => {
  it("makes a lead, a draft estimate and an inbox item, and tells both sides", async () => {
    const c = await company();
    const sent = calculator();
    const res = await post(estimateRequest, c.quote, sent);
    expect(res.status).toBe(201);
    const { estimate_id } = (await res.json()) as { estimate_id: string };

    const [lead] = await clientsNamed(c.org, "Dana Reyes");
    expect(lead).toMatchObject({
      email: sent.email,
      address: "12 Elm St, Calgary",
      lifecycle: "lead",
      lead_stage: "new",
      lead_source: "web_form",
    });
    expect(lead.lead_note).toContain("Schedule: Bi-weekly");
    expect(lead.lead_note).toContain("3 bed, 2 bath");
    expect(lead.lead_note).toContain("Notes: Side door code is 4410");

    const [est] = await api.sql<{ client_id: string; status: string; total_cents: number; notes: string; service_description: string }>(
      "select client_id, status, total_cents, notes, service_description from public.estimates where id = $1",
      [estimate_id],
    );
    expect(est).toMatchObject({ client_id: lead.id, status: "draft", total_cents: 29000, service_description: "Bi-weekly" });
    expect(est.notes).toContain("first clean: $240–$290, then $150–$170 per visit");

    const inbox = await api.sql<{ status: string; body: string }>(
      "select status, body from public.client_job_requests where client_id = $1",
      [lead.id],
    );
    expect(inbox).toHaveLength(1);
    expect(inbox[0].status).toBe("open");
    expect(inbox[0].body.startsWith("Website estimate request")).toBe(true);

    const told = await api.sql<{ r: string }>(
      "select recipient_membership_id as r from public.notifications where organization_id = $1 and title = 'New estimate request'",
      [c.org],
    );
    expect(told.map((t) => t.r)).toContain(c.owner.membershipId);

    const toClient = outbox.email.filter((m) => m.to === sent.email);
    expect(toClient).toHaveLength(1);
    expect(toClient[0].subject).toContain("your quote request is being reviewed");
    const internal = outbox.email.filter((m) => m.subject === "New estimate request — Dana Reyes").map((m) => m.to);
    expect(internal).toContain(c.contactEmail);
    expect(internal.length, "the owner's sign-in address too").toBeGreaterThanOrEqual(2);
  });

  it("files a referral as a referral, and takes a plain HTML form post", async () => {
    const c = await company();
    const body = new URLSearchParams({
      fullName: "Marta Kowalczyk",
      email: `marta${++seq}@example.com`,
      priceInitialHigh: "310",
      hearAboutUs: "Referral",
    });
    const res = await post(estimateRequest, c.quote, body, "?redirect=https://svit.example.com/thanks");
    expect(res.status, "a plain form lands on the site's thank-you page").toBe(303);
    expect(res.headers.get("location")).toBe("https://svit.example.com/thanks");
    const [lead] = await clientsNamed(c.org, "Marta Kowalczyk");
    expect(lead).toMatchObject({ lifecycle: "lead", lead_source: "referral" });
  });

  it("turns away dead tokens, bots and nameless posts, and never redirects off https", async () => {
    const c = await company();
    expect((await post(estimateRequest, "frm_nosuchform", calculator())).status).toBe(404);
    expect((await post(estimateRequest, c.quoteOff, calculator())).status, "a switched-off form").toBe(404);
    expect((await post(estimateRequest, c.contact, calculator())).status, "a contact token on the quote route").toBe(404);

    const bot = await post(estimateRequest, c.quote, calculator({ fullName: "Bot McBotface", website: "http://spam.example" }));
    expect(bot.status, "bots are told it worked").toBe(201);
    expect(await clientsNamed(c.org, "Bot McBotface"), "and get nothing").toHaveLength(0);

    expect((await post(estimateRequest, c.quote, calculator({ fullName: "  " }))).status).toBe(400);

    const sneaky = await post(estimateRequest, c.quote, calculator({ fullName: "Ivy Chen" }), "?redirect=javascript:alert(1)");
    expect(sneaky.status).toBe(201);
    expect(await api.sql("select 1 from public.estimates where organization_id = $1", [c.org])).toHaveLength(1);
  });

  it("an existing client asking again stays a client, and the quote lands on their record", async () => {
    const c = await company();
    const id = await addClient(api.sql, c.org, "Regular");
    const email = `regular${++seq}@example.com`;
    await api.sql("update public.clients set email = $2, lead_note = 'Prefers mornings' where id = $1", [id, email]);

    const res = await post(estimateRequest, c.quote, calculator({ fullName: "Somebody Else Typed", email: email.toUpperCase() }));
    expect(res.status).toBe(201);
    const [row] = await api.sql<ClientRow>("select lifecycle, lead_stage, lead_note from public.clients where id = $1", [id]);
    expect(row.lifecycle).toBe("client");
    expect(row.lead_stage).toBeNull();
    expect(row.lead_note).toMatch(/^Prefers mornings\n---\nSchedule: Bi-weekly/);
    expect(await api.sql("select 1 from public.estimates where client_id = $1", [id])).toHaveLength(1);
    expect(await clientsNamed(c.org, "Somebody Else Typed"), "no second record").toHaveLength(0);
  });

  it("a lead already being worked keeps their place; a lost one comes back as contacted", async () => {
    const c = await company();
    const quoted = await addClient(api.sql, c.org, "Quoted");
    const lost = await addClient(api.sql, c.org, "Lost");
    const qEmail = `quoted${++seq}@example.com`;
    const lEmail = `lost${seq}@example.com`;
    await api.sql(
      "update public.clients set email = $2, lifecycle = 'lead', lead_stage = 'quoted', lead_source = 'phone' where id = $1",
      [quoted, qEmail],
    );
    await api.sql(
      "update public.clients set email = $2, lifecycle = 'lost', lead_stage = 'quoted', lead_source = 'phone' where id = $1",
      [lost, lEmail],
    );

    await post(estimateRequest, c.quote, calculator({ email: qEmail }));
    await post(contactRequest, c.contact, { name: "Whoever", email: lEmail, notes: "Still interested?" });

    const [q] = await api.sql<ClientRow>("select lifecycle, lead_stage, lead_source from public.clients where id = $1", [quoted]);
    expect(q, "asking again isn't starting over").toMatchObject({ lifecycle: "lead", lead_stage: "quoted", lead_source: "phone" });
    const [l] = await api.sql<ClientRow>("select lifecycle, lead_stage, lead_source from public.clients where id = $1", [lost]);
    expect(l, "back in play, with history").toMatchObject({ lifecycle: "lead", lead_stage: "contacted", lead_source: "phone" });
  });

  it("records every request but sends one address at most three confirmations an hour", async () => {
    const c = await company();
    const email = `repeat${++seq}@example.com`;
    for (let i = 0; i < 4; i++) {
      expect((await post(estimateRequest, c.quote, calculator({ fullName: "Repeat Asker", email }))).status).toBe(201);
    }
    expect(await api.sql("select 1 from public.estimates where organization_id = $1", [c.org])).toHaveLength(4);
    expect(outbox.email.filter((m) => m.to === email)).toHaveLength(3);
  });
});

describe.skipIf(!hasPostgrest)("the contact form", () => {
  it("makes a lead with the message, an inbox item, and tells both sides", async () => {
    const c = await company();
    const email = `jo${++seq}@example.com`;
    const res = await post(contactRequest, c.contact, {
      name: "Jo Lindqvist",
      email,
      phone: "403 555 0199",
      city: "Airdrie",
      urgency: "This week",
      notes: "Move-out clean for a 2 bed condo",
      page_url: "https://svit.example.com/contact",
      website: "",
    });
    expect(res.status).toBe(201);
    const [lead] = await clientsNamed(c.org, "Jo Lindqvist");
    expect(lead).toMatchObject({ email, lifecycle: "lead", lead_stage: "new", lead_source: "web_form", address: "Airdrie" });
    expect(lead.lead_note).toContain("Message: Move-out clean for a 2 bed condo");
    expect(lead.lead_note).toContain("Urgency: This week");
    const [req] = await api.sql<{ body: string; status: string }>("select body, status from public.client_job_requests where client_id = $1", [lead.id]);
    expect(req).toMatchObject({ status: "open" });
    expect(req.body.startsWith("Website inquiry")).toBe(true);
    const [n] = await api.sql<{ href: string; body: string }>(
      "select href, body from public.notifications where organization_id = $1 and title = 'New website inquiry' limit 1",
      [c.org],
    );
    expect(n.href).toBe("/app/leads");
    expect(n.body).toContain("Jo Lindqvist (Airdrie) — This week");
    expect(outbox.email.filter((m) => m.to === email)).toHaveLength(1);
    expect(outbox.email.some((m) => m.to === c.contactEmail && m.subject === "New website inquiry — Jo Lindqvist")).toBe(true);
    expect(await api.sql("select 1 from public.estimates where organization_id = $1", [c.org]), "no estimate from a contact").toHaveLength(0);
  });

  it("is reached through the generic intake address too, whatever path the site used", async () => {
    const c = await company();
    expect((await post(intake, c.contact, { name: "Via Intake", notes: "hello" })).status).toBe(201);
    expect(await clientsNamed(c.org, "Via Intake")).toHaveLength(1);
    expect((await post(intake, c.quote, calculator({ fullName: "Quote Via Intake" }))).status).toBe(201);
    expect(await api.sql("select 1 from public.estimates where organization_id = $1", [c.org])).toHaveLength(1);
    expect((await post(contactRequest, c.quote, { name: "Wrong door" })).status, "a quote token on the contact route").toBe(404);
  });
});

describe.skipIf(!hasPostgrest)("social & chat leads", () => {
  it("a ManyChat Instagram contact becomes an Instagram lead; the office is told and the person is not emailed", async () => {
    const c = await company();
    const email = `sarah${++seq}@example.com`;
    const res = await post(socialLead, c.social, {
      id: "1234567890",
      name: "Sarah Lee",
      first_name: "Sarah",
      last_name: "Lee",
      email,
      phone: null,
      ig_username: "sarah.cleans",
      last_input_text: "How much for a 3 bed deep clean?",
      custom_fields: { city: "Calgary" },
    });
    expect(res.status).toBe(201);
    const { lead_id } = (await res.json()) as { lead_id: string };

    const [lead] = await clientsNamed(c.org, "Sarah Lee");
    expect(lead).toMatchObject({ id: lead_id, email, lifecycle: "lead", lead_stage: "new", lead_source: "instagram", address: "Calgary" });
    expect(lead.lead_note).toMatch(/^Instagram lead\nMessage: How much for a 3 bed deep clean\?/);
    expect(lead.lead_note).toContain("Handle: @sarah.cleans");
    expect(lead.lead_note).toContain("Chat tool contact id: 1234567890");

    const [req] = await api.sql<{ body: string; status: string }>("select body, status from public.client_job_requests where client_id = $1", [lead.id]);
    expect(req.status).toBe("open");
    expect(req.body.startsWith("Instagram lead\n")).toBe(true);

    const [n] = await api.sql<{ body: string }>(
      "select body from public.notifications where organization_id = $1 and title = 'New Instagram lead' limit 1",
      [c.org],
    );
    expect(n.body).toContain("Sarah Lee (@sarah.cleans): How much");

    expect(outbox.email.filter((m) => m.to === email), "no confirmation email to someone mid-DM").toHaveLength(0);
    expect(outbox.email.some((m) => m.to === c.contactEmail && m.subject === "Instagram lead — Sarah Lee")).toBe(true);
  });

  it("a GoHighLevel contact with a website on file is a lead, not a bot, through the generic address too", async () => {
    const c = await company();
    const res = await post(intake, c.social, {
      contact_id: "ghl_1",
      full_name: "Priya Shah",
      email: `priya${++seq}@example.com`,
      phone: "+15875550142",
      website: "https://priya-designs.example.com",
      contact_source: "Facebook Lead Form",
      customData: { message: "Move-out clean next Friday" },
    });
    expect(res.status).toBe(201);
    const [lead] = await clientsNamed(c.org, "Priya Shah");
    expect(lead).toMatchObject({ lifecycle: "lead", lead_source: "facebook", phone: "+15875550142" });
    expect(lead.lead_note).toContain("Message: Move-out clean next Friday");
  });

  it("finds someone already on the books by phone, and never by a bare name", async () => {
    const c = await company();
    const regular = await addClient(api.sql, c.org, "Maria Regular");
    await api.sql("update public.clients set phone = '(403) 555-0199', email = null where id = $1", [regular]);
    const sarah = await addClient(api.sql, c.org, "Sarah");
    await api.sql("update public.clients set name = 'Sarah', email = null, phone = null where id = $1", [sarah]);

    const email = `maria${++seq}@example.com`;
    expect((await post(socialLead, c.social, { name: "Maria R", phone: "+1 403 555 0199", email, channel: "instagram" })).status).toBe(201);
    const [m] = await api.sql<ClientRow>("select lifecycle, lead_source, email, lead_note from public.clients where id = $1", [regular]);
    expect(m, "a client asking again stays a client, and their email is kept").toMatchObject({ lifecycle: "client", email });
    expect(m.lead_note).toContain("Instagram lead");
    expect(await clientsNamed(c.org, "Maria R"), "no second record").toHaveLength(0);

    expect((await post(socialLead, c.social, { name: "Sarah", ig_username: "another.sarah" })).status).toBe(201);
    const sarahs = await clientsNamed(c.org, "Sarah");
    expect(sarahs, "a first name from a DM is not the Sarah on file").toHaveLength(2);
    expect(sarahs.find((r) => r.id === sarah)?.lead_note ?? null).toBeNull();
  });

  it("the same phone with a different email on file is a different person", async () => {
    const c = await company();
    const partner = await addClient(api.sql, c.org, "Alex Partner");
    await api.sql("update public.clients set phone = '4035550123', email = $2 where id = $1", [partner, `alex${++seq}@example.com`]);
    await post(socialLead, c.social, { name: "Sam Partner", phone: "403-555-0123", email: `sam${seq}@example.com` });
    expect(await clientsNamed(c.org, "Sam Partner")).toHaveLength(1);
  });

  it("turns away the wrong door, dead tokens and posts with nothing to call the person", async () => {
    const c = await company();
    expect((await post(socialLead, c.contact, { name: "X" })).status, "a contact token on the social route").toBe(404);
    expect((await post(contactRequest, c.social, { name: "X" })).status, "a social token on the contact route").toBe(404);
    expect((await post(socialLead, "frm_nothing", { name: "X" })).status).toBe(404);
    await api.sql("update public.intake_forms set active = false where token = $1", [c.social]);
    expect((await post(socialLead, c.social, { name: "X" })).status, "switched off").toBe(404);
    await api.sql("update public.intake_forms set active = true where token = $1", [c.social]);
    expect((await post(socialLead, c.social, { message: "hi", tags: ["x"] })).status).toBe(400);
  });

  it("limits each form, not the address it's posted from", async () => {
    const c = await company();
    const other = await company();
    // Past week one: 30 leads' alert emails would otherwise trip the new-
    // workspace email cap, which is the abuse guard's test, not this one.
    await api.sql("update public.organizations set created_at = now() - interval '30 days' where id = $1", [c.org]);
    for (let i = 0; i < 30; i++) {
      expect((await post(socialLead, c.social, { name: `Burst ${i}` })).status).toBe(201);
    }
    expect((await post(socialLead, c.social, { name: "Burst 31" })).status, "this form is full for the minute").toBe(429);
    // Same sending address (every ManyChat customer shares a few), another company's form.
    expect((await post(socialLead, other.social, { name: "Unaffected" })).status).toBe(201);
  });
});

describe.skipIf(!hasPostgrest)("the job application form", () => {
  it("keeps every field, whatever the form service called it", async () => {
    const c = await company();
    const res = await post(
      intake,
      c.jobs,
      new URLSearchParams({
        full_name: "Oksana Hrytsenko",
        "E-mail": `oksana${++seq}@example.com`,
        mobile: "587-555-0111",
        position_applied_for: "Cleaner",
        years_experience: "4",
        start_date: "December",
        cover_letter: "Hotel housekeeping, then residential.",
        favourite_colour: "green",
      }),
    );
    expect(res.status).toBe(201);
    const [a] = await api.sql<Record<string, unknown>>(
      "select name, email, phone, position, experience, availability, message, status, raw from public.job_applicants where organization_id = $1",
      [c.org],
    );
    expect(a).toMatchObject({
      name: "Oksana Hrytsenko",
      phone: "587-555-0111",
      position: "Cleaner",
      experience: "4",
      availability: "December",
      message: "Hotel housekeeping, then residential.",
      status: "new",
    });
    expect((a.raw as Record<string, string>).favourite_colour, "nothing dropped").toBe("green");
  });

  it("refuses a dead token and doesn't say whether it ever existed", async () => {
    const c = await company();
    const unknown = await post(intake, "frm_nothing", { name: "X" });
    await api.sql("update public.intake_forms set active = false where token = $1", [c.jobs]);
    const off = await post(intake, c.jobs, { name: "X" });
    expect([unknown.status, off.status]).toEqual([404, 404]);
    expect(await off.json()).toEqual(await unknown.json());
    expect(await api.sql("select 1 from public.job_applicants where organization_id = $1", [c.org])).toHaveLength(0);
  });
});

describe.skipIf(!hasPostgrest)("Settings → Intake forms", () => {
  const listed = (org: string) =>
    api.sql<{ id: string; name: string; type: string; token: string; active: boolean }>(
      "select id, name, type, token, active from public.intake_forms where organization_id = $1 order by created_at",
      [org],
    );

  it("the owner makes, switches off, re-keys and deletes a form, and each one takes", async () => {
    const c = await company();
    const before = (await listed(c.org)).length;
    await as(c.owner, () => forms.createIntakeFormAction(form({ name: "Quote calculator", type: "estimate_request" })));
    await as(c.owner, () => forms.createIntakeFormAction(form({ name: "", type: "something_else" })));
    await as(c.owner, () => forms.createIntakeFormAction(form({ name: "ManyChat", type: "social_lead" })));
    const made = (await listed(c.org)).slice(before);
    expect(made.map((f) => [f.name, f.type, f.active])).toEqual([
      ["Quote calculator", "estimate_request", true],
      ["Untitled form", "job_application", true],
      ["ManyChat", "social_lead", true],
    ]);
    const f = made[0];
    expect(f.token).toMatch(/^frm_[0-9a-f]{32}$/);
    expect((await post(estimateRequest, f.token, calculator())).status).toBe(201);

    await as(c.owner, () => forms.toggleIntakeFormAction(form({ id: f.id, active: "true" })));
    expect((await post(estimateRequest, f.token, calculator())).status, "switched off").toBe(404);
    await as(c.owner, () => forms.toggleIntakeFormAction(form({ id: f.id, active: "false" })));

    await as(c.owner, () => forms.regenerateIntakeTokenAction(form({ id: f.id })));
    const [rekeyed] = await api.sql<{ token: string }>("select token from public.intake_forms where id = $1", [f.id]);
    expect(rekeyed.token).not.toBe(f.token);
    expect((await post(estimateRequest, f.token, calculator())).status, "the old address is dead").toBe(404);
    expect((await post(estimateRequest, rekeyed.token, calculator())).status).toBe(201);

    await as(c.owner, () => forms.deleteIntakeFormAction(form({ id: f.id })));
    expect(await api.sql("select 1 from public.intake_forms where id = $1", [f.id])).toHaveLength(0);
  });

  it("a manager can't touch them, and nobody reaches another company's", async () => {
    const c = await company();
    const other = await company();
    const [theirs] = await listed(other.org);
    const before = await listed(c.org);

    await as(c.manager, () => forms.createIntakeFormAction(form({ name: "Manager's form", type: "contact" })));
    await as(c.manager, () => forms.toggleIntakeFormAction(form({ id: before[0].id, active: "true" })));
    expect(await listed(c.org), "manager changed nothing").toEqual(before);

    await as(c.owner, () => forms.toggleIntakeFormAction(form({ id: theirs.id, active: "true" })));
    await as(c.owner, () => forms.regenerateIntakeTokenAction(form({ id: theirs.id })));
    await as(c.owner, () => forms.deleteIntakeFormAction(form({ id: theirs.id })));
    const [still] = await api.sql<{ token: string; active: boolean }>("select token, active from public.intake_forms where id = $1", [theirs.id]);
    expect(still).toEqual({ token: theirs.token, active: theirs.active });
  });
});

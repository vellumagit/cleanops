/**
 * Checklists and contracts, pressed as the office (and, for signing, the
 * client) press them, against a real database behind the real PostgREST
 * and the stand-in file storage. Outbound email is caught.
 *
 *   checklist templates   make, edit, delete; put on a job; make one a
 *                         client's default and take it back; remove an item
 *   contracts             make, edit, delete, send for signature; documents
 *   the signing page      /c/<token>: the client signs once, with the link
 *
 * The checks that matter: a template's items reach this company's jobs and
 * nobody else's, a save that saved nothing says so, and a contract is
 * signed once, by whoever holds its link, and by nobody without it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

type Sent = { to: string; subject: string; text?: string; html?: string };
const outbox = vi.hoisted(() => ({ email: [] as Sent[] }));
/** What the signer's browser sends: the evidence the signing page records. */
const browser = vi.hoisted(() => ({ headers: {} as Record<string, string> }));
vi.mock("next/headers", async () => ({
  ...(await import("./next-stubs")).nextHeaders(),
  headers: async () => new Headers(browser.headers),
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

const checklists = await import("@/app/app/checklists/actions");
const contracts = await import("@/app/app/contracts/actions");
const contractDocs = await import("@/app/app/contracts/document-actions");
const { signContractAction } = await import("@/app/c/[token]/sign-actions");

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

let ipSeq = 10;
beforeEach(() => {
  request.cookies = [];
  request.after = [];
  outbox.email.length = 0;
  // A fresh address per test: the signing page allows five tries a minute per IP.
  browser.headers = { "x-forwarded-for": `203.0.113.${++ipSeq}, 10.0.0.1`, "user-agent": "Mozilla/5.0 (iPhone) Test" };
});

/** Signed in as this member (null: nobody, as on a public page); a redirect is an answer too. */
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

const form = (fields: Record<string, string | File | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const x of v) f.append(k, x);
    else f.set(k, v);
  }
  return f;
};

async function company() {
  const org = await addOrg(api.sql, "Checklist Co");
  await api.sql(
    "update public.organizations set timezone = 'America/Regina', automations_enabled = true, default_contact_preference = 'email' where id = $1",
    [org],
  );
  const [service] = await api.sql<{ id: string }>(
    "insert into public.service_types (organization_id, name, category) values ($1, 'Standard clean', 'standard') returning id",
    [org],
  );
  const [deep] = await api.sql<{ id: string }>(
    "insert into public.service_types (organization_id, name, category) values ($1, 'Deep clean', 'deep') returning id",
    [org],
  );
  return {
    org,
    service: service.id,
    deep: deep.id,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    manager: await addMember(api.sql, org, "manager", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
}
type Co = Awaited<ReturnType<typeof company>>;

async function job(c: Co, client: string, hours: number, opts: { status?: string; service?: string | null } = {}) {
  const [b] = await api.sql<{ id: string }>(
    `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, service_type_id, status)
     values ($1, $2, now() + make_interval(hours => $3), 120, 'standard', $4, $5::public.booking_status) returning id`,
    [c.org, client, hours, opts.service ?? null, opts.status ?? "confirmed"],
  );
  return b.id;
}
const itemsOn = async (booking: string) =>
  (
    await api.sql<{ title: string; source: string | null; ordinal: number }>(
      "select title, source_template_id as source, ordinal from public.booking_checklist_items where booking_id = $1 order by ordinal, title",
      [booking],
    )
  ).map((r) => r.title);
const item = (title: string, extra: Record<string, unknown> = {}) => JSON.stringify({ title, phase: "during", is_required: false, kind: "item", ...extra });

/** A template straight into the database, with its items. */
async function template(c: Co, name: string, titles: string[], service: string | null = null) {
  const [t] = await api.sql<{ id: string }>(
    "insert into public.checklist_templates (organization_id, name, applies_to_service_type_id) values ($1, $2, $3) returning id",
    [c.org, name, service],
  );
  for (const [i, title] of titles.entries()) {
    await api.sql(
      "insert into public.checklist_template_items (template_id, organization_id, ordinal, title) values ($1, $2, $3, $4)",
      [t.id, c.org, i, title],
    );
  }
  return t.id;
}

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("checklist templates", { timeout: 120_000 }, () => {
  it("a manager makes one with sections and tasks; it reaches the upcoming jobs of the service it's for", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Hilda Daubner");
    const upcoming = await job(c, client, 48, { service: c.service });
    const past = await job(c, client, -48, { service: c.service, status: "completed" });
    const otherService = await job(c, client, 72, { service: c.deep });
    const other = await company();

    const res = (await as(c.manager, () =>
      checklists.createChecklistTemplateAction(
        form({
          name: "  Weekly clean  ",
          description: "",
          applies_to_service_type_id: c.service,
          items: [
            item("KITCHEN", { kind: "section", is_required: true }),
            item("Appliances", { kind: "subsection" }),
            item("Clean inside the microwave", { is_required: true, phase: "pre" }),
            item("   "),
            "{not json",
            item("Wipe counters", { phase: "sideways" }),
          ],
        }),
      ),
    )) as { ok: boolean; id: string };
    expect(res, api.log().slice(-300)).toMatchObject({ ok: true, id: expect.any(String) });
    const [tpl] = await api.sql<{ name: string; description: string | null; svc: string | null; org: string }>(
      "select name, description, applies_to_service_type_id as svc, organization_id as org from public.checklist_templates where id = $1",
      [res.id],
    );
    expect(tpl).toEqual({ name: "Weekly clean", description: null, svc: c.service, org: c.org });
    const items = await api.sql<{ title: string; kind: string; phase: string; is_required: boolean; ordinal: number }>(
      "select title, kind, phase, is_required, ordinal from public.checklist_template_items where template_id = $1 order by ordinal",
      [res.id],
    );
    expect(items).toEqual([
      { title: "KITCHEN", kind: "section", phase: "during", is_required: false, ordinal: 0 },
      { title: "Appliances", kind: "subsection", phase: "during", is_required: false, ordinal: 1 },
      { title: "Clean inside the microwave", kind: "item", phase: "pre", is_required: true, ordinal: 2 },
      { title: "Wipe counters", kind: "item", phase: "during", is_required: false, ordinal: 3 },
    ]);
    expect(await itemsOn(upcoming)).toEqual(["KITCHEN", "Appliances", "Clean inside the microwave", "Wipe counters"]);
    expect(await itemsOn(past), "a finished job keeps what it had").toEqual([]);
    expect(await itemsOn(otherService)).toEqual([]);

    // Another company's service id from the browser degrades to "manual only".
    const foreign = (await as(c.owner, () =>
      checklists.createChecklistTemplateAction(form({ name: "Sneaky", applies_to_service_type_id: other.service, items: [item("Task")] })),
    )) as { id: string };
    expect((await api.sql<{ svc: string | null }>("select applies_to_service_type_id as svc from public.checklist_templates where id = $1", [foreign.id]))[0].svc).toBeNull();

    expect(await as(c.anna, () => checklists.createChecklistTemplateAction(form({ name: "Anna's", items: [item("x")] })))).toEqual({
      ok: false,
      error: "Not authorized.",
    });
    expect(await as(c.owner, () => checklists.createChecklistTemplateAction(form({ name: "  " })))).toEqual({ ok: false, error: "Template name is required." });
    expect(await api.sql("select 1 from public.checklist_templates where organization_id = $1", [c.org])).toHaveLength(2);
  });

  it("an edit replaces the items, and moving it to another service moves its items off the old service's upcoming jobs", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Ken Hicks");
    const tpl = await template(c, "Standard list", ["Old task A", "Old task B"], c.service);
    const standardJob = await job(c, client, 30, { service: c.service });
    const deepJob = await job(c, client, 50, { service: c.deep });
    const doneJob = await job(c, client, -30, { status: "completed" });
    await api.sql(
      "insert into public.booking_checklist_items (organization_id, booking_id, source_template_id, ordinal, title) values ($1, $2, $3, 0, 'Old task A')",
      [c.org, doneJob, tpl],
    );
    expect(await itemsOn(standardJob)).toEqual(["Old task A", "Old task B"]);

    const res = await as(c.manager, () =>
      checklists.updateChecklistTemplateAction(tpl, form({ name: "Deep list", applies_to_service_type_id: c.deep, items: [item("New task 1"), item("New task 2")] })),
    );
    expect(res, api.log().slice(-300)).toEqual({ ok: true, id: tpl });
    expect(
      (await api.sql<{ title: string }>("select title from public.checklist_template_items where template_id = $1 order by ordinal", [tpl])).map((r) => r.title),
    ).toEqual(["New task 1", "New task 2"]);
    expect(await itemsOn(standardJob), "taken back off the old service's job").toEqual([]);
    expect(await itemsOn(deepJob)).toEqual(["New task 1", "New task 2"]);
    expect(await itemsOn(doneJob), "a finished job keeps what was checked").toEqual(["Old task A"]);

    expect(await as(c.anna, () => checklists.updateChecklistTemplateAction(tpl, form({ name: "Anna's", items: [item("x")] })))).toEqual({
      ok: false,
      error: "Not authorized.",
    });
    expect(await as(c.owner, () => checklists.updateChecklistTemplateAction(tpl, form({ name: "" })))).toEqual({ ok: false, error: "Template name is required." });
    expect((await api.sql<{ name: string }>("select name from public.checklist_templates where id = $1", [tpl]))[0].name).toBe("Deep list");
  });

  // FIX-LATER: updateChecklistTemplateAction never checks its update touched a row, then inserts items under whatever template id it was given; another company's template gets this company's items, which their jobs then copy.
  it.fails("editing another company's template id changes nothing there and says so", async () => {
    const c = await company();
    const other = await company();
    const theirs = await template(other, "Their list", ["Their task"]);
    const theirClient = await addClient(api.sql, other.org, "Their Client");
    await api.sql("update public.clients set default_checklist_template_id = $2 where id = $1", [theirClient, theirs]);

    const res = await as(c.owner, () => checklists.updateChecklistTemplateAction(theirs, form({ name: "Mine now", items: [item("Injected task")] })));
    // Their next job copies their template, and only what they wrote in it.
    const theirJob = await job(other, theirClient, 24);
    expect(await itemsOn(theirJob), JSON.stringify(res)).toEqual(["Their task"]);
    expect((res as { ok: boolean }).ok).toBe(false);
  });

  it("deleting one takes its items back off upcoming jobs; started and finished jobs keep theirs", async () => {
    const c = await company();
    const other = await company();
    const client = await addClient(api.sql, c.org, "Margaret Ann MacLeod");
    const tpl = await template(c, "Move-out", ["Inside oven", "Inside fridge"]);
    const upcoming = await job(c, client, 40);
    const finished = await job(c, client, -40, { status: "completed" });
    for (const b of [upcoming, finished]) {
      await as(c.owner, () => checklists.attachTemplateToBookingAction(form({ template_id: tpl, booking_id: b })));
    }
    const theirs = await template(other, "Theirs", ["Their task"]);

    await as(c.anna, () => checklists.deleteChecklistTemplateAction(form({ id: tpl })));
    expect(await api.sql("select 1 from public.checklist_templates where id = $1", [tpl]), "a cleaner can't").toHaveLength(1);
    await as(c.owner, () => checklists.deleteChecklistTemplateAction(form({ id: theirs })));
    expect(await api.sql("select 1 from public.checklist_templates where id = $1", [theirs])).toHaveLength(1);

    expect(await as(c.manager, () => checklists.deleteChecklistTemplateAction(form({ id: tpl })))).toEqual({ redirected: "/app/checklists" });
    expect(await api.sql("select 1 from public.checklist_templates where id = $1", [tpl])).toHaveLength(0);
    expect(await itemsOn(upcoming)).toEqual([]);
    expect(await itemsOn(finished)).toEqual(["Inside oven", "Inside fridge"]);
  });
});

describe.skipIf(!hasPostgrest)("checklists on jobs and clients", { timeout: 120_000 }, () => {
  it("putting a template on a job adds its items after what's already there", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Stacie Moore");
    const b = await job(c, client, 24);
    const first = await template(c, "Kitchen", ["Counters", "Sink"]);
    const second = await template(c, "Bath", ["Mirror"]);
    const empty = await template(c, "Empty", []);
    const attach = (m: Member, t: string, booking = b) => as(m, () => checklists.attachTemplateToBookingAction(form({ template_id: t, booking_id: booking })));

    expect(await attach(c.manager, first)).toEqual({ ok: true });
    expect(await attach(c.manager, second)).toEqual({ ok: true });
    const rows = await api.sql<{ title: string; ordinal: number; source: string; org: string }>(
      "select title, ordinal, source_template_id as source, organization_id as org from public.booking_checklist_items where booking_id = $1 order by ordinal",
      [b],
    );
    expect(rows).toEqual([
      { title: "Counters", ordinal: 0, source: first, org: c.org },
      { title: "Sink", ordinal: 1, source: first, org: c.org },
      { title: "Mirror", ordinal: 2, source: second, org: c.org },
    ]);
    expect(await attach(c.owner, empty)).toEqual({ ok: false, error: "Template has no items." });
    expect(await attach(c.anna, first)).toEqual({ ok: false, error: "Not authorized." });
    expect(await as(c.owner, () => checklists.attachTemplateToBookingAction(form({ template_id: first })))).toEqual({
      ok: false,
      error: "Missing template or booking id.",
    });
    expect(await itemsOn(b)).toHaveLength(3);
  });

  // FIX-LATER: attachTemplateToBookingAction never checks the booking is this company's; its rows land on another company's job.
  it.fails("a template can't be put on another company's job", async () => {
    const c = await company();
    const other = await company();
    const tpl = await template(c, "Mine", ["My task"]);
    const theirJob = await job(other, await addClient(api.sql, other.org, "Their Client"), 24);
    const res = await as(c.owner, () => checklists.attachTemplateToBookingAction(form({ template_id: tpl, booking_id: theirJob })));
    expect(await api.sql("select 1 from public.booking_checklist_items where booking_id = $1", [theirJob]), JSON.stringify(res)).toHaveLength(0);
    expect((res as { ok: boolean }).ok).toBe(false);
  });

  it("making it a client's default puts it on their upcoming jobs and every new one; taking it back removes it from unstarted ones", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Patricia Poohkay");
    const neighbour = await addClient(api.sql, c.org, "Neighbour");
    const tpl = await template(c, "Patricia's list", ["Water plants", "Feed cat"]);
    const otherTpl = await template(c, "Other list", ["Other task"]);
    const upcoming = await job(c, client, 24);
    const cancelled = await job(c, client, 30, { status: "cancelled" });
    const past = await job(c, client, -24, { status: "completed" });
    const already = await job(c, client, 60);
    await as(c.owner, () => checklists.attachTemplateToBookingAction(form({ template_id: otherTpl, booking_id: already })));
    const assign = (m: Member, fields: Record<string, string>) => as(m, () => checklists.assignChecklistToClientAction(form(fields)));

    expect(await assign(c.anna, { template_id: tpl, client_id: client })).toEqual({ ok: false, error: "Not authorized." });
    expect(await assign(c.owner, { template_id: tpl })).toEqual({ ok: false, error: "Pick a client to assign." });
    expect(await assign(c.manager, { template_id: tpl, client_id: client })).toEqual({ ok: true });
    expect((await api.sql<{ t: string }>("select default_checklist_template_id as t from public.clients where id = $1", [client]))[0].t).toBe(tpl);
    expect(await itemsOn(upcoming)).toEqual(["Water plants", "Feed cat"]);
    expect(await itemsOn(cancelled)).toEqual([]);
    expect(await itemsOn(past)).toEqual([]);
    expect(await itemsOn(already), "a job with a checklist already keeps it").toEqual(["Other task"]);
    const fresh = await job(c, client, 96);
    expect(await itemsOn(fresh), "every new job too").toEqual(["Water plants", "Feed cat"]);

    // Another company's template id can't become her default.
    const other = await company();
    const theirs = await template(other, "Theirs", ["Their task"]);
    expect(await assign(c.owner, { template_id: theirs, client_id: neighbour })).toEqual({ ok: false, error: "Template not found." });

    // Taking it back: her unstarted jobs give it back, her finished one keeps
    // what it had, and a neighbour with the same default is untouched.
    await api.sql(
      "insert into public.booking_checklist_items (organization_id, booking_id, source_template_id, ordinal, title) values ($1, $2, $3, 0, 'Water plants')",
      [c.org, past, tpl],
    );
    await assign(c.owner, { template_id: tpl, client_id: neighbour });
    const neighbourJob = await job(c, neighbour, 24);
    await api.sql("update public.bookings set status = 'en_route' where id = $1", [fresh]);
    const unassign = (m: Member, fields: Record<string, string>) => as(m, () => checklists.unassignChecklistFromClientAction(form(fields)));
    expect(await unassign(c.anna, { template_id: tpl, client_id: client })).toEqual({ ok: false, error: "Not authorized." });
    expect(await unassign(c.owner, { template_id: tpl })).toEqual({ ok: false, error: "Missing client." });
    expect(await unassign(c.manager, { template_id: tpl, client_id: client })).toEqual({ ok: true });
    expect((await api.sql<{ t: string | null }>("select default_checklist_template_id as t from public.clients where id = $1", [client]))[0].t).toBeNull();
    expect(await itemsOn(fresh), "en route has not started").toEqual([]);
    expect(await itemsOn(upcoming)).toEqual([]);
    expect(await itemsOn(past), "a finished job keeps what was checked").toEqual(["Water plants"]);
    expect(await itemsOn(neighbourJob)).toEqual(["Water plants", "Feed cat"]);
    expect((await api.sql<{ t: string | null }>("select default_checklist_template_id as t from public.clients where id = $1", [neighbour]))[0].t).toBe(tpl);

    // Unassigning a template that isn't her default can't clear the one that is.
    await assign(c.owner, { template_id: otherTpl, client_id: client });
    await unassign(c.owner, { template_id: tpl, client_id: client });
    expect((await api.sql<{ t: string | null }>("select default_checklist_template_id as t from public.clients where id = $1", [client]))[0].t).toBe(otherTpl);
  });

  // FIX-LATER: assignChecklistToClientAction treats an update that matched no client as done, then runs the service-role backfill for that client id, copying this company's items onto another company's jobs.
  it.fails("a client id from another company can't be given this company's checklist", async () => {
    const c = await company();
    const other = await company();
    const tpl = await template(c, "Mine", ["My task"]);
    const theirClient = await addClient(api.sql, other.org, "Their Client");
    const theirJob = await job(other, theirClient, 24);
    const res = await as(c.owner, () => checklists.assignChecklistToClientAction(form({ template_id: tpl, client_id: theirClient })));
    expect(await itemsOn(theirJob), JSON.stringify(res)).toEqual([]);
    expect((res as { ok: boolean }).ok).toBe(false);
  });

  // FIX-LATER: unassignChecklistFromClientAction reports success when its update matched no client (another company's id, or a default that already changed).
  it.fails("taking a checklist off a client that isn't this company's says nothing changed", async () => {
    const c = await company();
    const other = await company();
    const theirTpl = await template(other, "Theirs", ["Their task"]);
    const theirClient = await addClient(api.sql, other.org, "Their Client");
    await api.sql("update public.clients set default_checklist_template_id = $2 where id = $1", [theirClient, theirTpl]);
    const res = await as(c.owner, () => checklists.unassignChecklistFromClientAction(form({ template_id: theirTpl, client_id: theirClient })));
    expect((await api.sql<{ t: string | null }>("select default_checklist_template_id as t from public.clients where id = $1", [theirClient]))[0].t).toBe(theirTpl);
    expect((res as { ok: boolean }).ok).toBe(false);
  });

  it("removing an item from a job takes that one item off, for the office only", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Remove Item");
    const b = await job(c, client, 24);
    const list = await template(c, "List", ["Keep me", "Remove me"]);
    await as(c.owner, () => checklists.attachTemplateToBookingAction(form({ template_id: list, booking_id: b })));
    const [{ id }] = await api.sql<{ id: string }>("select id from public.booking_checklist_items where booking_id = $1 and title = 'Remove me'", [b]);

    expect(await as(c.anna, () => checklists.removeChecklistItemAction(form({ id, booking_id: b })))).toEqual({ ok: false, error: "Not authorized." });
    expect(await as(c.owner, () => checklists.removeChecklistItemAction(form({ booking_id: b })))).toEqual({ ok: false, error: "Missing item id." });
    expect(await itemsOn(b)).toEqual(["Keep me", "Remove me"]);
    expect(await as(c.manager, () => checklists.removeChecklistItemAction(form({ id, booking_id: b })))).toEqual({ ok: true });
    expect(await itemsOn(b)).toEqual(["Keep me"]);
  });

  // FIX-LATER: removeChecklistItemAction reports ok for a delete that matched no row (another company's item, or one already gone).
  it.fails("removing another company's checklist item says it wasn't removed", async () => {
    const c = await company();
    const other = await company();
    const theirJob = await job(other, await addClient(api.sql, other.org, "Their Client"), 24);
    const [{ id }] = await api.sql<{ id: string }>(
      "insert into public.booking_checklist_items (organization_id, booking_id, ordinal, title) values ($1, $2, 0, 'Their item') returning id",
      [other.org, theirJob],
    );
    const res = await as(c.owner, () => checklists.removeChecklistItemAction(form({ id, booking_id: theirJob })));
    expect(await itemsOn(theirJob)).toEqual(["Their item"]);
    expect(res).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------------------

async function contract(c: Co, client: string, over: Record<string, unknown> = {}) {
  const cols = { service_type: "standard", start_date: "2026-12-01", agreed_price_cents: 18000, status: "active", ...over };
  const keys = Object.keys(cols);
  const [row] = await api.sql<{ id: string }>(
    `insert into public.contracts (organization_id, client_id, ${keys.join(", ")})
     values ($1, $2, ${keys
       .map((k, i) => (k === "service_type" ? `$${i + 3}::public.service_type` : k === "status" ? `$${i + 3}::public.contract_status` : `$${i + 3}`))
       .join(", ")})
     returning id`,
    [c.org, client, ...Object.values(cols)],
  );
  return row.id;
}
const contractRow = async (id: string) =>
  (
    await api.sql<{
      agreed_price_cents: number;
      service_type: string;
      status: string;
      public_token: string | null;
      sign_status: string;
      sent_at: string | null;
      signed_at: string | null;
      signer_name: string | null;
      signer_ip: string | null;
      signer_user_agent: string | null;
      signer_signature_data_url: string | null;
    }>(
      `select agreed_price_cents, service_type::text as service_type, status::text as status, public_token, sign_status, sent_at, signed_at,
              signer_name, host(signer_ip) as signer_ip, signer_user_agent, signer_signature_data_url
         from public.contracts where id = $1`,
      [id],
    )
  )[0];
const contractForm = (c: Co, client: string, over: Record<string, string> = {}) =>
  form({
    client_id: client,
    estimate_id: "",
    service_type: "standard",
    service_type_id: c.service,
    service_type_label: "Standard clean",
    start_date: "2026-12-01",
    end_date: "",
    agreed_price_cents: "180.00",
    payment_terms: "Net 15",
    status: "active",
    ...over,
  });

describe.skipIf(!hasPostgrest)("contracts", { timeout: 120_000 }, () => {
  it("the office makes one; a cleaner, another company's client and a missing service are refused", async () => {
    const c = await company();
    const other = await company();
    const client = await addClient(api.sql, c.org, "Vira Client");
    const theirs = await addClient(api.sql, other.org, "Their Client");

    expect(await as(c.manager, () => contracts.createContractAction({}, contractForm(c, client))), api.log().slice(-300)).toEqual({
      redirected: "/app/contracts",
    });
    const [made] = await api.sql<{ id: string; label: string; svc: string; terms: string }>(
      "select id, service_type_label as label, service_type_id as svc, payment_terms as terms from public.contracts where client_id = $1",
      [client],
    );
    expect(made).toMatchObject({ label: "Standard clean", svc: c.service, terms: "Net 15" });
    expect(await contractRow(made.id)).toMatchObject({ agreed_price_cents: 18000, status: "active", sign_status: "unsent", public_token: null });

    const errs = async (m: Member, f: FormData) => ((await as(m, () => contracts.createContractAction({}, f))) as { errors?: Record<string, string> }).errors;
    expect((await errs(c.anna, contractForm(c, client)))?._form).toBeTruthy();
    expect((await errs(c.owner, contractForm(c, theirs)))?._form).toBeTruthy();
    expect((await errs(c.owner, contractForm(c, client, { service_type_id: "" })))?._form).toMatch(/^No services configured/);
    expect((await errs(c.owner, contractForm(c, "not-a-uuid")))?.client_id).toBe("Pick a client");
    expect(await api.sql("select 1 from public.contracts where client_id in ($1, $2)", [client, theirs])).toHaveLength(1);
  });

  it("an edit saves the terms but never rewrites the contract's original service bucket", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Edit Client");
    const id = await contract(c, client);
    expect(
      await as(c.manager, () => contracts.updateContractAction(id, {}, contractForm(c, client, { agreed_price_cents: "210.50", service_type: "deep", status: "ended" }))),
    ).toEqual({ redirected: "/app/contracts" });
    expect(await contractRow(id)).toMatchObject({ agreed_price_cents: 21050, service_type: "standard", status: "ended" });
    expect(
      ((await as(c.owner, () => contracts.updateContractAction(id, {}, contractForm(c, client, { service_type_id: "" })))) as { errors: Record<string, string> }).errors._form,
    ).toMatch(/^No services configured/);
  });

  // FIX-LATER: updateContractAction never checks its update touched a row, so a save refused by RLS (a cleaner) or aimed at another company's contract returns to the list as if saved.
  it.fails("a contract save that changed nothing says so instead of returning to the list as saved", async () => {
    const c = await company();
    const other = await company();
    const theirs = await contract(other, await addClient(api.sql, other.org, "Their Client"));
    const mine = await addClient(api.sql, c.org, "Mine");
    const res = await as(c.owner, () => contracts.updateContractAction(theirs, {}, contractForm(c, mine, { agreed_price_cents: "1.00" })));
    expect((await contractRow(theirs)).agreed_price_cents).toBe(18000);
    expect(res).not.toEqual({ redirected: "/app/contracts" });
  });

  it("only the office deletes one, and only its own company's", async () => {
    const c = await company();
    const other = await company();
    const client = await addClient(api.sql, c.org, "Delete Client");
    const id = await contract(c, client);
    const theirs = await contract(other, await addClient(api.sql, other.org, "Their Client"));

    await as(c.anna, () => contracts.deleteContractAction(form({ id })));
    await as(c.owner, () => contracts.deleteContractAction(form({ id: theirs })));
    expect(await api.sql("select 1 from public.contracts where id in ($1, $2)", [id, theirs])).toHaveLength(2);
    expect(await as(c.manager, () => contracts.deleteContractAction(form({ id })))).toEqual({ redirected: "/app/contracts" });
    expect(await api.sql("select 1 from public.contracts where id = $1", [id])).toHaveLength(0);
  });

  // FIX-LATER: deleteContractAction deletes the row (documents cascade) but never removes the documents' files from the contract-docs bucket.
  it.fails("deleting a contract takes its documents' files with it", async () => {
    const c = await company();
    const id = await contract(c, await addClient(api.sql, c.org, "Docs Client"));
    await as(c.owner, () => contractDocs.uploadContractDocumentAction(form({ contract_id: id, file: new File(["%PDF-1.4"], "signed.pdf", { type: "application/pdf" }) })));
    const [doc] = await api.sql<{ path: string }>("select storage_path as path from public.contract_documents where contract_id = $1", [id]);
    expect(api.storage.has(`contract-docs/${doc.path}`)).toBe(true);
    await as(c.owner, () => contracts.deleteContractAction(form({ id })));
    expect(await api.sql("select 1 from public.contracts where id = $1", [id])).toHaveLength(0);
    expect(api.storage.has(`contract-docs/${doc.path}`), "the signed paperwork is gone too").toBe(false);
  });

  it("documents: the office attaches and removes them; a cleaner, a wrong file and another company can't", async () => {
    const c = await company();
    const other = await company();
    const id = await contract(c, await addClient(api.sql, c.org, "Doc Client"));
    const pdf = () => new File(["%PDF-1.4 signed"], "Signed agreement.pdf", { type: "application/pdf" });
    const docsOn = () => api.sql<{ id: string; path: string; org: string; name: string }>(
      "select id, storage_path as path, organization_id as org, name from public.contract_documents where contract_id = $1",
      [id],
    );

    await as(c.anna, () => contractDocs.uploadContractDocumentAction(form({ contract_id: id, file: pdf() })));
    await as(c.owner, () => contractDocs.uploadContractDocumentAction(form({ contract_id: id, file: new File(["#!/bin/sh"], "run.sh", { type: "text/x-sh" }) })));
    expect(await docsOn()).toHaveLength(0);

    await as(c.manager, () => contractDocs.uploadContractDocumentAction(form({ contract_id: id, file: pdf() })));
    const [doc] = await docsOn();
    expect(doc).toMatchObject({ org: c.org, name: "Signed agreement.pdf" });
    expect(doc.path).toMatch(new RegExp(`^${c.org}/${id}/[0-9a-f]{8}-Signed_agreement\\.pdf$`));
    expect(api.storage.has(`contract-docs/${doc.path}`)).toBe(true);

    await as(c.anna, () => contractDocs.deleteContractDocumentAction(form({ id: doc.id, contract_id: id })));
    await as(other.owner, () => contractDocs.deleteContractDocumentAction(form({ id: doc.id, contract_id: id })));
    expect(await docsOn()).toHaveLength(1);
    expect(api.storage.has(`contract-docs/${doc.path}`)).toBe(true);

    await as(c.manager, () => contractDocs.deleteContractDocumentAction(form({ id: doc.id, contract_id: id })));
    expect(await docsOn()).toHaveLength(0);
    expect(api.storage.has(`contract-docs/${doc.path}`)).toBe(false);
  });

  // FIX-LATER: uploadContractDocumentAction never checks the contract is this company's; the file and a row pointing at another company's contract are saved.
  it.fails("a document can't be attached to another company's contract", async () => {
    const c = await company();
    const other = await company();
    const theirs = await contract(other, await addClient(api.sql, other.org, "Their Client"));
    const before = api.storage.size;
    await as(c.owner, () => contractDocs.uploadContractDocumentAction(form({ contract_id: theirs, file: new File(["%PDF-1.4"], "x.pdf", { type: "application/pdf" }) })));
    expect(await api.sql("select 1 from public.contract_documents where contract_id = $1", [theirs])).toHaveLength(0);
    expect(api.storage.size).toBe(before);
  });

  // FIX-LATER: uploadContractDocumentAction ignores a failed contract_documents insert, so the uploaded file is left in storage with no row (here: a contract id that doesn't exist).
  it.fails("a document whose record can't be saved leaves no file behind", async () => {
    const c = await company();
    const before = api.storage.size;
    await as(c.owner, () =>
      contractDocs.uploadContractDocumentAction(form({ contract_id: crypto.randomUUID(), file: new File(["%PDF-1.4"], "orphan.pdf", { type: "application/pdf" }) })),
    );
    expect(api.storage.size, "no orphaned file").toBe(before);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("sending a contract and signing it", { timeout: 120_000 }, () => {
  async function withEmail(c: Co, name: string, email: string | null = `${name.toLowerCase().replace(/\W+/g, ".")}.${Date.now()}@example.com`) {
    const id = await addClient(api.sql, c.org, name);
    await api.sql("update public.clients set email = $2 where id = $1", [id, email]);
    return { id, email };
  }
  const send = (m: Member, id: string) => as(m, () => contracts.sendContractForSignatureAction({}, form({ id })));
  const signForm = (token: string, over: Record<string, string> = {}) =>
    form({ token, signer_name: "Patricia Poohkay", agree: "on", signature_data_url: "", ...over });
  const signedNotices = (org: string) =>
    api.sql<{ r: string; body: string }>(
      "select recipient_membership_id as r, body from public.notifications where organization_id = $1 and title = 'Contract signed' order by created_at",
      [org],
    );

  it("the office sends the link, the client signs it once, and the office is told", async () => {
    const c = await company();
    const client = await withEmail(c, "Patricia Poohkay");
    const id = await contract(c, client.id);

    const sent = (await send(c.manager, id)) as { ok: boolean; signUrl: string; emailed: boolean };
    expect(sent, api.log().slice(-300)).toMatchObject({ ok: true, emailed: true });
    const row = await contractRow(id);
    expect(row.sign_status).toBe("sent");
    expect(row.sent_at).not.toBeNull();
    expect(row.public_token).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(sent.signUrl.endsWith(`/c/${row.public_token}`)).toBe(true);
    expect(outbox.email.map((m) => m.to)).toEqual([client.email]);
    expect(outbox.email[0].html).toContain(`/c/${row.public_token}`);

    // Sending again keeps the link already in the client's inbox.
    await send(c.owner, id);
    expect(await contractRow(id)).toMatchObject({ public_token: row.public_token, sent_at: row.sent_at });

    const signature = `data:image/png;base64,${Buffer.from("a drawn signature").toString("base64")}`;
    expect(await as(null, () => signContractAction({}, signForm(row.public_token!, { signer_name: "  Patricia Poohkay  ", signature_data_url: signature })))).toEqual({ ok: true });
    const signed = await contractRow(id);
    expect(signed).toMatchObject({
      sign_status: "signed",
      signer_name: "Patricia Poohkay",
      signer_ip: browser.headers["x-forwarded-for"].split(",")[0],
      signer_user_agent: "Mozilla/5.0 (iPhone) Test",
      signer_signature_data_url: signature,
    });
    expect(signed.signed_at).not.toBeNull();
    const told = await signedNotices(c.org);
    expect(told.map((t) => t.r).sort()).toEqual([c.owner.membershipId, c.manager.membershipId].sort());
    expect(told[0].body).toBe("Patricia Poohkay signed the contract.");

    // Pressing again (a second click, or someone else with the link) changes nothing.
    expect(await as(null, () => signContractAction({}, signForm(row.public_token!, { signer_name: "Somebody Else" })))).toEqual({ ok: true });
    expect(await contractRow(id)).toMatchObject({ signer_name: "Patricia Poohkay", signed_at: signed.signed_at });
    expect(await signedNotices(c.org)).toHaveLength(2);

    // Re-sending a signed contract never un-signs it.
    await send(c.owner, id);
    expect((await contractRow(id)).sign_status).toBe("signed");
  });

  it("send is for the office, for this company's contracts; a client with no email gets a link to share", async () => {
    const c = await company();
    const other = await company();
    const id = await contract(c, (await withEmail(c, "Some Client")).id);
    const theirs = await contract(other, (await withEmail(other, "Their Client")).id);
    const noEmail = await contract(c, (await withEmail(c, "No Email", null)).id);

    expect(await send(c.anna, id)).toEqual({ error: "Only owners, admins, or managers can send contracts." });
    expect(await send(c.owner, theirs)).toEqual({ error: "Contract not found." });
    expect(await as(c.owner, () => contracts.sendContractForSignatureAction({}, form({})))).toEqual({ error: "Missing contract id." });
    expect(await contractRow(theirs)).toMatchObject({ public_token: null, sign_status: "unsent" });
    expect(await contractRow(id)).toMatchObject({ public_token: null, sign_status: "unsent" });

    expect(await send(c.owner, noEmail)).toMatchObject({
      ok: true,
      emailed: false,
      emailNote: "Link generated. The client doesn't have an email on file — share it manually.",
    });
    expect((await contractRow(noEmail)).sign_status).toBe("sent");
    expect(outbox.email).toHaveLength(0);
  });

  it("nobody signs without the right link, and a sign without a name, the box ticked or a readable drawing is refused", async () => {
    const c = await company();
    const id = await contract(c, (await withEmail(c, "Link Holder")).id, { public_token: "rightlinktoken01", sign_status: "sent" });
    const declined = await contract(c, (await withEmail(c, "Declined")).id, { public_token: "declinedtoken001", sign_status: "declined" });
    const unsent = await contract(c, (await withEmail(c, "Unsent")).id);
    const sign = (f: FormData) => as(null, () => signContractAction({}, f));

    expect(await sign(signForm("wronglinktoken01"))).toEqual({ error: "Contract not found." });
    expect(await sign(signForm("short"))).toEqual({ error: "Invalid signing link." });
    expect(await sign(signForm(""))).toEqual({ error: "Invalid signing link." });
    expect(await sign(signForm("rightlinktoken01", { signer_name: "   " }))).toEqual({ error: "Type your full name to sign." });
    expect(await sign(signForm("rightlinktoken01", { signer_name: "x".repeat(201) }))).toEqual({ error: "Name is too long." });
    expect(await sign(signForm("rightlinktoken01", { agree: "" }))).toEqual({ error: "Check the agreement box to proceed." });
    // The page allows five tries a minute from one address; the next ones come from another.
    browser.headers = { "x-forwarded-for": "198.51.100.7", "user-agent": "Test" };
    expect(await sign(signForm("rightlinktoken01", { signature_data_url: "javascript:alert(1)" }))).toEqual({
      error: "The drawn signature couldn't be read. Clear it and try again, or skip it.",
    });
    expect(await sign(signForm("rightlinktoken01", { signature_data_url: `data:image/png;base64,${"A".repeat(300_001)}` }))).toEqual({
      error: "Drawn signature is too large. Clear and re-draw, or skip the drawing.",
    });
    expect(await sign(signForm("declinedtoken001"))).toEqual({ error: "This contract was previously declined. Contact the sender." });
    expect(await contractRow(id)).toMatchObject({ sign_status: "sent", signer_name: null, signed_at: null });
    expect(await contractRow(declined)).toMatchObject({ sign_status: "declined", signer_name: null });
    expect(await contractRow(unsent)).toMatchObject({ sign_status: "unsent", signer_name: null });
    expect(await signedNotices(c.org)).toHaveLength(0);
  });

  it("one address gets five tries a minute at the signing page", async () => {
    const c = await company();
    const id = await contract(c, (await withEmail(c, "Rate Limited")).id, { public_token: "ratelimittoken01", sign_status: "sent" });
    for (let i = 0; i < 5; i++) {
      expect(await as(null, () => signContractAction({}, signForm(`guess${i}token000000`)))).toEqual({ error: "Contract not found." });
    }
    expect(await as(null, () => signContractAction({}, signForm("ratelimittoken01")))).toEqual({
      error: "Too many attempts in a short time. Wait a minute and retry.",
    });
    expect((await contractRow(id)).sign_status).toBe("sent");
  });

  // FIX-LATER: signContractAction's update has no "not yet signed" guard, so two submits at once both sign: the second overwrites the first's name, time and IP, and the office is told twice.
  it.fails("two submits at the same moment sign it once", async () => {
    const c = await company();
    const id = await contract(c, (await withEmail(c, "Double Click")).id, { public_token: "doubleclicktok01", sign_status: "sent" });
    await Promise.all([
      as(null, () => signContractAction({}, signForm("doubleclicktok01", { signer_name: "First Signer" }))),
      as(null, () => signContractAction({}, signForm("doubleclicktok01", { signer_name: "Second Signer" }))),
    ]);
    const told = await signedNotices(c.org);
    expect(told.filter((t) => t.r === c.owner.membershipId), JSON.stringify(told)).toHaveLength(1);
    expect(`${(await contractRow(id)).signer_name} signed the contract.`).toBe(told[0].body);
  });
});

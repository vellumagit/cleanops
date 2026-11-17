/**
 * Leads and estimates, pressed as the office presses them, against a real
 * database behind the real PostgREST and the stand-in file storage. Outbound
 * email is caught; the estimate PDF renderer is a stand-in (no Chromium).
 *
 *   the leads page        add, move along, win, lose, reopen, edit
 *   an estimate           make, attach a PDF, send, approve, expire, delete
 *   the daily jobs        client follow-ups at 7 and 14 days, expiry, the
 *                         office's "needs follow-up" alert
 *
 * The checks that matter: each button does what it says to the person it
 * names and to nobody else (not a real client, not another company's lead),
 * a save that saved nothing says so, and nothing is half-done: a refused
 * PDF leaves no estimate behind, a save that didn't land leaves the file.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

type Sent = { to: string; subject: string; text?: string; html?: string; attachments?: unknown[] };
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
    return { ok: true };
  },
}));
vi.mock("@/lib/estimate-pdf", () => ({
  renderEstimatePdf: async () => Buffer.from("%PDF-1.4\n% stand-in\n"),
}));

const leads = await import("@/app/app/leads/actions");
const estimates = await import("@/app/app/estimates/actions");
const { GET: followupCron } = await import("@/app/api/cron/estimate-followup/route");
const { GET: expireCron } = await import("@/app/api/cron/expire-estimates/route");
const { GET: staleCron } = await import("@/app/api/cron/stale-estimates/route");

let api: Api;
let restoreEnv: () => void;
const CRON_SECRET = "estimates-test-cron-secret";

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

const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

async function cron(get: (r: NextRequest) => Promise<Response>, path: string) {
  const res = await get(new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }));
  await settle();
  return res;
}

const ALL_ON = {
  estimate_followup_email: { enabled: true },
  stale_estimate_alert: { enabled: true },
  auto_expire_stale_estimates: { enabled: true },
  auto_booking_on_estimate_approval: { enabled: true },
};

let seq = 0;
async function company(settings: Record<string, unknown> = ALL_ON) {
  const org = await addOrg(api.sql, "Estimates Co");
  await api.sql(
    `update public.organizations
        set timezone = 'America/Regina', automations_enabled = true, default_contact_preference = 'email',
            automation_settings = $2::jsonb, stale_estimate_expire_days = 30
      where id = $1`,
    [org, JSON.stringify(settings)],
  );
  const [{ name }] = await api.sql<{ name: string }>("select name from public.organizations where id = $1", [org]);
  return {
    org,
    name,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    olha: await addMember(api.sql, org, "manager", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
}
type Co = Awaited<ReturnType<typeof company>>;

/** A person on the books: a lead at a stage, or (stage null) a real client. */
async function person(c: Co, name: string, stage: "new" | "contacted" | "quoted" | null, email: string | null = `p${++seq}@example.com`) {
  const id = await addClient(api.sql, c.org, name);
  await api.sql(
    stage
      ? "update public.clients set email = $2, lifecycle = 'lead', lead_stage = $3, lead_source = 'phone' where id = $1"
      : "update public.clients set email = $2 where id = $1",
    stage ? [id, email, stage] : [id, email],
  );
  return id;
}

async function openRequest(c: Co, client: string) {
  const [r] = await api.sql<{ id: string }>(
    "insert into public.client_job_requests (organization_id, client_id, kind, body, status) values ($1, $2, 'job_note', 'Website inquiry\nplease call', 'open') returning id",
    [c.org, client],
  );
  return r.id;
}
const requestStatus = async (id: string) =>
  (await api.sql<{ s: string }>("select status as s from public.client_job_requests where id = $1", [id]))[0].s;
const lifecycleOf = async (id: string) =>
  (await api.sql<{ lifecycle: string; lead_stage: string | null }>("select lifecycle, lead_stage from public.clients where id = $1", [id]))[0];
const auditFor = (id: string) =>
  api.sql<{ action: string; after: Record<string, unknown> }>("select action, after from public.audit_log where entity_id = $1 order by created_at", [id]);

async function estimate(c: Co, client: string, over: Record<string, unknown> = {}) {
  const cols = { status: "draft", total_cents: 25000, service_description: "Deep clean", ...over };
  const keys = Object.keys(cols);
  const [e] = await api.sql<{ id: string }>(
    `insert into public.estimates (organization_id, client_id, ${keys.join(", ")})
     values ($1, $2, ${keys.map((k, i) => (k.endsWith("_at") ? `$${i + 3}::timestamptz` : k === "status" ? `$${i + 3}::public.estimate_status` : `$${i + 3}`)).join(", ")})
     returning id`,
    [c.org, client, ...Object.values(cols)],
  );
  return e.id;
}
const estimateRow = async (id: string) =>
  (
    await api.sql<{
      status: string;
      total_cents: number;
      notes: string | null;
      sent_at: string | null;
      decided_at: string | null;
      public_token: string | null;
      pdf_url: string | null;
      days_left: number | null;
    }>(
      `select status::text as status, total_cents, notes, sent_at, decided_at, public_token, pdf_url,
              round(extract(epoch from expires_at - now()) / 86400)::int as days_left
         from public.estimates where id = $1`,
      [id],
    )
  )[0];
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const pdf = () => new File([Buffer.from("%PDF-1.4\n% a real one\n")], "quote.pdf", { type: "application/pdf" });
const notPdf = () => new File([Buffer.from("hello, I am a text file")], "quote.pdf", { type: "application/pdf" });
const estimateForm = (client: string, over: Record<string, string | File> = {}) =>
  form({ client_id: client, service_description: "Deep clean, 3 bed", notes: "", status: "draft", total_cents: "289.50", ...over });

describe.skipIf(!hasPostgrest)("the leads page", () => {
  it("adds a lead from just a name, tidies the phone, and only for the people allowed", async () => {
    const c = await company();
    const res = await as(c.owner, () =>
      leads.addLeadAction({}, form({ name: "Pat Doyle", phone: "(403) 555-0123", source: "phone", note: "Called about a move-out" })),
    );
    expect(res).toMatchObject({ success: "Pat Doyle added." });
    const id = (res as { addedId: string }).addedId;
    const [row] = await api.sql<Record<string, unknown>>(
      "select phone, lifecycle, lead_stage, lead_source, lead_note from public.clients where id = $1",
      [id],
    );
    expect(row).toEqual({ phone: "+14035550123", lifecycle: "lead", lead_stage: "new", lead_source: "phone", lead_note: "Called about a move-out" });
    expect((await auditFor(id)).map((a) => a.action)).toEqual(["create"]);

    expect(await as(c.owner, () => leads.addLeadAction({}, form({ name: "   " })))).toEqual({ error: "A name is the one thing I need." });
    expect(await as(c.anna, () => leads.addLeadAction({}, form({ name: "Sneaky" })))).toEqual({ error: "You don't have permission." });
    await api.sql(`update public.memberships set capabilities = '{"clients": false}'::jsonb where id = $1`, [c.olha.membershipId]);
    expect(await as(c.olha, () => leads.addLeadAction({}, form({ name: "Narrowed" })))).toEqual({
      error: "Client records aren't part of your access.",
    });
  });

  it("moves a lead along, wins it, loses another and reopens it, closing their inbox items as it goes", async () => {
    const c = await company();
    const won = await person(c, "Won Lead", "new");
    const lost = await person(c, "Lost Lead", "contacted");
    const wonReq = await openRequest(c, won);
    const lostReq = await openRequest(c, lost);

    await as(c.owner, () => leads.setLeadStageAction(form({ id: won, stage: "quoted" })));
    expect(await lifecycleOf(won)).toEqual({ lifecycle: "lead", lead_stage: "quoted" });

    await as(c.owner, () => leads.convertLeadAction(form({ id: won })));
    await as(c.owner, () => leads.convertLeadAction(form({ id: won })));
    expect(await lifecycleOf(won)).toEqual({ lifecycle: "client", lead_stage: null });
    expect(await requestStatus(wonReq)).toBe("resolved");
    expect((await auditFor(won)).filter((a) => a.after?.converted_from_lead), "a double-click is one win").toHaveLength(1);

    await as(c.olha, () => leads.markLeadLostAction(form({ id: lost })));
    expect((await lifecycleOf(lost)).lifecycle).toBe("lost");
    expect(await requestStatus(lostReq)).toBe("resolved");

    await as(c.olha, () => leads.reopenLeadAction(form({ id: lost })));
    await as(c.olha, () => leads.reopenLeadAction(form({ id: lost })));
    expect(await lifecycleOf(lost)).toEqual({ lifecycle: "lead", lead_stage: "contacted" });
    expect((await auditFor(lost)).filter((a) => a.after?.reopened), "reopened once, logged once").toHaveLength(1);
  });

  it("a lead's buttons never touch a real client, and never another company's lead", async () => {
    const c = await company();
    const other = await company();
    const regular = await person(c, "Regular Client", null);
    const regularReq = await openRequest(c, regular);
    const theirs = await person(other, "Their Lead", "contacted");
    const theirReq = await openRequest(other, theirs);

    for (const press of [leads.markLeadLostAction, leads.convertLeadAction, leads.reopenLeadAction, leads.setLeadStageAction]) {
      await as(c.owner, () => press(form({ id: regular, stage: "quoted" })));
      await as(c.owner, () => press(form({ id: theirs, stage: "quoted" })));
    }
    expect(await lifecycleOf(regular)).toEqual({ lifecycle: "client", lead_stage: null });
    expect(await requestStatus(regularReq), "a real client's open request stays open").toBe("open");
    expect(await auditFor(regular), "and no 'lost' that never happened").toEqual([]);
    expect(await lifecycleOf(theirs)).toEqual({ lifecycle: "lead", lead_stage: "contacted" });
    expect(await requestStatus(theirReq), "another company's inbox is out of reach").toBe("open");

    expect(await as(c.owner, () => leads.updateLeadAction({}, form({ id: regular, name: "Renamed" })))).toEqual({
      error: "This lead no longer exists (it may have been converted).",
    });
    expect(await as(c.owner, () => leads.updateLeadAction({}, form({ id: theirs, name: "Renamed" })))).toMatchObject({ error: expect.any(String) });
    const names = await api.sql<{ name: string }>("select name from public.clients where id in ($1, $2)", [regular, theirs]);
    expect(names.map((n) => n.name)).not.toContain("Renamed");
  });

  it("the edit dialog saves a lead's details, tidily, for the people allowed", async () => {
    const c = await company();
    const id = await person(c, "Edit Me", "new");
    const saved = await as(c.olha, () =>
      leads.updateLeadAction(
        {},
        form({ id, name: "Edited Name", phone: "403.555.0177", email: "edited@example.com", address: "9 Oak Ave", lead_note: "Wants Fridays" }),
      ),
    );
    expect(saved).toMatchObject({ savedAt: expect.any(Number) });
    const [row] = await api.sql<Record<string, unknown>>("select name, phone, email, address, lead_note from public.clients where id = $1", [id]);
    expect(row).toEqual({ name: "Edited Name", phone: "+14035550177", email: "edited@example.com", address: "9 Oak Ave", lead_note: "Wants Fridays" });

    expect(await as(c.anna, () => leads.updateLeadAction({}, form({ id, name: "Anna Was Here" })))).toMatchObject({ error: expect.any(String) });
    await api.sql(`update public.memberships set capabilities = '{"clients": false}'::jsonb where id = $1`, [c.olha.membershipId]);
    expect(await as(c.olha, () => leads.updateLeadAction({}, form({ id, name: "Narrowed Edit" })))).toEqual({
      error: "Client records aren't part of your access.",
    });
    expect((await api.sql<{ name: string }>("select name from public.clients where id = $1", [id]))[0].name).toBe("Edited Name");
  });
});

describe.skipIf(!hasPostgrest)("an estimate", () => {
  it("is made by the office, with its PDF, and nobody else", async () => {
    const c = await company();
    const client = await person(c, "Estimate Client", "contacted");
    const res = await as(c.owner, () => estimates.createEstimateAction({}, estimateForm(client, { pdf: pdf() })));
    expect(res, api.log()).toEqual({ redirected: "/app/estimates" });
    const [made] = await api.sql<{ id: string }>("select id from public.estimates where client_id = $1", [client]);
    const row = await estimateRow(made.id);
    expect(row).toMatchObject({ status: "draft", total_cents: 28950, sent_at: null, pdf_url: `storage:estimate-pdfs/${c.org}/estimates/${made.id}.pdf` });
    expect(api.storage.has(`estimate-pdfs/${c.org}/estimates/${made.id}.pdf`)).toBe(true);

    const refused = (r: unknown) => (r as { errors?: Record<string, string> }).errors;
    expect(refused(await as(c.anna, () => estimates.createEstimateAction({}, estimateForm(client))))?._form).toBe(
      "Estimates aren't part of your access.",
    );
    expect(refused(await as(c.owner, () => estimates.createEstimateAction({}, estimateForm(client, { notes: "card 4242 4242 4242 4242" }))))?.notes).toBeTruthy();
    expect(await api.sql("select 1 from public.estimates where client_id = $1", [client])).toHaveLength(1);
  });

  it("a PDF that isn't one is refused before anything is saved, so trying again makes one estimate", async () => {
    const c = await company();
    const client = await person(c, "Retry Client", null);
    const first = await as(c.owner, () => estimates.createEstimateAction({}, estimateForm(client, { pdf: notPdf() })));
    expect((first as { errors?: Record<string, string> }).errors?.pdf).toBe("That file isn't a PDF.");
    expect(await api.sql("select 1 from public.estimates where client_id = $1", [client]), "nothing left behind").toHaveLength(0);

    expect(await as(c.owner, () => estimates.createEstimateAction({}, estimateForm(client, { pdf: pdf() })))).toEqual({ redirected: "/app/estimates" });
    expect(await api.sql("select 1 from public.estimates where client_id = $1", [client])).toHaveLength(1);
  });

  it("a manager's save lands; a save that can't land says so and leaves the PDF alone", async () => {
    const c = await company();
    const client = await person(c, "Manager Client", null);
    const id = await estimate(c, client);
    const res = await as(c.olha, () => estimates.updateEstimateAction(id, {}, estimateForm(client, { notes: "Olha's change", total_cents: "300" })));
    expect(res, api.log()).toEqual({ redirected: "/app/estimates" });
    expect(await estimateRow(id)).toMatchObject({ notes: "Olha's change", total_cents: 30000 });

    // Archived: the database refuses any change. The stored PDF must survive a
    // "remove PDF" on a save that didn't happen.
    const key = `estimate-pdfs/${c.org}/estimates/${id}.pdf`;
    api.storage.set(key, 100);
    await api.sql("update public.estimates set pdf_url = $2, archived_at = now() where id = $1", [id, `storage:${key}`]);
    const blocked = await as(c.owner, () => estimates.updateEstimateAction(id, {}, estimateForm(client, { remove_pdf: "1", notes: "late edit" })));
    expect((blocked as { errors?: Record<string, string> }).errors?._form).toBeTruthy();
    expect(api.storage.has(key), "the file is still there").toBe(true);
    expect((await estimateRow(id)).pdf_url).toBe(`storage:${key}`);
  });

  it("is sent to the client with a link that lasts 30 days, and a quoted lead moves to Quoted", async () => {
    const c = await company();
    const client = await person(c, "Send To", "contacted");
    const [{ email }] = await api.sql<{ email: string }>("select email from public.clients where id = $1", [client]);
    const id = await estimate(c, client);

    expect(await as(c.olha, () => estimates.sendEstimateAction({}, form({ id })))).toEqual({ ok: true });
    const row = await estimateRow(id);
    expect(row.status).toBe("sent");
    expect(row.sent_at).not.toBeNull();
    expect(row.days_left).toBe(30);
    expect(row.public_token).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    const mail = outbox.email.filter((m) => m.to === email);
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe(`Your estimate from ${c.name}`);
    expect(mail[0].html).toContain(`/e/${row.public_token}`);
    expect(mail[0].attachments, "a PDF copy rides along").toHaveLength(1);
    expect((await lifecycleOf(client)).lead_stage).toBe("quoted");

    // Sending again keeps the link and gives it 30 days from now.
    expect(await as(c.owner, () => estimates.sendEstimateAction({}, form({ id })))).toEqual({ ok: true });
    expect((await estimateRow(id)).public_token).toBe(row.public_token);
  });

  it("an old link's email promises the date the link will really last until", async () => {
    const c = await company();
    const client = await person(c, "Old Link", null);
    const [{ email }] = await api.sql<{ email: string }>("select email from public.clients where id = $1", [client]);
    // Minted weeks ago by "Download PDF", never sent.
    const id = await estimate(c, client, { public_token: "oldlinktoken0001", expires_at: daysAgo(10) });
    const fmt = (iso: number) =>
      new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Regina" });

    expect(await as(c.owner, () => estimates.sendEstimateAction({}, form({ id })))).toEqual({ ok: true });
    const [mail] = outbox.email.filter((m) => m.to === email);
    expect(mail.html).toContain(fmt(Date.now() + 30 * 86_400_000));
    expect(mail.html).not.toContain(fmt(Date.now() - 10 * 86_400_000));
    expect((await estimateRow(id)).days_left).toBe(30);
  });

  it("is never sent to nobody, or by the wrong person, or from another company", async () => {
    const c = await company();
    const other = await company();
    const noEmail = await person(c, "No Email", null, null);
    const theirs = await estimate(other, await person(other, "Their Client", null));
    const mine = await estimate(c, noEmail);

    expect(await as(c.owner, () => estimates.sendEstimateAction({}, form({ id: mine })))).toEqual({ error: "Client has no email on file" });
    expect(await as(c.anna, () => estimates.sendEstimateAction({}, form({ id: mine })))).toEqual({ error: "Estimates aren't part of your access." });
    expect(await as(c.owner, () => estimates.sendEstimateAction({}, form({ id: theirs })))).toEqual({ error: "Estimate not found" });
    expect(outbox.email).toHaveLength(0);
    expect((await estimateRow(theirs)).public_token).toBeNull();
  });

  it("approving it books one placeholder visit, tomorrow at 9, and not again on the next save", async () => {
    const c = await company();
    const client = await person(c, "Approve Me", "quoted");
    const id = await estimate(c, client, { status: "sent", sent_at: daysAgo(2) });
    const visits = () =>
      api.sql<{ id: string; status: string; at: string; reminded: boolean }>(
        `select id, status::text as status, to_char(scheduled_at at time zone 'America/Regina', 'HH24:MI') as at,
                client_reminder_sent_at is not null as reminded
           from public.bookings where estimate_id = $1`,
        [id],
      );

    await as(c.owner, () => estimates.updateEstimateAction(id, {}, estimateForm(client, { status: "approved" })));
    expect((await estimateRow(id)).decided_at).not.toBeNull();
    const booked = await visits();
    expect(booked.map(({ status, at, reminded }) => ({ status, at, reminded }))).toEqual([{ status: "pending", at: "09:00", reminded: true }]);
    expect((await lifecycleOf(client)).lifecycle, "booking them makes them a client").toBe("client");

    await api.sql("delete from public.bookings where id = $1", [booked[0].id]);
    await as(c.owner, () => estimates.updateEstimateAction(id, {}, estimateForm(client, { status: "approved", notes: "tidied" })));
    expect(await visits(), "the office deleted it; a tidy-up doesn't bring it back").toHaveLength(0);

    const off = await company({});
    const offClient = await person(off, "Switched Off", null);
    const offId = await estimate(off, offClient, { status: "sent", sent_at: daysAgo(2) });
    await as(off.owner, () => estimates.updateEstimateAction(offId, {}, estimateForm(offClient, { status: "approved" })));
    expect(await api.sql("select 1 from public.bookings where estimate_id = $1", [offId]), "automation off: no booking").toHaveLength(0);
  });

  it("re-saving an expired estimate keeps it expired and remembers when it was sent", async () => {
    const c = await company();
    const client = await person(c, "Expired Client", null);
    const sentAt = daysAgo(40);
    const id = await estimate(c, client, { status: "expired", sent_at: sentAt });
    await as(c.owner, () => estimates.updateEstimateAction(id, {}, estimateForm(client, { status: "expired", notes: "follow up in spring" })));
    const row = await estimateRow(id);
    expect(row.status).toBe("expired");
    expect(row.notes).toBe("follow up in spring");
    expect(new Date(row.sent_at!).toISOString()).toBe(sentAt);
  });

  it("the Download PDF button gets one lasting link, for this company's estimates only", async () => {
    const c = await company();
    const other = await company();
    const id = await estimate(c, await person(c, "Pdf Client", null));
    const theirs = await estimate(other, await person(other, "Their Pdf", null));

    const first = (await as(c.owner, () => estimates.ensureEstimatePublicTokenAction(id))) as { ok: boolean; token: string };
    expect(first.ok).toBe(true);
    expect(await as(c.olha, () => estimates.ensureEstimatePublicTokenAction(id))).toEqual(first);
    expect(await as(c.owner, () => estimates.ensureEstimatePublicTokenAction(theirs))).toEqual({ ok: false, error: "Estimate not found." });
    expect(await as(c.anna, () => estimates.ensureEstimatePublicTokenAction(id))).toEqual({ ok: false, error: "Estimates aren't part of your access." });
    expect((await estimateRow(theirs)).public_token).toBeNull();
  });

  it("is deleted with its PDF by the office, and nothing of anyone else's goes with it", async () => {
    const c = await company();
    const other = await company();
    const id = await estimate(c, await person(c, "Delete Me", null));
    const theirs = await estimate(other, await person(other, "Keep Me", null));
    const mineKey = `estimate-pdfs/${c.org}/estimates/${id}.pdf`;
    const theirKey = `estimate-pdfs/${other.org}/estimates/${theirs}.pdf`;
    api.storage.set(mineKey, 100);
    api.storage.set(theirKey, 100);

    await as(c.anna, () => estimates.deleteEstimateAction(form({ id })));
    expect(await api.sql("select 1 from public.estimates where id = $1", [id]), "a cleaner can't").toHaveLength(1);
    expect(await as(c.owner, () => estimates.deleteEstimateAction(form({ id: theirs })))).toEqual({ redirected: "/app/estimates" });
    expect(await api.sql("select 1 from public.estimates where id = $1", [theirs])).toHaveLength(1);
    expect(api.storage.has(theirKey)).toBe(true);

    expect(await as(c.olha, () => estimates.deleteEstimateAction(form({ id })))).toEqual({ redirected: "/app/estimates" });
    expect(await api.sql("select 1 from public.estimates where id = $1", [id])).toHaveLength(0);
    expect(api.storage.has(mineKey)).toBe(false);
  });
});

describe.skipIf(!hasPostgrest)("the daily estimate jobs", () => {
  it("follows up with the client at 7 days and again at 14, once each, and never after an answer", async () => {
    const c = await company();
    const week = await person(c, "Week Old", null);
    const fortnight = await person(c, "Fortnight Old", null);
    const answered = await person(c, "Answered", null);
    const fresh = await person(c, "Fresh", null);
    const emailOf = async (id: string) => (await api.sql<{ e: string }>("select email as e from public.clients where id = $1", [id]))[0].e;
    await estimate(c, week, { status: "sent", sent_at: daysAgo(8), public_token: `wk${++seq}tokentoken01` });
    await estimate(c, fortnight, { status: "sent", sent_at: daysAgo(15), public_token: `fn${seq}tokentoken01` });
    await estimate(c, answered, { status: "approved", sent_at: daysAgo(15), decided_at: daysAgo(1), public_token: `an${seq}tokentoken01` });
    await estimate(c, fresh, { status: "sent", sent_at: daysAgo(3), public_token: `fr${seq}tokentoken01` });

    expect((await cron(followupCron, "/api/cron/estimate-followup")).status).toBe(200);
    const subjects = async (id: string) => {
      const e = await emailOf(id);
      return outbox.email.filter((m) => m.to === e).map((m) => m.subject);
    };
    expect(await subjects(week)).toEqual([`Any questions on your estimate? — ${c.name}`]);
    expect(await subjects(fortnight)).toEqual(["Your estimate expires in about two weeks"]);
    expect(await subjects(answered)).toEqual([]);
    expect(await subjects(fresh)).toEqual([]);

    outbox.email.length = 0;
    await cron(followupCron, "/api/cron/estimate-followup");
    expect(await subjects(week), "once each").toEqual([]);
    expect(await subjects(fortnight)).toEqual([]);
  });

  it("expires an estimate nobody answered within the company's days, and nothing else", async () => {
    const c = await company();
    const old = await estimate(c, await person(c, "Old Sent", null), { status: "sent", sent_at: daysAgo(31) });
    const recent = await estimate(c, await person(c, "Recent Sent", null), { status: "sent", sent_at: daysAgo(29) });
    const draft = await estimate(c, await person(c, "Old Draft", null), { status: "draft" });
    const off = await company({});
    const notMine = await estimate(off, await person(off, "Switched Off", null), { status: "sent", sent_at: daysAgo(60) });

    expect((await cron(expireCron, "/api/cron/expire-estimates")).status).toBe(200);
    expect((await estimateRow(old)).status).toBe("expired");
    expect((await estimateRow(recent)).status).toBe("sent");
    expect((await estimateRow(draft)).status).toBe("draft");
    expect((await estimateRow(notMine)).status, "the company switched it off").toBe("sent");
  });

  it("tells the office once a week about an estimate waiting on an answer", async () => {
    const c = await company();
    const waiting = await estimate(c, await person(c, "Waiting On", null), { status: "sent", sent_at: daysAgo(9) });
    await estimate(c, await person(c, "Too New", null), { status: "sent", sent_at: daysAgo(2) });
    const alerts = () =>
      api.sql<{ r: string; href: string }>(
        "select recipient_membership_id as r, href from public.notifications where organization_id = $1 and title = 'Stale estimate — needs follow-up'",
        [c.org],
      );

    expect((await cron(staleCron, "/api/cron/stale-estimates")).status).toBe(200);
    const first = await alerts();
    expect(first.map((a) => a.href)).toEqual(first.map(() => `/app/estimates/${waiting}/edit`));
    expect(first.map((a) => a.r)).toContain(c.owner.membershipId);
    expect(first.map((a) => a.r), "not the cleaners").not.toContain(c.anna.membershipId);

    await cron(staleCron, "/api/cron/stale-estimates");
    expect(await alerts(), "not again the next day").toHaveLength(first.length);
  });
});

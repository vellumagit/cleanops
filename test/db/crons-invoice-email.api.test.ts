/**
 * The invoice crons that email Svit's clients, run through their real routes
 * against a real database behind the real PostgREST.
 *
 *   invoice-auto-send   sends drafts whose review window has passed
 *   invoice-overdue     flips past-due invoices to overdue and reminds clients
 *   void-invoices       writes off long-overdue unpaid invoices
 *   invoice-review-digest  the owner's morning list of what is about to go out
 *
 * Only the edges are stood in for: Resend (the SDK, so the app's own email
 * code, kill switch, daily cap and sender all run), the SMS sender, and any
 * fetch that leaves the test stack (the invoice PDF lives on the site).
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

type Mail = { to: string; subject: string; html: string; text: string };
const outbox = vi.hoisted(() => ({
  mail: [] as Array<{ to: string; subject: string; html: string; text: string }>,
  sms: [] as Array<{ to: string; body: string; key?: string }>,
  refuse: new Set<string>(),
  external: [] as string[],
}));

// Resend itself: everything in src/lib/email.ts runs, only the wire is caught.
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: { to: string[]; subject: string; html: string; text?: string }) => {
        const to = String(payload.to[0]).replace(/^.*<([^>]+)>$/, "$1");
        if (outbox.refuse.has(to)) return { data: null, error: { name: "application_error", message: "test: Resend is down" } };
        outbox.mail.push({ to, subject: payload.subject, html: payload.html, text: payload.text ?? "" });
        return { data: { id: `msg-${outbox.mail.length}` }, error: null };
      },
    };
  },
}));
vi.mock("@/lib/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms")>()),
  sendOrgSms: async (_org: string, args: { to: string; body: string; automationKey?: string }) => {
    outbox.sms.push({ to: args.to, body: args.body, key: args.automationKey });
    return { ok: true, status: "sent" };
  },
}));

const SECRET = "crons-invoice-email-test-secret-0123";
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
  // Nothing leaves the machine: the stack is on 127.0.0.1, anything else
  // (the invoice PDF on the site, a stray provider call) is answered here.
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
  outbox.sms.length = 0;
  outbox.refuse.clear();
  outbox.external.length = 0;
});

type Handler = (req: NextRequest) => Promise<Response>;
async function call(GET: Handler, path: string, auth: string | null = `Bearer ${SECRET}`) {
  const res = await GET(new NextRequest(`${SITE}${path}`, { headers: auth ? { authorization: auth } : {} }));
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
const ymd = (daysFromToday: number) => new Date(Date.now() + daysFromToday * DAY).toISOString().slice(0, 10);
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

type CompanyOpts = {
  automations?: boolean;
  settings?: Record<string, { enabled: boolean }>;
  autoSend?: boolean;
  defaultContact?: "email" | "sms" | "both" | "none";
  voidDays?: number | null;
};
type Company = { org: string; owner: Member; admin: Member; manager: Member };

async function company(name: string, o: CompanyOpts = {}): Promise<Company> {
  const org = await addOrg(api.sql, name);
  await api.sql(
    `update public.organizations
        set timezone = $2, currency_code = 'CAD', automations_enabled = $3, automation_settings = $4::jsonb,
            invoice_auto_send_enabled = $5, default_contact_preference = $6, email_daily_cap = null,
            invoice_void_days = $7
      where id = $1`,
    [org, TZ, o.automations ?? true, JSON.stringify(o.settings ?? {}), o.autoSend ?? false, o.defaultContact ?? "email", o.voidDays === undefined ? 365 : o.voidDays],
  );
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    admin: await addMember(api.sql, org, "admin", "Office Admin"),
    manager: await addMember(api.sql, org, "manager", "Manager"),
  };
}

let seq = 0;
type ClientOpts = {
  email?: string | null;
  phone?: string | null;
  smsOptedIn?: boolean;
  pref?: "inherit" | "custom" | "do_not_contact";
  overrides?: Record<string, unknown>;
};
async function client(org: string, o: ClientOpts = {}): Promise<{ id: string; email: string | null; phone: string | null }> {
  const id = await addClient(api.sql, org, "Hilda Daubner");
  const email = o.email === undefined ? `client-${++seq}-${id.slice(0, 6)}@example.com` : o.email;
  await api.sql(
    `update public.clients set email = $2, phone = $3, sms_opted_in = $4, contact_preference = $5, contact_overrides = $6::jsonb where id = $1`,
    [id, email, o.phone ?? null, o.smsOptedIn ?? false, o.pref ?? "inherit", JSON.stringify(o.overrides ?? {})],
  );
  return { id, email, phone: o.phone ?? null };
}

type InvoiceOpts = {
  status?: string;
  cents?: number;
  due?: string;
  sentAt?: string | null;
  paidAt?: string | null;
  voidedAt?: string | null;
  autoState?: string | null;
  autoAt?: string | null;
  remindedAt?: string | null;
  bookingId?: string | null;
};
async function invoice(org: string, clientId: string, o: InvoiceOpts = {}): Promise<string> {
  const [row] = await api.sql<{ id: string }>(
    `insert into public.invoices
       (organization_id, client_id, number, status, amount_cents, due_date, sent_at, paid_at, voided_at,
        auto_send_state, auto_send_at, overdue_reminder_sent_at, booking_id)
     values ($1, $2, $3, $4::public.invoice_status, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
    [
      org,
      clientId,
      `INV-T-${++seq}`,
      o.status ?? "draft",
      o.cents ?? 14_000,
      o.due ?? ymd(14),
      o.sentAt ?? null,
      o.paidAt ?? null,
      o.voidedAt ?? null,
      o.autoState ?? null,
      o.autoAt ?? null,
      o.remindedAt ?? null,
      o.bookingId ?? null,
    ],
  );
  return row.id;
}

const inv = async (id: string) =>
  (
    await api.sql<{
      status: string;
      auto: string | null;
      sent_at: string | null;
      voided_at: string | null;
      reminded: string | null;
    }>(
      `select status::text as status, auto_send_state as auto, sent_at::text, voided_at::text,
              overdue_reminder_sent_at::text as reminded
         from public.invoices where id = $1`,
      [id],
    )
  )[0];

const mailTo = (email: string | null) => outbox.mail.filter((m) => m.to === email);
const emailOf = async (m: Member) =>
  (await api.sql<{ email: string }>("select email from auth.users where id = $1", [m.userId]))[0].email;
const lastRun = async (path: string) =>
  (
    await api.sql<{ ok: boolean; status: number | null }>(
      "select ok, status from public.cron_runs where path = $1 order by started_at desc limit 1",
      [path],
    )
  )[0];

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("invoice crons refuse anyone without the cron secret", { timeout: 120_000 }, () => {
  it("401 without or with the wrong Bearer, 503 when the secret is unset; refusals change nothing and are not logged as runs", async () => {
    const routes = [
      ["/api/cron/invoice-auto-send", (await import("@/app/api/cron/invoice-auto-send/route")).GET],
      ["/api/cron/invoice-overdue", (await import("@/app/api/cron/invoice-overdue/route")).GET],
      ["/api/cron/invoice-review-digest", (await import("@/app/api/cron/invoice-review-digest/route")).GET],
      ["/api/cron/void-invoices", (await import("@/app/api/cron/void-invoices/route")).GET],
    ] as const;
    const c = await company("Refusal Co", { autoSend: true, settings: { invoice_overdue_reminder: { enabled: true }, auto_void_overdue_invoices: { enabled: true } } });
    const k = await client(c.org);
    const due = await invoice(c.org, k.id, { autoState: "scheduled", autoAt: ago(0.01) });
    const overdue = await invoice(c.org, k.id, { status: "sent", sentAt: ago(20), due: ymd(-10) });

    for (const [path, GET] of routes) {
      expect((await call(GET as Handler, path, null)).status, path).toBe(401);
      expect((await call(GET as Handler, path, "Bearer not-the-secret-at-all-0000")).status, path).toBe(401);
      expect((await call(GET as Handler, path, SECRET)).status, `${path} without "Bearer "`).toBe(401);
    }
    process.env.CRON_SECRET = "";
    try {
      for (const [path, GET] of routes) expect((await call(GET as Handler, path)).status, path).toBe(503);
    } finally {
      process.env.CRON_SECRET = SECRET;
    }

    expect(outbox.mail).toHaveLength(0);
    expect(await inv(due)).toMatchObject({ status: "draft", auto: "scheduled" });
    expect(await inv(overdue)).toMatchObject({ status: "sent", reminded: null });
    const runs = await api.sql("select 1 from public.cron_runs where path = any($1::text[])", [routes.map((r) => r[0])]);
    expect(runs).toHaveLength(0);
  });
});

describe.skipIf(!hasPostgrest)("invoice-auto-send: each due draft goes once, and only where it may", { timeout: 180_000 }, () => {
  it("sends the due draft once; leaves not-yet-due, held, voided, paid, $0 and unwanted ones alone", async () => {
    const { GET } = await import("@/app/api/cron/invoice-auto-send/route");
    const on = await company("AutoSend On", { autoSend: true });
    const offSend = await company("AutoSend Off", { autoSend: false });
    const offMaster = await company("Master Off", { autoSend: true, automations: false });
    const silentHouse = await company("House None", { autoSend: true, defaultContact: "none" });

    const happy = await client(on.org);
    const dueId = await invoice(on.org, happy.id, { autoState: "scheduled", autoAt: ago(0.01) });
    const later = await client(on.org);
    const laterId = await invoice(on.org, later.id, { autoState: "scheduled", autoAt: new Date(Date.now() + 3_600_000).toISOString() });
    const heldC = await client(on.org);
    const heldId = await invoice(on.org, heldC.id, { autoState: "held", autoAt: ago(0.01) });
    const voidC = await client(on.org);
    const voidId = await invoice(on.org, voidC.id, { status: "void", voidedAt: ago(1), autoState: "scheduled", autoAt: ago(0.01) });
    const paidC = await client(on.org);
    const paidId = await invoice(on.org, paidC.id, { status: "paid", paidAt: ago(1), autoState: "scheduled", autoAt: ago(0.01) });
    const zeroC = await client(on.org);
    const zeroId = await invoice(on.org, zeroC.id, { cents: 0, autoState: "scheduled", autoAt: ago(0.01) });
    const dnc = await client(on.org, { pref: "do_not_contact" });
    const dncId = await invoice(on.org, dnc.id, { autoState: "scheduled", autoAt: ago(0.01) });
    const billingOff = await client(on.org, { pref: "custom", overrides: { billing: "off" } });
    const billingOffId = await invoice(on.org, billingOff.id, { autoState: "scheduled", autoAt: ago(0.01) });
    const muted = await client(on.org, { overrides: { muted_events: ["invoice_send"] } });
    const mutedId = await invoice(on.org, muted.id, { autoState: "scheduled", autoAt: ago(0.01) });
    const textOnly = await client(on.org, { email: null, phone: "+13065550111", smsOptedIn: true, pref: "custom", overrides: { billing: "sms" } });
    const textId = await invoice(on.org, textOnly.id, { autoState: "scheduled", autoAt: ago(0.01) });

    const offSendC = await client(offSend.org);
    const offSendId = await invoice(offSend.org, offSendC.id, { autoState: "scheduled", autoAt: ago(0.01) });
    const offMasterC = await client(offMaster.org);
    const offMasterId = await invoice(offMaster.org, offMasterC.id, { autoState: "scheduled", autoAt: ago(0.01) });
    const houseC = await client(silentHouse.org);
    const houseId = await invoice(silentHouse.org, houseC.id, { autoState: "scheduled", autoAt: ago(0.01) });

    const run = await call(GET, "/api/cron/invoice-auto-send");
    expect(run.status, JSON.stringify(run.body) + api.log()).toBe(200);
    expect(await lastRun("/api/cron/invoice-auto-send")).toEqual({ ok: true, status: 200 });

    // The due draft: one email to the client, sent, terminal.
    expect(mailTo(happy.email)).toHaveLength(1);
    expect(mailTo(happy.email)[0].subject).toMatch(/invoice/i);
    expect(mailTo(happy.email)[0].html).toContain(`${SITE}/i/`);
    const sent = await inv(dueId);
    expect(sent).toMatchObject({ status: "sent", auto: "sent" });
    expect(sent.sent_at).not.toBeNull();
    const [audit] = await api.sql<{ after: { auto_sent?: boolean } }>(
      "select after from public.audit_log where entity_id = $1 and action = 'status_change'",
      [dueId],
    );
    expect(audit?.after?.auto_sent).toBe(true);

    // Text-only client: the text is the delivery.
    expect(outbox.sms.filter((s) => s.to === textOnly.phone)).toHaveLength(1);
    expect(await inv(textId)).toMatchObject({ status: "sent", auto: "sent" });

    // Untouched: not yet due, held by a person.
    expect(await inv(laterId)).toMatchObject({ status: "draft", auto: "scheduled", sent_at: null });
    expect(await inv(heldId)).toMatchObject({ status: "draft", auto: "held", sent_at: null });
    // Voided and paid are not drafts and are never picked up.
    expect(await inv(voidId)).toMatchObject({ status: "void", sent_at: null });
    expect(await inv(paidId)).toMatchObject({ status: "paid", sent_at: null });
    // $0, do-not-contact, billing off, this message muted, house default none: skipped for good.
    for (const id of [zeroId, dncId, billingOffId, mutedId, houseId]) {
      expect(await inv(id), id.slice(0, 8)).toMatchObject({ status: "draft", auto: "skipped", sent_at: null });
    }
    // Auto-send or the master switch turned off after scheduling: stood down.
    for (const id of [offSendId, offMasterId]) {
      expect(await inv(id), id.slice(0, 8)).toMatchObject({ status: "draft", auto: "held", sent_at: null });
    }
    for (const quiet of [later, heldC, voidC, paidC, zeroC, dnc, billingOff, muted, offSendC, offMasterC, houseC]) {
      expect(mailTo(quiet.email), quiet.email ?? "").toHaveLength(0);
    }
    // The only thing that left the machine was the PDF fetch, to the site.
    expect(outbox.external.every((u) => u.startsWith(`GET ${SITE}/api/i/`)), outbox.external.join("\n")).toBe(true);

    // A second run the same day sends nothing and changes nothing.
    const before = await Promise.all([dueId, laterId, heldId, zeroId, dncId, offSendId].map(inv));
    outbox.mail.length = 0;
    outbox.sms.length = 0;
    expect((await call(GET, "/api/cron/invoice-auto-send")).status).toBe(200);
    expect(outbox.mail.filter((m) => m.to.endsWith("@example.com"))).toHaveLength(0);
    expect(outbox.sms).toHaveLength(0);
    expect(await Promise.all([dueId, laterId, heldId, zeroId, dncId, offSendId].map(inv))).toEqual(before);
  });

  it("an org whose sending is suspended sends nothing; the draft is not marked sent", async () => {
    const { GET } = await import("@/app/api/cron/invoice-auto-send/route");
    const c = await company("Suspended Sender", { autoSend: true });
    await api.sql("update public.organizations set suspended_at = now() where id = $1", [c.org]);
    const k = await client(c.org);
    const id = await invoice(c.org, k.id, { autoState: "scheduled", autoAt: ago(0.01) });
    expect((await call(GET, "/api/cron/invoice-auto-send")).status).toBe(200);
    expect(mailTo(k.email)).toHaveLength(0);
    expect((await inv(id)).status).toBe("draft");
    expect((await inv(id)).sent_at).toBeNull();
  });

  it("two runs at the same moment (a retry, a manual trigger) still send each invoice once", async () => {
    const { GET } = await import("@/app/api/cron/invoice-auto-send/route");
    const c = await company("Overlap Co", { autoSend: true });
    const k = await client(c.org);
    const id = await invoice(c.org, k.id, { autoState: "scheduled", autoAt: ago(0.01) });
    const runs = await Promise.all([call(GET, "/api/cron/invoice-auto-send"), call(GET, "/api/cron/invoice-auto-send")]);
    expect(runs.map((r) => r.status)).toEqual([200, 200]);
    expect(mailTo(k.email)).toHaveLength(1);
    expect(await inv(id)).toMatchObject({ status: "sent", auto: "sent" });
  });

  it("when Resend is down nothing is marked sent, and the next run does not send it twice", async () => {
    const { GET } = await import("@/app/api/cron/invoice-auto-send/route");
    const c = await company("Resend Down Co", { autoSend: true });
    const k = await client(c.org);
    const id = await invoice(c.org, k.id, { autoState: "scheduled", autoAt: ago(0.01) });
    outbox.refuse.add(k.email!);
    expect((await call(GET, "/api/cron/invoice-auto-send")).status).toBe(200);
    expect(mailTo(k.email)).toHaveLength(0);
    // At most once: the claim leaves it held for a person (src/lib/invoice-send.ts, the CLAIM comment).
    expect(await inv(id)).toMatchObject({ status: "draft", auto: "held", sent_at: null });
    outbox.refuse.clear();
    expect((await call(GET, "/api/cron/invoice-auto-send")).status).toBe(200);
    expect(mailTo(k.email)).toHaveLength(0);
  });

  it("a client with no email: the draft is skipped and the owner is told it did not go", async () => {
    const { GET } = await import("@/app/api/cron/invoice-auto-send/route");
    const c = await company("No Email Co", { autoSend: true });
    const k = await client(c.org, { email: null });
    const id = await invoice(c.org, k.id, { autoState: "scheduled", autoAt: ago(0.01) });
    expect((await call(GET, "/api/cron/invoice-auto-send")).status).toBe(200);
    expect(await inv(id)).toMatchObject({ status: "draft", auto: "skipped" });
    const told = await api.sql<{ recipient_membership_id: string }>(
      "select recipient_membership_id from public.notifications where organization_id = $1 and type::text = 'invoice_auto_send_failed'",
      [c.org],
    );
    expect(told.map((t) => t.recipient_membership_id).sort()).toEqual([c.owner.membershipId, c.admin.membershipId].sort());
  });

  it("a scheduled draft that took a part prepayment is still sent to the client, and stays part-paid", async () => {
    const { GET } = await import("@/app/api/cron/invoice-auto-send/route");
    const c = await company("Prepaid Co", { autoSend: true });
    const k = await client(c.org);
    const id = await invoice(c.org, k.id, { autoState: "scheduled", autoAt: ago(0.01) });
    await api.sql(
      "insert into public.invoice_payments (organization_id, invoice_id, amount_cents, method) values ($1, $2, 4000, 'cash')",
      [c.org, id],
    );
    expect((await inv(id)).status).toBe("partially_paid");
    expect((await call(GET, "/api/cron/invoice-auto-send")).status).toBe(200);
    expect(mailTo(k.email)).toHaveLength(1);
    expect((await inv(id)).sent_at).not.toBeNull();
    expect((await inv(id)).status, "the payment still shows").toBe("partially_paid");
    expect((await call(GET, "/api/cron/invoice-auto-send")).status).toBe(200);
    expect(mailTo(k.email), "once").toHaveLength(1);
  });
});

describe.skipIf(!hasPostgrest)("invoice-overdue: past-due invoices are flipped and each client reminded once a week", { timeout: 180_000 }, () => {
  it("reminds the past-due client once; respects preferences, the org switch and the master switch; leaves void, paid and drafts alone", async () => {
    const { GET } = await import("@/app/api/cron/invoice-overdue/route");
    const on = await company("Overdue On", { settings: { invoice_overdue_reminder: { enabled: true } } });
    const off = await company("Overdue Off", { settings: { invoice_overdue_reminder: { enabled: false } } });
    const master = await company("Overdue Master Off", { automations: false, settings: { invoice_overdue_reminder: { enabled: true } } });
    const house = await company("Overdue House None", { defaultContact: "none", settings: { invoice_overdue_reminder: { enabled: true } } });

    const pastDue = { status: "sent", sentAt: ago(20), due: ymd(-10) };
    const a = await client(on.org);
    const aId = await invoice(on.org, a.id, pastDue);
    const texted = await client(on.org, { email: null, phone: "+13065550122", smsOptedIn: true, pref: "custom", overrides: { billing: "sms" } });
    const textedId = await invoice(on.org, texted.id, pastDue);
    const dnc = await client(on.org, { pref: "do_not_contact" });
    const dncId = await invoice(on.org, dnc.id, pastDue);
    const billingOff = await client(on.org, { pref: "custom", overrides: { billing: "off" } });
    const billingOffId = await invoice(on.org, billingOff.id, pastDue);
    const muted = await client(on.org, { overrides: { muted_events: ["overdue_reminder"] } });
    const mutedId = await invoice(on.org, muted.id, pastDue);
    const voidC = await client(on.org);
    const voidId = await invoice(on.org, voidC.id, { ...pastDue, status: "void", voidedAt: ago(2) });
    const paidC = await client(on.org);
    const paidId = await invoice(on.org, paidC.id, { ...pastDue, status: "paid", paidAt: ago(3) });
    const draftC = await client(on.org);
    const draftId = await invoice(on.org, draftC.id, { status: "draft", due: ymd(-10) });
    const notDue = await client(on.org);
    const notDueId = await invoice(on.org, notDue.id, { status: "sent", sentAt: ago(2), due: ymd(5) });
    const lately = await client(on.org);
    const latelyId = await invoice(on.org, lately.id, { status: "overdue", sentAt: ago(30), due: ymd(-20), remindedAt: ago(2) });

    const offC = await client(off.org);
    const offId = await invoice(off.org, offC.id, pastDue);
    const masterC = await client(master.org);
    const masterId = await invoice(master.org, masterC.id, pastDue);
    const houseC = await client(house.org);
    const houseId = await invoice(house.org, houseC.id, pastDue);

    const run = await call(GET, "/api/cron/invoice-overdue");
    expect(run.status, JSON.stringify(run.body) + api.log()).toBe(200);
    expect(await lastRun("/api/cron/invoice-overdue")).toEqual({ ok: true, status: 200 });

    expect(mailTo(a.email)).toHaveLength(1);
    expect(mailTo(a.email)[0].subject).toMatch(/overdue/i);
    expect(mailTo(a.email)[0].text).toContain("$140.00");
    const reminded = await inv(aId);
    expect(reminded.status).toBe("overdue");
    expect(reminded.reminded).not.toBeNull();
    expect(outbox.sms.filter((s) => s.to === texted.phone)).toHaveLength(1);
    expect((await inv(textedId)).reminded).not.toBeNull();

    // Preferences and switches: not chased, not stamped.
    for (const [k, id] of [
      [dnc, dncId],
      [billingOff, billingOffId],
      [muted, mutedId],
      [offC, offId],
      [masterC, masterId],
      [houseC, houseId],
      [lately, latelyId],
    ] as const) {
      expect(mailTo(k.email), k.email ?? "").toHaveLength(0);
      if (id !== latelyId) expect((await inv(id)).reminded, id.slice(0, 8)).toBeNull();
    }
    // Void, paid and drafts are left exactly as they were.
    expect(await inv(voidId)).toMatchObject({ status: "void", reminded: null });
    expect(await inv(paidId)).toMatchObject({ status: "paid", reminded: null });
    expect(await inv(draftId)).toMatchObject({ status: "draft", reminded: null });
    expect(await inv(notDueId)).toMatchObject({ status: "sent", reminded: null });
    for (const k of [voidC, paidC, draftC, notDue]) expect(mailTo(k.email)).toHaveLength(0);

    // The same day again: nothing new to anyone.
    outbox.mail.length = 0;
    outbox.sms.length = 0;
    expect((await call(GET, "/api/cron/invoice-overdue")).status).toBe(200);
    expect(outbox.mail.filter((m) => m.to.endsWith("@example.com"))).toHaveLength(0);
    expect(outbox.sms).toHaveLength(0);
  });

  it("two runs at the same moment remind each client once", async () => {
    const { GET } = await import("@/app/api/cron/invoice-overdue/route");
    const c = await company("Overdue Overlap", { settings: { invoice_overdue_reminder: { enabled: true } } });
    const k = await client(c.org);
    await invoice(c.org, k.id, { status: "sent", sentAt: ago(20), due: ymd(-10) });
    const runs = await Promise.all([call(GET, "/api/cron/invoice-overdue"), call(GET, "/api/cron/invoice-overdue")]);
    expect(runs.map((r) => r.status)).toEqual([200, 200]);
    expect(mailTo(k.email)).toHaveLength(1);
  });

  it("a reminder that could not be delivered is not stamped, so it is tried again next run", async () => {
    const { GET } = await import("@/app/api/cron/invoice-overdue/route");
    const c = await company("Paused Sender", { settings: { invoice_overdue_reminder: { enabled: true } } });
    await api.sql("update public.organizations set email_daily_cap = 0 where id = $1", [c.org]);
    const k = await client(c.org);
    const id = await invoice(c.org, k.id, { status: "sent", sentAt: ago(20), due: ymd(-10) });
    expect((await call(GET, "/api/cron/invoice-overdue")).status).toBe(200);
    expect(mailTo(k.email)).toHaveLength(0);
    expect((await inv(id)).reminded).toBeNull();

    await api.sql("update public.organizations set email_daily_cap = null where id = $1", [c.org]);
    expect((await call(GET, "/api/cron/invoice-overdue")).status).toBe(200);
    expect(mailTo(k.email)).toHaveLength(1);
    expect((await inv(id)).reminded).not.toBeNull();
  });
});

describe.skipIf(!hasPostgrest)("void-invoices: only long-overdue, unpaid invoices are written off", { timeout: 180_000 }, () => {
  it("voids the overdue invoice past the org's days, never paid, part-paid, recent, sent or draft ones; tells the owner once", async () => {
    const { GET } = await import("@/app/api/cron/void-invoices/route");
    const on = { settings: { auto_void_overdue_invoices: { enabled: true } } };
    const v = await company("Void On", { ...on, voidDays: 30 });
    const off = await company("Void Off", { voidDays: 30, settings: { auto_void_overdue_invoices: { enabled: false } } });
    const blank = await company("Void Blank Days", { ...on, voidDays: null });
    const master = await company("Void Master Off", { ...on, voidDays: 30, automations: false });

    const k = await client(v.org);
    const [booking] = await api.sql<{ id: string }>(
      `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status)
       values ($1, $2, now() - interval '45 days', 120, 'standard', 'completed') returning id`,
      [v.org, k.id],
    );
    const old = { status: "overdue", sentAt: ago(70), due: ymd(-40) };
    const oldId = await invoice(v.org, k.id, { ...old, bookingId: booking.id });
    await api.sql("update public.bookings set billing_invoice_id = $2 where id = $1", [booking.id, oldId]);
    const recentId = await invoice(v.org, k.id, { status: "overdue", sentAt: ago(40), due: ymd(-20) });
    const paidId = await invoice(v.org, k.id, { ...old, status: "paid", paidAt: ago(5) });
    const partId = await invoice(v.org, k.id, { ...old, status: "sent" });
    await api.sql("insert into public.invoice_payments (organization_id, invoice_id, amount_cents, method) values ($1, $2, 5000, 'cash')", [v.org, partId]);
    const sentId = await invoice(v.org, k.id, { ...old, status: "sent" });
    const draftId = await invoice(v.org, k.id, { status: "draft", due: ymd(-40) });
    const alreadyVoidAt = ago(5);
    const alreadyId = await invoice(v.org, k.id, { ...old, status: "void", voidedAt: alreadyVoidAt });

    const others = await Promise.all(
      [off, blank, master].map(async (c) => invoice(c.org, (await client(c.org)).id, old)),
    );

    expect((await inv(partId)).status).toBe("partially_paid");
    const run = await call(GET, "/api/cron/void-invoices");
    expect(run.status, JSON.stringify(run.body) + api.log()).toBe(200);
    expect(await lastRun("/api/cron/void-invoices")).toEqual({ ok: true, status: 200 });

    const voided = await inv(oldId);
    expect(voided.status).toBe("void");
    expect(voided.voided_at).not.toBeNull();
    expect(await inv(recentId)).toMatchObject({ status: "overdue", voided_at: null });
    expect(await inv(paidId)).toMatchObject({ status: "paid", voided_at: null });
    expect(await inv(partId)).toMatchObject({ status: "partially_paid", voided_at: null });
    expect(await inv(sentId)).toMatchObject({ status: "sent", voided_at: null });
    expect(await inv(draftId)).toMatchObject({ status: "draft", voided_at: null });
    const already = await inv(alreadyId);
    expect(new Date(already.voided_at!).getTime()).toBe(new Date(alreadyVoidAt).getTime());
    for (const id of others) expect(await inv(id), id.slice(0, 8)).toMatchObject({ status: "overdue", voided_at: null });

    // The job leaves automatic billing; the write-off leaves a trail and tells the owner.
    const [job] = await api.sql<{ billing_invoice_id: string | null; released: boolean }>(
      "select billing_invoice_id, billing_released_at is not null as released from public.bookings where id = $1",
      [booking.id],
    );
    expect(job).toEqual({ billing_invoice_id: null, released: true });
    expect(await api.sql("select 1 from public.audit_log where entity_id = $1 and action = 'status_change'", [oldId])).toHaveLength(1);
    const told = await api.sql<{ title: string }>(
      "select title from public.notifications where organization_id = $1 and title like '%voided automatically'",
      [v.org],
    );
    expect(told.length).toBeGreaterThan(0);
    expect(mailTo(await emailOf(v.owner)).filter((m) => /voided/i.test(m.subject + m.html))).toHaveLength(1);

    // Tomorrow: nothing more is voided and nobody is told again.
    const toldBefore = told.length;
    outbox.mail.length = 0;
    expect((await call(GET, "/api/cron/void-invoices")).status).toBe(200);
    expect(await inv(recentId)).toMatchObject({ status: "overdue" });
    expect(
      await api.sql("select 1 from public.notifications where organization_id = $1 and title like '%voided automatically'", [v.org]),
    ).toHaveLength(toldBefore);
    expect(mailTo(await emailOf(v.owner))).toHaveLength(0);
  });
});

describe.skipIf(!hasPostgrest)("invoice-review-digest: the owner's morning list of yesterday's jobs and today's sends", { timeout: 180_000 }, () => {
  /** Noon (Regina, UTC-6 all year) on the Regina calendar day `offset` from today. */
  function reginaNoon(offset: number): string {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date())
      .split("-")
      .map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + offset, 18, 0)).toISOString();
  }

  it("goes to owners and admins where it is on, lists yesterday's completed jobs and today's scheduled drafts only", async () => {
    const { GET } = await import("@/app/api/cron/invoice-review-digest/route");
    const on = await company("Digest On", { autoSend: true, settings: { invoice_review_digest: { enabled: true } } });
    const off = await company("Digest Off", { autoSend: true, settings: { invoice_review_digest: { enabled: false } } });
    const quiet = await company("Digest Quiet", { autoSend: true, settings: { invoice_review_digest: { enabled: true } } });

    const job = async (org: string, name: string, at: string, status = "completed") => {
      const id = await addClient(api.sql, org, name);
      await api.sql(
        `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status)
         values ($1, $2, $3, 120, 'standard', $4::public.booking_status)`,
        [org, id, at, status],
      );
    };
    await job(on.org, "Ken Hicks", reginaNoon(-1));
    await job(on.org, "Lori Moeller", reginaNoon(-3));
    await job(on.org, "Emma Drebit", reginaNoon(-1), "cancelled");
    const todayDraftClient = await addClient(api.sql, on.org, "Nancy Ellestad");
    await invoice(on.org, todayDraftClient, { autoState: "scheduled", autoAt: new Date(new Date(reginaNoon(0)).getTime() + 5 * 3_600_000).toISOString() });
    const tomorrowClient = await addClient(api.sql, on.org, "Margaret MacLeod");
    await invoice(on.org, tomorrowClient, { autoState: "scheduled", autoAt: reginaNoon(1) });
    const heldClient = await addClient(api.sql, on.org, "Patricia Poohkay");
    await invoice(on.org, heldClient, { autoState: "held", autoAt: reginaNoon(0) });
    await job(off.org, "Off Org Client", reginaNoon(-1));
    // Drafts going out today and no jobs yesterday: still worth a digest.
    const onlyDrafts = await company("Digest Drafts Only", { autoSend: true, settings: { invoice_review_digest: { enabled: true } } });
    await invoice(onlyDrafts.org, await addClient(api.sql, onlyDrafts.org, "Emma Drebit"), {
      autoState: "scheduled",
      autoAt: new Date(new Date(reginaNoon(0)).getTime() + 5 * 3_600_000).toISOString(),
    });

    const run = await call(GET, "/api/cron/invoice-review-digest");
    expect(run.status, JSON.stringify(run.body) + api.log()).toBe(200);
    expect(await lastRun("/api/cron/invoice-review-digest")).toEqual({ ok: true, status: 200 });

    const ownerMail = mailTo(await emailOf(on.owner));
    expect(ownerMail, api.log()).toHaveLength(1);
    expect(mailTo(await emailOf(on.admin))).toHaveLength(1);
    expect(mailTo(await emailOf(on.manager))).toHaveLength(0);
    const html = ownerMail[0].html;
    expect(html).toContain("Ken Hicks");
    expect(html).toContain("Nancy Ellestad");
    for (const absent of ["Lori Moeller", "Emma Drebit", "Margaret MacLeod", "Patricia Poohkay"]) expect(html, absent).not.toContain(absent);

    const draftsOnly = mailTo(await emailOf(onlyDrafts.owner));
    expect(draftsOnly).toHaveLength(1);
    expect(draftsOnly[0].html).toContain("Emma Drebit");

    for (const c of [off, quiet]) {
      for (const m of [c.owner, c.admin]) expect(mailTo(await emailOf(m))).toHaveLength(0);
    }
  });
});

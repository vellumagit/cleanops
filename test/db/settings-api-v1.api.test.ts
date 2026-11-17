/**
 * Settings → API keys and Webhooks, and the public API those keys open
 * (/api/v1/invoices and /api/v1/estimates), against a real database behind the
 * real PostgREST and the stand-in file storage. Every key here is made by the
 * owner pressing "Create key"; every webhook by "Add webhook". Outbound HTTP
 * (webhook deliveries, a pdf_url download) is caught by a stand-in fetch that
 * lets only the local stack through.
 *
 * The checks that matter: a key reaches its own company's records and nothing
 * else, a revoked key reaches nothing, ids from another company are refused
 * whether they're the record or a reference on it, a 4xx leaves nothing
 * behind, and integrations hear each event once.
 */
import { createHash, createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));

const keys = await import("@/app/app/settings/api-keys/actions");
const hooks = await import("@/app/app/settings/webhooks/actions");
const invoicesRoute = await import("@/app/api/v1/invoices/route");
const invoiceRoute = await import("@/app/api/v1/invoices/[id]/route");
const estimatesRoute = await import("@/app/api/v1/estimates/route");
const estimateRoute = await import("@/app/api/v1/estimates/[id]/route");

/** Everything the app tried to send off this machine. */
type Outbound = { url: string; body: string; headers: Headers };
const outbound: Outbound[] = [];
const realFetch = globalThis.fetch;
const PDF = Buffer.from("%PDF-1.4\n% a real one\n");
// A public address literal: the SSRF guard passes it without a DNS lookup,
// and the stand-in fetch answers for it.
const HOOK_HOST = "93.184.216.34";

let api: Api;
let restoreEnv: () => void;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const host = new URL(url).hostname;
    if (host === "127.0.0.1" || host === "localhost") return realFetch(input, init);
    outbound.push({ url, body: typeof init?.body === "string" ? init.body : "", headers: new Headers(init?.headers) });
    if (url.endsWith("/estimate.pdf")) return new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } });
    return new Response("ok", { status: 200 });
  });
}, 240_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  outbound.length = 0;
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

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const x of v) f.append(k, x);
    else f.set(k, v);
  }
  return f;
};

async function company(ageDays = 30) {
  const org = await addOrg(api.sql, "Api Co");
  await api.sql(
    `update public.organizations set timezone = 'America/Regina', created_at = now() - make_interval(days => $2) where id = $1`,
    [org, ageDays],
  );
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    olha: await addMember(api.sql, org, "manager", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
}
type Co = Awaited<ReturnType<typeof company>>;

/** The owner presses "Create key"; the raw key is what she copies. */
async function keyFor(c: Co, label = "Zapier"): Promise<string> {
  const res = (await as(c.owner, () => keys.createApiKeyAction(label))) as { rawKey?: string; error?: string };
  expect(res.rawKey, res.error ?? api.log()).toBeTruthy();
  return res.rawKey!;
}

const call = (key: string, path: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (res: Response) => (await res.json()) as { data?: any; error?: string; pagination?: { total: number } }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function invoice(c: Co, client: string, over: Record<string, unknown> = {}) {
  const cols: Record<string, unknown> = { amount_cents: 10000, due_date: "2026-12-15", status: "draft", ...over };
  const ks = Object.keys(cols);
  const [row] = await api.sql<{ id: string }>(
    `insert into public.invoices (organization_id, client_id, ${ks.join(", ")})
     values ($1, $2, ${ks.map((k, i) => (k === "status" ? `$${i + 3}::public.invoice_status` : `$${i + 3}`)).join(", ")}) returning id`,
    [c.org, client, ...Object.values(cols)],
  );
  return row.id;
}
async function estimate(c: Co, client: string, over: Record<string, unknown> = {}) {
  const cols: Record<string, unknown> = { total_cents: 25000, status: "draft", service_description: "Deep clean", ...over };
  const ks = Object.keys(cols);
  const [row] = await api.sql<{ id: string }>(
    `insert into public.estimates (organization_id, client_id, ${ks.join(", ")})
     values ($1, $2, ${ks.map((k, i) => (k === "status" ? `$${i + 3}::public.estimate_status` : `$${i + 3}`)).join(", ")}) returning id`,
    [c.org, client, ...Object.values(cols)],
  );
  return row.id;
}
const invoiceRow = async (id: string) =>
  (await api.sql<{ client_id: string; amount_cents: number; status: string; due_date: string }>(
    "select client_id, amount_cents, status::text as status, due_date::text as due_date from public.invoices where id = $1",
    [id],
  ))[0];
const estimateRow = async (id: string) =>
  (await api.sql<{ client_id: string; total_cents: number; notes: string | null; pdf_url: string | null }>(
    "select client_id, total_cents, notes, pdf_url from public.estimates where id = $1",
    [id],
  ))[0];

async function waitFor<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  let v = await read();
  while (!done(v) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    v = await read();
  }
  return v;
}

describe.skipIf(!hasPostgrest)("Settings → API keys", { timeout: 90_000 }, () => {
  it("the owner makes a key; it's shown once, kept only as a hash, and it works", async () => {
    const c = await company();
    const raw = await keyFor(c, "Website form");
    expect(raw).toMatch(/^sk_live_[0-9a-f]{64}$/);
    const rows = await api.sql<{ id: string; key_hash: string; key_prefix: string; label: string; created_by: string; revoked_at: string | null }>(
      "select id, key_hash, key_prefix, label, created_by, revoked_at from public.api_keys where organization_id = $1",
      [c.org],
    );
    expect(rows).toEqual([
      {
        id: expect.any(String),
        key_hash: createHash("sha256").update(raw).digest("hex"),
        key_prefix: raw.slice(0, 12),
        label: "Website form",
        created_by: c.owner.membershipId,
        revoked_at: null,
      },
    ]);
    const audit = await api.sql<{ action: string; after: Record<string, unknown> }>(
      "select action, after from public.audit_log where organization_id = $1 and entity = 'api_key'",
      [c.org],
    );
    expect(audit).toEqual([{ action: "create", after: { label: "Website form", key_prefix: raw.slice(0, 12) } }]);

    expect((await invoicesRoute.GET(call(raw, "/api/v1/invoices"))).status, api.log()).toBe(200);
    const used = await waitFor(
      () => api.sql<{ at: string | null }>("select last_used_at as at from public.api_keys where id = $1", [rows[0].id]),
      (r) => r[0].at !== null,
    );
    expect(used[0].at, "last used is stamped").not.toBeNull();
  });

  it("only the owner or an admin makes one, a workspace under a week old waits, and the label is checked", async () => {
    const c = await company();
    expect(await as(c.olha, () => keys.createApiKeyAction("Olha's"))).toEqual({ error: "Insufficient permissions" });
    expect(await as(c.anna, () => keys.createApiKeyAction("Anna's"))).toEqual({ error: "Insufficient permissions" });
    expect(await as(c.owner, () => keys.createApiKeyAction("   "))).toEqual({ error: "Label is required" });
    expect(await as(c.owner, () => keys.createApiKeyAction("x".repeat(101)))).toEqual({ error: "Label must be 100 characters or less" });
    const fresh = await company(1);
    const res = (await as(fresh.owner, () => keys.createApiKeyAction("Too soon"))) as { error?: string };
    expect(res.error).toMatch(/^API keys unlock 7 days after a workspace is created/);
    expect(await api.sql("select 1 from public.api_keys where organization_id in ($1, $2)", [c.org, fresh.org])).toEqual([]);
  });

  it("a revoked key stops at once on every route, and revoking twice says so", async () => {
    const c = await company();
    const raw = await keyFor(c);
    const [{ id }] = await api.sql<{ id: string }>("select id from public.api_keys where organization_id = $1", [c.org]);
    const inv = await invoice(c, await addClient(api.sql, c.org, "Revoked Client"));

    expect(await as(c.olha, () => keys.revokeApiKeyAction(id))).toEqual({ error: "Insufficient permissions" });
    expect(await as(c.owner, () => keys.revokeApiKeyAction(id))).toEqual({});
    expect(await as(c.owner, () => keys.revokeApiKeyAction(id))).toEqual({ error: "Key is already revoked" });

    const answers = [
      await invoicesRoute.GET(call(raw, "/api/v1/invoices")),
      await invoiceRoute.GET(call(raw, `/api/v1/invoices/${inv}`), ctx(inv)),
      await invoiceRoute.PATCH(call(raw, `/api/v1/invoices/${inv}`, { method: "PATCH", body: { amount_cents: 1 } }), ctx(inv)),
      await estimatesRoute.GET(call(raw, "/api/v1/estimates")),
      await estimatesRoute.POST(call(raw, "/api/v1/estimates", { method: "POST", body: { client_name: "Nope", total_cents: 1 } })),
    ];
    for (const res of answers) {
      expect(res.status).toBe(401);
      expect((await json(res)).error).toBe("API key has been revoked");
    }
    expect((await invoiceRow(inv)).amount_cents, "nothing changed").toBe(10000);
    expect(await api.sql("select 1 from public.clients where organization_id = $1 and name = 'Nope'", [c.org])).toEqual([]);
  });

  it("another company's key can't be revoked from here", async () => {
    const c = await company();
    const other = await company();
    const theirRaw = await keyFor(other);
    const [{ id }] = await api.sql<{ id: string }>("select id from public.api_keys where organization_id = $1", [other.org]);
    expect(await as(c.owner, () => keys.revokeApiKeyAction(id))).toEqual({ error: "API key not found" });
    expect((await invoicesRoute.GET(call(theirRaw, "/api/v1/invoices"))).status).toBe(200);
  });
});

describe.skipIf(!hasPostgrest)("the public API: invoices", { timeout: 90_000 }, () => {
  it("lists and reads this company's invoices and never another's", async () => {
    const c = await company();
    const other = await company();
    const raw = await keyFor(c);
    const mineClient = await addClient(api.sql, c.org, "Mine Client");
    const theirClient = await addClient(api.sql, other.org, "Their Client");
    const mine = await invoice(c, mineClient);
    const theirs = await invoice(other, theirClient);

    const list = await json(await invoicesRoute.GET(call(raw, "/api/v1/invoices")));
    expect(list.data.map((i: { id: string }) => i.id)).toEqual([mine]);
    expect(list.data[0].client.name).toMatch(/^Mine Client/);
    expect(list.pagination?.total).toBe(1);
    const filtered = await json(await invoicesRoute.GET(call(raw, `/api/v1/invoices?client_id=${theirClient}`)));
    expect(filtered.data).toEqual([]);

    expect((await invoiceRoute.GET(call(raw, `/api/v1/invoices/${mine}`), ctx(mine))).status).toBe(200);
    const res = await invoiceRoute.GET(call(raw, `/api/v1/invoices/${theirs}`), ctx(theirs));
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "Invoice not found" });
  });

  it("makes an invoice for its own client, finds or makes a client by name, and refuses another company's client or job", async () => {
    const c = await company();
    const other = await company();
    const raw = await keyFor(c);
    const client = await addClient(api.sql, c.org, "Post Client");
    const theirClient = await addClient(api.sql, other.org, "Their Post Client");
    const theirJob = await addBooking(api.sql, other.org, theirClient);

    const made = await invoicesRoute.POST(call(raw, "/api/v1/invoices", { method: "POST", body: { client_id: client, amount_cents: 12000, due_date: "2026-12-20" } }));
    expect(made.status, api.log()).toBe(201);
    const { data } = await json(made);
    expect(await invoiceRow(data.id)).toEqual({ client_id: client, amount_cents: 12000, status: "draft", due_date: "2026-12-20" });
    expect(data.number).toMatch(/^INV-/);

    const byName = await json(
      await invoicesRoute.POST(
        call(raw, "/api/v1/invoices", { method: "POST", body: { client_name: "Pat Newcomer", client_email: "pat@example.com", amount_cents: 5000, due_date: "2026-12-20" } }),
      ),
    );
    const [newcomer] = await api.sql<{ organization_id: string; email: string }>("select organization_id, email from public.clients where id = $1", [byName.data.client_id]);
    expect(newcomer).toEqual({ organization_id: c.org, email: "pat@example.com" });

    const foreign = await invoicesRoute.POST(call(raw, "/api/v1/invoices", { method: "POST", body: { client_id: theirClient, amount_cents: 1, due_date: "2026-12-20" } }));
    expect(foreign.status).toBe(400);
    expect((await json(foreign)).error).toBe("Invalid client_id: not found in your organization");
    const foreignJob = await invoicesRoute.POST(
      call(raw, "/api/v1/invoices", { method: "POST", body: { client_id: client, booking_id: theirJob, amount_cents: 1, due_date: "2026-12-20" } }),
    );
    expect(foreignJob.status).toBe(400);
    expect((await json(foreignJob)).error).toBe("Invalid booking_id: not found in your organization");
    expect(await api.sql("select 1 from public.invoices where amount_cents = 1 and organization_id in ($1, $2)", [c.org, other.org])).toEqual([]);
  });

  it("won't bill a job that's already billed", async () => {
    const c = await company();
    const raw = await keyFor(c);
    const client = await addClient(api.sql, c.org, "Billed Client");
    const job = await addBooking(api.sql, c.org, client, { status: "completed", scheduledAt: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    await invoice(c, client, { booking_id: job });
    const res = await invoicesRoute.POST(call(raw, "/api/v1/invoices", { method: "POST", body: { client_id: client, booking_id: job, amount_cents: 9000, due_date: "2026-12-20" } }));
    expect(res.status).toBe(409);
    expect(await api.sql("select 1 from public.invoices where booking_id = $1", [job])).toHaveLength(1);
  });

  it("edits its own invoice, never another company's, and won't point it at another company's client", async () => {
    const c = await company();
    const other = await company();
    const raw = await keyFor(c);
    const client = await addClient(api.sql, c.org, "Patch Client");
    const theirClient = await addClient(api.sql, other.org, "Their Patch Client");
    const mine = await invoice(c, client);
    const theirs = await invoice(other, theirClient);

    const ok = await invoiceRoute.PATCH(call(raw, `/api/v1/invoices/${mine}`, { method: "PATCH", body: { amount_cents: 15000, due_date: "2027-01-05" } }), ctx(mine));
    expect(ok.status, api.log()).toBe(200);
    expect(await invoiceRow(mine)).toMatchObject({ amount_cents: 15000, due_date: "2027-01-05" });

    const moved = await invoiceRoute.PATCH(call(raw, `/api/v1/invoices/${mine}`, { method: "PATCH", body: { client_id: theirClient } }), ctx(mine));
    expect(moved.status).toBe(400);
    expect((await invoiceRow(mine)).client_id).toBe(client);

    await invoiceRoute.PATCH(call(raw, `/api/v1/invoices/${theirs}`, { method: "PATCH", body: { amount_cents: 1, status: "paid" } }), ctx(theirs));
    expect(await invoiceRow(theirs)).toMatchObject({ amount_cents: 10000, status: "draft" });
  });

  it("an edit to an invoice that isn't this company's answers 404, not a server error", async () => {
    const c = await company();
    const other = await company();
    const raw = await keyFor(c);
    const theirs = await invoice(other, await addClient(api.sql, other.org, "Their 404 Client"));
    const res = await invoiceRoute.PATCH(call(raw, `/api/v1/invoices/${theirs}`, { method: "PATCH", body: { amount_cents: 1 } }), ctx(theirs));
    expect(res.status).toBe(404);
  });
});

describe.skipIf(!hasPostgrest)("Settings → Webhooks, heard through the API", { timeout: 90_000 }, () => {
  const delivered = (webhook: string) =>
    api.sql<{ event_type: string; success: boolean; status_code: number | null }>(
      "select event_type, success, status_code from public.webhook_deliveries where webhook_id = $1 order by created_at",
      [webhook],
    );

  it("an active webhook hears invoice.created, signed with its secret; a paused one hears nothing", async () => {
    const c = await company();
    const raw = await keyFor(c);
    await as(c.owner, () =>
      hooks.createWebhookAction(form({ name: "Books", url: `https://${HOOK_HOST}/hooks/books`, events: ["invoice.created", "invoice.paid"] })),
    );
    await as(c.owner, () => hooks.createWebhookAction(form({ name: "Paused", url: `https://${HOOK_HOST}/hooks/paused`, events: ["invoice.created"] })));
    const rows = await api.sql<{ id: string; name: string; secret: string }>("select id, name, secret from public.webhooks where organization_id = $1 order by name", [c.org]);
    const books = rows.find((r) => r.name === "Books")!;
    const paused = rows.find((r) => r.name === "Paused")!;
    await as(c.owner, () => hooks.toggleWebhookAction(form({ id: paused.id, is_active: "false" })));

    const client = await addClient(api.sql, c.org, "Hook Client");
    const made = await invoicesRoute.POST(call(raw, "/api/v1/invoices", { method: "POST", body: { client_id: client, amount_cents: 7000, due_date: "2026-12-20" } }));
    expect(made.status).toBe(201);
    const log = await waitFor(() => delivered(books.id), (d) => d.length > 0);
    expect(log).toEqual([{ event_type: "invoice.created", success: true, status_code: 200 }]);
    const sent = outbound.filter((o) => o.url.includes("/hooks/"));
    expect(sent.map((o) => o.url)).toEqual([`https://${HOOK_HOST}/hooks/books`]);
    const body = JSON.parse(sent[0].body) as { event: string; data: { id: string } };
    expect(body.event).toBe("invoice.created");
    expect(body.data.id).toBe((await json(made)).data.id);
    expect(sent[0].headers.get("x-sollos-signature")).toBe(`sha256=${createHmac("sha256", books.secret).update(sent[0].body).digest("hex")}`);
    expect(await delivered(paused.id)).toEqual([]);
  });

  it("invoice.paid goes out once, when the invoice becomes paid, not again on a later edit", async () => {
    const c = await company();
    const raw = await keyFor(c);
    await as(c.owner, () =>
      hooks.createWebhookAction(form({ name: "Paid hook", url: `https://${HOOK_HOST}/hooks/paid`, events: ["invoice.paid", "invoice.updated"] })),
    );
    const [hook] = await api.sql<{ id: string }>("select id from public.webhooks where organization_id = $1", [c.org]);
    const inv = await invoice(c, await addClient(api.sql, c.org, "Paid Client"), { status: "sent" });

    await invoiceRoute.PATCH(call(raw, `/api/v1/invoices/${inv}`, { method: "PATCH", body: { status: "paid" } }), ctx(inv));
    await waitFor(() => delivered(hook.id), (d) => d.length >= 1);
    await invoiceRoute.PATCH(call(raw, `/api/v1/invoices/${inv}`, { method: "PATCH", body: { due_date: "2027-02-01" } }), ctx(inv));
    const log = await waitFor(() => delivered(hook.id), (d) => d.length >= 2);
    expect(log.map((d) => d.event_type)).toEqual(["invoice.paid", "invoice.updated"]);
  });
});

describe.skipIf(!hasPostgrest)("the public API: estimates", { timeout: 90_000 }, () => {
  it("lists and reads this company's estimates and never another's", async () => {
    const c = await company();
    const other = await company();
    const raw = await keyFor(c);
    const mine = await estimate(c, await addClient(api.sql, c.org, "Est Mine"));
    const theirClient = await addClient(api.sql, other.org, "Est Theirs");
    const theirs = await estimate(other, theirClient);

    const list = await json(await estimatesRoute.GET(call(raw, "/api/v1/estimates")));
    expect(list.data.map((e: { id: string }) => e.id)).toEqual([mine]);
    expect((await json(await estimatesRoute.GET(call(raw, `/api/v1/estimates?client_id=${theirClient}`)))).data).toEqual([]);
    expect((await estimateRoute.GET(call(raw, `/api/v1/estimates/${mine}`), ctx(mine))).status).toBe(200);
    const res = await estimateRoute.GET(call(raw, `/api/v1/estimates/${theirs}`), ctx(theirs));
    expect(res.status).toBe(404);
  });

  it("makes an estimate for its own client, a new name arrives as a lead, and another company's client is refused", async () => {
    const c = await company();
    const other = await company();
    const raw = await keyFor(c);
    const client = await addClient(api.sql, c.org, "Est Post Client");
    const theirClient = await addClient(api.sql, other.org, "Est Their Post");

    const made = await estimatesRoute.POST(call(raw, "/api/v1/estimates", { method: "POST", body: { client_id: client, total_cents: 28950, service_description: "Move-out clean" } }));
    expect(made.status, api.log()).toBe(201);
    const { data } = await json(made);
    expect(await estimateRow(data.id)).toMatchObject({ client_id: client, total_cents: 28950 });

    const inquiry = await json(
      await estimatesRoute.POST(
        call(raw, "/api/v1/estimates", { method: "POST", body: { client_name: "Website Visitor", client_email: "visitor@example.com", total_cents: 9900 } }),
      ),
    );
    const [lead] = await api.sql<{ organization_id: string; lifecycle: string }>("select organization_id, lifecycle from public.clients where id = $1", [inquiry.data.client_id]);
    expect(lead).toEqual({ organization_id: c.org, lifecycle: "lead" });

    const foreign = await estimatesRoute.POST(call(raw, "/api/v1/estimates", { method: "POST", body: { client_id: theirClient, total_cents: 1 } }));
    expect(foreign.status).toBe(400);
    expect(await api.sql("select 1 from public.estimates where client_id = $1", [theirClient])).toEqual([]);
  });

  it("keeps a PDF sent along privately and answers with a link that expires", async () => {
    const c = await company();
    const raw = await keyFor(c);
    const client = await addClient(api.sql, c.org, "Pdf Client");
    const body = new FormData();
    body.set("client_id", client);
    body.set("total_cents", "31000");
    body.set("pdf", new File([PDF], "quote.pdf", { type: "application/pdf" }));
    const res = await estimatesRoute.POST(new NextRequest("http://localhost/api/v1/estimates", { method: "POST", body, headers: { authorization: `Bearer ${raw}` } }));
    expect(res.status, api.log()).toBe(201);
    const { data } = await json(res);
    const key = `estimate-pdfs/${c.org}/estimates/${data.id}.pdf`;
    expect(api.storage.has(key)).toBe(true);
    expect(await estimateRow(data.id)).toMatchObject({ total_cents: 31000, pdf_url: `storage:${key}` });
    expect(data.pdf_url).toContain("token=");

    // pdf_url: fetched from a public address and kept the same way.
    const byUrl = await json(
      await estimatesRoute.POST(call(raw, "/api/v1/estimates", { method: "POST", body: { client_id: client, total_cents: 100, pdf_url: `https://${HOOK_HOST}/estimate.pdf` } })),
    );
    expect(api.storage.has(`estimate-pdfs/${c.org}/estimates/${byUrl.data.id}.pdf`)).toBe(true);
  });

  it("won't fetch a pdf_url that points inside the network", async () => {
    const c = await company();
    const raw = await keyFor(c);
    const client = await addClient(api.sql, c.org, "Ssrf Client");
    for (const url of ["https://169.254.169.254/latest/meta-data", "https://127.0.0.1/x.pdf", "http://files.example.com/x.pdf", "https://[::1]/x.pdf"]) {
      const res = await estimatesRoute.POST(call(raw, "/api/v1/estimates", { method: "POST", body: { client_id: client, total_cents: 100, pdf_url: url } }));
      expect(res.status, url).toBe(400);
      expect((await json(res)).error).toMatch(/^Invalid pdf_url/);
    }
    expect(outbound, "nothing was fetched").toEqual([]);
  });

  it("a PDF that isn't one is refused before the estimate is made, so a retry makes one estimate", async () => {
    const c = await company();
    const raw = await keyFor(c);
    const client = await addClient(api.sql, c.org, "Retry Client");
    const body = new FormData();
    body.set("client_id", client);
    body.set("total_cents", "31000");
    body.set("pdf", new File([Buffer.from("hello, I am a text file")], "quote.pdf", { type: "application/pdf" }));
    const res = await estimatesRoute.POST(new NextRequest("http://localhost/api/v1/estimates", { method: "POST", body, headers: { authorization: `Bearer ${raw}` } }));
    expect(res.status).toBe(400);
    const refusedUrl = await estimatesRoute.POST(
      call(raw, "/api/v1/estimates", { method: "POST", body: { client_id: client, total_cents: 100, pdf_url: "https://169.254.169.254/latest/meta-data" } }),
    );
    expect(refusedUrl.status).toBe(400);
    expect(await api.sql("select 1 from public.estimates where client_id = $1", [client]), "a refused request leaves nothing behind").toHaveLength(0);
  });

  it("edits its own estimate, never another company's, and its client must be its own", async () => {
    const c = await company();
    const other = await company();
    const raw = await keyFor(c);
    const client = await addClient(api.sql, c.org, "Est Patch Client");
    const theirClient = await addClient(api.sql, other.org, "Est Their Patch");
    const mine = await estimate(c, client);
    const theirs = await estimate(other, theirClient);
    const theirKey = `estimate-pdfs/${other.org}/estimates/${theirs}.pdf`;
    api.storage.set(theirKey, 100);
    await api.sql("update public.estimates set pdf_url = $2 where id = $1", [theirs, `storage:${theirKey}`]);

    const ok = await estimateRoute.PATCH(call(raw, `/api/v1/estimates/${mine}`, { method: "PATCH", body: { total_cents: 30000, notes: "Includes oven" } }), ctx(mine));
    expect(ok.status, api.log()).toBe(200);
    expect(await estimateRow(mine)).toMatchObject({ total_cents: 30000, notes: "Includes oven" });

    const moved = await estimateRoute.PATCH(call(raw, `/api/v1/estimates/${mine}`, { method: "PATCH", body: { client_id: theirClient } }), ctx(mine));
    expect(moved.status).toBe(400);
    expect((await estimateRow(mine)).client_id).toBe(client);

    await estimateRoute.PATCH(call(raw, `/api/v1/estimates/${theirs}`, { method: "PATCH", body: { notes: "hijacked", total_cents: 1 } }), ctx(theirs));
    const dropPdf = await estimateRoute.PATCH(call(raw, `/api/v1/estimates/${theirs}`, { method: "PATCH", body: { pdf_url: null } }), ctx(theirs));
    expect(dropPdf.status).toBe(404);
    expect(await estimateRow(theirs)).toMatchObject({ notes: null, total_cents: 25000, pdf_url: `storage:${theirKey}` });
    expect(api.storage.has(theirKey), "their PDF is still there").toBe(true);
  });

  it("a visitor whose email only looks like an existing client's gets a lead of their own", async () => {
    const c = await company();
    const raw = await keyFor(c);
    const margaret = await addClient(api.sql, c.org, "Margaret Underwood");
    await api.sql("update public.clients set email = 'm.underwood@example.com' where id = $1", [margaret]);
    const res = await json(
      await estimatesRoute.POST(
        call(raw, "/api/v1/estimates", { method: "POST", body: { client_name: "Mia Unger", client_email: "m_underwood@example.com", total_cents: 9900 } }),
      ),
    );
    expect(res.data.client_id, "the estimate isn't filed under Margaret").not.toBe(margaret);
  });

  it("a visitor who shares a name with a client but has a different email is a person of their own; the same name with no email on file is the same person", async () => {
    const c = await company();
    const raw = await keyFor(c);
    const ask = async (name: string, email: string, phone?: string) =>
      (
        await json(
          await estimatesRoute.POST(
            call(raw, "/api/v1/estimates", { method: "POST", body: { client_name: name, client_email: email, client_phone: phone, total_cents: 9900 } }),
          ),
        )
      ).data.client_id as string;
    const row = async (id: string) => (await api.sql<{ email: string | null; lifecycle: string }>("select email, lifecycle::text as lifecycle from public.clients where id = $1", [id]))[0];

    // An existing client with an email of her own.
    const john = await addClient(api.sql, c.org, "John Smith");
    await api.sql("update public.clients set name = 'John Smith', email = 'john@first.example.com' where id = $1", [john]);
    const other = await ask("John Smith", "john@second.example.com");
    expect(other, "a second John Smith, not the first").not.toBe(john);
    expect(await row(other)).toMatchObject({ email: "john@second.example.com", lifecycle: "lead" });
    expect((await row(john)).email).toBe("john@first.example.com");
    // Asking again with the same email finds the second one, and makes no third.
    expect(await ask("John Smith", "john@second.example.com")).toBe(other);

    // A client on file with no email: the same name is taken as the same person, and the email is kept.
    const anna = await addClient(api.sql, c.org, "Anna Kowalski");
    await api.sql("update public.clients set name = 'Anna Kowalski', email = null where id = $1", [anna]);
    expect(await ask("Anna Kowalski", "anna@example.com")).toBe(anna);
    expect((await row(anna)).email).toBe("anna@example.com");
  });

  it("a malformed id answers 404 rather than crashing the route", async () => {
    const c = await company();
    const raw = await keyFor(c);
    const res = await estimateRoute.GET(call(raw, "/api/v1/estimates/not-a-uuid"), ctx("not-a-uuid")).catch((e: unknown) => e);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(404);
  });

  it("an edit to an estimate that isn't this company's answers 404, not a server error", async () => {
    const c = await company();
    const other = await company();
    const raw = await keyFor(c);
    const theirs = await estimate(other, await addClient(api.sql, other.org, "Est 404"));
    const res = await estimateRoute.PATCH(call(raw, `/api/v1/estimates/${theirs}`, { method: "PATCH", body: { notes: "x" } }), ctx(theirs));
    expect(res.status).toBe(404);
  });
});

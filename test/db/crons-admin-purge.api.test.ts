/**
 * Deleting and closing workspaces, through the real routes against a real
 * database behind the real PostgREST.
 *
 *   cron/purge-orgs     nightly: purge every org whose 30-day grace is over
 *   admin/purge-org     support: purge exactly one named, already-closed org
 *   admin/suspend-org   the abuse tripwire's signed one-click suspend / undo
 *
 * The stack's stand-in storage has no folder listing and GoTrue's stand-in
 * has no user delete; both are answered here, inside this file, the way
 * Supabase answers them, so the purge's storage sweep and right-to-erasure
 * step run for real against the stand-ins' state.
 */
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addMember, addOrg, type Member } from "./harness";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));
const outbox = vi.hoisted(() => ({ mail: [] as string[], external: [] as string[] }));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: { to: string[] }) => {
        outbox.mail.push(String(payload.to[0]));
        return { data: { id: "msg" }, error: null };
      },
    };
  },
}));

const SECRET = "crons-admin-purge-secret-0123456789";
const SITE = "https://sollos.example.test";
let api: Api;
let restoreEnv: () => void;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  for (const k of ["CRON_SECRET", "RESEND_API_KEY", "NEXT_PUBLIC_SITE_URL"]) saved[k] = process.env[k];
  process.env.CRON_SECRET = SECRET;
  process.env.RESEND_API_KEY = "re_test_not_a_real_key";
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (!local) {
      outbox.external.push(`${method} ${url.origin}${url.pathname}`);
      return new Response("not here (test stub)", { status: 404 });
    }
    // Storage folder listing, as Supabase answers it: one level, folders with id null.
    const list = /^\/storage\/v1\/object\/list\/([^/]+)$/.exec(url.pathname);
    if (list && method === "POST") {
      const bucket = decodeURIComponent(list[1]);
      const body = JSON.parse(String(init?.body ?? "{}")) as { prefix?: string; limit?: number; offset?: number };
      const prefix = (body.prefix ?? "").replace(/\/$/, "");
      const under = `${bucket}/${prefix ? `${prefix}/` : ""}`;
      const names = new Map<string, boolean>(); // name -> isFolder
      for (const key of api.storage.keys()) {
        if (!key.startsWith(under)) continue;
        const rest = key.slice(under.length);
        const slash = rest.indexOf("/");
        if (slash === -1) names.set(rest, false);
        else names.set(rest.slice(0, slash), true);
      }
      const entries = [...names.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(body.offset ?? 0, (body.offset ?? 0) + (body.limit ?? 100))
        .map(([name, folder]) => ({ name, id: folder ? null : `id-${name}`, metadata: folder ? null : { size: 1 } }));
      return Response.json(entries);
    }
    // GoTrue's admin user delete (service key only), as the purge's erasure step calls it.
    const del = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (del && method === "DELETE") {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth !== `Bearer ${api.serviceKey}`) return Response.json({ msg: "service key required" }, { status: 401 });
      const gone = await api.sql("delete from auth.users where id = $1 returning id", [del[1]]);
      return gone.length ? Response.json({}) : Response.json({ msg: "User not found" }, { status: 404 });
    }
    // webhook_subscriptions was dropped by 20260421020000_webhooks_unification
    // but is still on the purge's table list, which fails every purge (its own
    // it.fails below). Every other test here answers for the missing table as
    // PostgREST would for an empty one, so each can show its own behaviour.
    if (standIn.droppedWebhookTable && url.pathname === "/rest/v1/webhook_subscriptions") {
      return method === "DELETE"
        ? new Response(null, { status: 204, headers: { "content-range": "*/0" } })
        : Response.json([], { headers: { "content-range": "*/0" } });
    }
    return realFetch(input, init);
  });
}, 240_000);

const standIn = { droppedWebhookTable: true };

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
  outbox.external.length = 0;
});

type Handler = (req: NextRequest) => Promise<Response>;
async function call(handler: Handler, path: string, opts: { auth?: string | null; method?: string } = {}) {
  const auth = opts.auth === undefined ? `Bearer ${SECRET}` : opts.auth;
  const res = await handler(
    new NextRequest(`${SITE}${path}`, { method: opts.method ?? "GET", headers: auth ? { authorization: auth } : {} }),
  );
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // HTML or plain text
  }
  return { status: res.status, body: body as Record<string, unknown>, text };
}

const DAY = 86_400_000;
type Workspace = { org: string; name: string; owner: Member; client: string; booking: string; invoice: string; files: string[] };

/** A workspace with the rows and files a real one has. */
async function workspace(label: string, state: { scheduledDaysAgo?: number; suspended?: boolean; deletedDaysAgo?: number } = {}): Promise<Workspace> {
  const org = await addOrg(api.sql, label);
  const [{ name }] = await api.sql<{ name: string }>(
    `update public.organizations
        set deletion_scheduled_at = $2, suspended_at = $3, deleted_at = $4
      where id = $1 returning name`,
    [
      org,
      state.scheduledDaysAgo === undefined ? null : new Date(Date.now() - state.scheduledDaysAgo * DAY).toISOString(),
      state.suspended ? new Date().toISOString() : null,
      state.deletedDaysAgo === undefined ? null : new Date(Date.now() - state.deletedDaysAgo * DAY).toISOString(),
    ],
  );
  const owner = await addMember(api.sql, org, "owner", "Owner");
  const client = await addClient(api.sql, org, "Hilda Daubner");
  await api.sql("update public.clients set email = $2 where id = $1", [client, `hilda-${org.slice(0, 6)}@example.com`]);
  const booking = await addBooking(api.sql, org, client);
  const [{ id: invoice }] = await api.sql<{ id: string }>(
    "insert into public.invoices (organization_id, client_id, status, amount_cents, due_date) values ($1, $2, 'sent', 14000, current_date) returning id",
    [org, client],
  );
  await api.sql(
    "insert into public.notifications (organization_id, recipient_membership_id, type, title, body, href, min_role) values ($1, $2, 'general', 'Hello', 'Body', '/app', 'employee')",
    [org, owner.membershipId],
  );
  await api.sql(
    "insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, after) values ($1, $2, 'create', 'client', $3, $4::jsonb)",
    [org, owner.membershipId, client, JSON.stringify({ name: "Hilda Daubner", email: "hilda@example.com" })],
  );
  const files = [`org-assets/${org}/logo.png`, `job-photos/${org}/${booking}/before.jpg`, `job-photos/${org}/${booking}/after.jpg`];
  for (const f of files) api.storage.set(f, 10);
  return { org, name, owner, client, booking, invoice, files };
}

const counts = async (org: string) =>
  (
    await api.sql<Record<string, number>>(
      `select (select count(*)::int from public.clients where organization_id = $1) as clients,
              (select count(*)::int from public.bookings where organization_id = $1) as bookings,
              (select count(*)::int from public.invoices where organization_id = $1) as invoices,
              (select count(*)::int from public.memberships where organization_id = $1) as memberships,
              (select count(*)::int from public.notifications where organization_id = $1) as notifications,
              (select count(*)::int from public.audit_log where organization_id = $1) as audit_log`,
      [org],
    )
  )[0];
const orgRow = async (org: string) =>
  (await api.sql<{ name: string; deleted: boolean }>("select name, deleted_at is not null as deleted from public.organizations where id = $1", [org]))[0];
const userExists = async (userId: string) => (await api.sql("select 1 from auth.users where id = $1", [userId])).length === 1;
const intact = async (w: Workspace, memberships = 1) => {
  expect(await counts(w.org), w.name).toEqual({ clients: 1, bookings: 1, invoices: 1, memberships, notifications: 1, audit_log: 1 });
  expect((await orgRow(w.org)).name).toBe(w.name);
  for (const f of w.files) expect(api.storage.has(f), f).toBe(true);
  expect(await userExists(w.owner.userId)).toBe(true);
};

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("purge-orgs: only orgs past their 30-day grace are erased", { timeout: 180_000 }, () => {
  it("refuses without the cron secret", async () => {
    const { GET } = await import("@/app/api/cron/purge-orgs/route");
    const w = await workspace("Refused Purge", { scheduledDaysAgo: 40 });
    for (const auth of [null, "Bearer wrong-wrong-wrong-wrong-00", SECRET]) {
      expect((await call(GET as Handler, "/api/cron/purge-orgs", { auth })).status).toBe(401);
    }
    await intact(w);
    // Tidy: this one is not meant to be in the next test's sweep.
    await api.sql("update public.organizations set deletion_scheduled_at = null where id = $1", [w.org]);
  });

  // FIX-LATER: purgeOrgData's DELETE_ORDER names webhook_subscriptions, a table 20260421020000_webhooks_unification dropped; every purge errors on it and stops before the tombstone and login erasure
  it.fails("a purge against the schema the migrations build finishes without errors and tombstones the org", async () => {
    const { GET } = await import("@/app/api/cron/purge-orgs/route");
    const due = await workspace("Plain Purge", { scheduledDaysAgo: 31 });
    standIn.droppedWebhookTable = false;
    try {
      const run = await call(GET as Handler, "/api/cron/purge-orgs");
      expect(run.status).toBe(200);
      const result = (run.body.results as Record<string, { errors: string[] }>)[due.org];
      expect(result.errors).toEqual([]);
      expect(await orgRow(due.org)).toEqual({ name: "[deleted]", deleted: true });
      expect(await userExists(due.owner.userId)).toBe(false);
    } finally {
      standIn.droppedWebhookTable = true;
      await api.sql("update public.organizations set deletion_scheduled_at = null where id = $1 and deleted_at is null", [due.org]);
    }
  });

  it("erases the due org's rows, files and only-here logins, tombstones it, and touches nothing else", async () => {
    const { GET } = await import("@/app/api/cron/purge-orgs/route");
    const due = await workspace("Due For Purge", { scheduledDaysAgo: 31 });
    const grace = await workspace("Still In Grace", { scheduledDaysAgo: 10 });
    const live = await workspace("Live Workspace");
    const tomb = await workspace("Already Tombstoned", { scheduledDaysAgo: 60, deletedDaysAgo: 20 });
    // Someone who works for both the due org and the live one keeps their login.
    const shared = await addMember(api.sql, live.org, "employee", "Shared Cleaner");
    await api.sql(
      "insert into public.memberships (organization_id, profile_id, role, status) values ($1, $2, 'employee', 'active')",
      [due.org, shared.userId],
    );

    const run = await call(GET as Handler, "/api/cron/purge-orgs");
    expect(run.status, JSON.stringify(run.body) + api.log()).toBe(200);
    expect(run.body.purgedOrgIds).toEqual([due.org]);
    const result = (run.body.results as Record<string, { errors: string[]; authUsersDeleted: number; storageFilesRemoved: number }>)[due.org];
    expect(result.errors).toEqual([]);

    expect(await counts(due.org)).toEqual({ clients: 0, bookings: 0, invoices: 0, memberships: 0, notifications: 0, audit_log: 0 });
    expect(await orgRow(due.org)).toEqual({ name: "[deleted]", deleted: true });
    for (const f of due.files) expect(api.storage.has(f), f).toBe(false);
    expect(result.storageFilesRemoved).toBe(3);
    expect(await userExists(due.owner.userId)).toBe(false);
    expect(await userExists(shared.userId)).toBe(true);
    expect(result.authUsersDeleted).toBe(1);

    await intact(grace);
    await intact(live, 2); // its own owner and the shared cleaner
    expect(await counts(tomb.org)).toMatchObject({ clients: 1, bookings: 1 });
    expect((await orgRow(tomb.org)).name).toBe(tomb.name);
    expect(outbox.external, outbox.external.join("\n")).toEqual([]);

    // Tomorrow it is not purged again.
    const again = await call(GET as Handler, "/api/cron/purge-orgs");
    expect(again.body.purgedOrgIds).toEqual([]);
  });

  // FIX-LATER: purgeOrgData deletes only its hard-coded table list and keeps the org row, so tables left off it (job_applicants, sms_messages, booking_prepayments, ai_conversations, api_keys, ...) keep the org's data forever
  it.fails("leaves none of the org's personal data behind: job applicants, text messages, prepayments", async () => {
    const { GET } = await import("@/app/api/cron/purge-orgs/route");
    const due = await workspace("Purge Leftovers", { scheduledDaysAgo: 31 });
    await api.sql(
      "insert into public.job_applicants (organization_id, name, email, phone, resume_url) values ($1, 'Olga Applicant', 'olga@example.com', '+13065550199', 'resumes/olga.pdf')",
      [due.org],
    );
    await api.sql(
      "insert into public.sms_messages (organization_id, to_number, body, client_id) values ($1, '+13065550123', 'Hi Hilda, your clean is tomorrow at 9', $2)",
      [due.org, due.client],
    );
    await api.sql(
      "insert into public.booking_prepayments (organization_id, booking_id, client_id, amount_cents, method, received_at) values ($1, $2, $3, 5000, 'cash', now())",
      [due.org, due.booking, due.client],
    );
    expect((await call(GET as Handler, "/api/cron/purge-orgs")).status).toBe(200);
    expect((await orgRow(due.org)).deleted).toBe(true);
    const left = await api.sql<{ t: string; n: number }>(
      `select 'job_applicants' as t, count(*)::int as n from public.job_applicants where organization_id = $1
       union all select 'sms_messages', count(*)::int from public.sms_messages where organization_id = $1
       union all select 'booking_prepayments', count(*)::int from public.booking_prepayments where organization_id = $1`,
      [due.org],
    );
    expect(left.filter((r) => r.n > 0)).toEqual([]);
  });

  // FIX-LATER: purgeExpiredOrgs returns every due org in purgedOrgIds, including ones whose purge failed and were left unmarked
  it.fails("an org whose purge failed is not reported as purged", async () => {
    const { GET } = await import("@/app/api/cron/purge-orgs/route");
    const stuck = await workspace("Stuck Purge", { scheduledDaysAgo: 31 });
    // A table that refuses the delete for this org, as a real failure would.
    await api.db.exec(`
      create or replace function public.test_refuse_client_delete() returns trigger language plpgsql as $$
      begin raise exception 'test: clients delete refused'; end $$;
      create trigger test_refuse_client_delete before delete on public.clients
        for each row when (old.organization_id = '${stuck.org}') execute function public.test_refuse_client_delete();
    `);
    try {
      const run = await call(GET as Handler, "/api/cron/purge-orgs");
      expect(run.status).toBe(200);
      // The purge itself behaves: it stops before the tombstone.
      expect((await orgRow(stuck.org)).deleted).toBe(false);
      expect((run.body.results as Record<string, { errors: string[] }>)[stuck.org].errors.join()).toContain("clients");
      // ...but the run reports it purged.
      expect(run.body.purgedOrgIds).not.toContain(stuck.org);
    } finally {
      await api.db.exec(`
        drop trigger if exists test_refuse_client_delete on public.clients;
        drop function if exists public.test_refuse_client_delete();
        update public.organizations set deletion_scheduled_at = null where id = '${stuck.org}';
      `);
    }
  });
});

describe.skipIf(!hasPostgrest)("purge-orgs: a table too big for one delete statement", { timeout: 180_000 }, () => {
  // FIX-LATER: deleteAllFor's statement-timeout fallback (57014 -> delete in batches) is dead inside a cron: the fail-closed guard rejects the await before deleteAllFor can read the error
  it.fails("falls back to batched deletes when the one-statement delete times out, and finishes the purge", async () => {
    const { GET } = await import("@/app/api/cron/purge-orgs/route");
    const big = await workspace("Big Purge", { scheduledDaysAgo: 31 });
    // The first delete statement on this org's clients is cancelled the way
    // statement_timeout cancels it; the batches after it go through. (A
    // sequence, because it is not rolled back with the cancelled statement.)
    await api.db.exec(`
      create sequence if not exists public.test_timeout_once;
      create or replace function public.test_timeout_first_delete() returns trigger language plpgsql as $$
      begin
        if nextval('public.test_timeout_once') = 1 then
          raise exception 'canceling statement due to statement timeout' using errcode = '57014';
        end if;
        return old;
      end $$;
      create trigger test_timeout_first_delete before delete on public.clients
        for each row when (old.organization_id = '${big.org}') execute function public.test_timeout_first_delete();
    `);
    try {
      const run = await call(GET as Handler, "/api/cron/purge-orgs");
      expect(run.status).toBe(200);
      const result = (run.body.results as Record<string, { errors: string[] }>)[big.org];
      expect(result.errors).toEqual([]);
      expect(await counts(big.org)).toMatchObject({ clients: 0 });
      expect((await orgRow(big.org)).deleted).toBe(true);
    } finally {
      await api.db.exec(`
        drop trigger if exists test_timeout_first_delete on public.clients;
        drop function if exists public.test_timeout_first_delete();
        drop sequence if exists public.test_timeout_once;
        update public.organizations set deletion_scheduled_at = null where id = '${big.org}' and deleted_at is null;
      `);
    }
  });
});

describe.skipIf(!hasPostgrest)("admin/purge-org: support purges exactly the one closed org it names", { timeout: 180_000 }, () => {
  it("refuses strangers, unknown and live orgs; dry-runs; purges only the named org; is a no-op the second time", async () => {
    const { GET } = await import("@/app/api/admin/purge-org/route");
    const spam = await workspace("Spam Workspace", { suspended: true });
    const live = await workspace("Real Client Co");
    const queued = await workspace("Queued Elsewhere", { scheduledDaysAgo: 45 });

    for (const auth of [null, "Bearer wrong-wrong-wrong-wrong-00"]) {
      expect((await call(GET as Handler, `/api/admin/purge-org?org_id=${spam.org}`, { auth })).status).toBe(401);
    }
    expect((await call(GET as Handler, "/api/admin/purge-org")).status).toBe(400);
    expect((await call(GET as Handler, "/api/admin/purge-org?org_id=00000000-0000-4000-8000-000000000000")).status).toBe(404);
    const refused = await call(GET as Handler, `/api/admin/purge-org?org_id=${live.org}`);
    expect(refused.status).toBe(409);
    await intact(live);

    const dry = await call(GET as Handler, `/api/admin/purge-org?org_id=${spam.org}&dry_run=1`);
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body).toMatchObject({ ok: true, dry_run: true, org_id: spam.org });
    expect(dry.body.would_delete).toMatchObject({ clients: 1, bookings: 1, invoices: 1, memberships: 1, audit_log: 1 });
    await intact(spam);

    const real = await call(GET as Handler, `/api/admin/purge-org?org_id=${spam.org}`);
    expect(real.status, JSON.stringify(real.body) + api.log()).toBe(200);
    expect(real.body).toMatchObject({ ok: true, dry_run: false, org_id: spam.org, errors: [] });
    expect(await counts(spam.org)).toEqual({ clients: 0, bookings: 0, invoices: 0, memberships: 0, notifications: 0, audit_log: 0 });
    expect(await orgRow(spam.org)).toEqual({ name: "[deleted]", deleted: true });
    for (const f of spam.files) expect(api.storage.has(f)).toBe(false);
    // Not the org queued for the nightly purge, not the live one.
    await intact(queued);
    await intact(live);

    const again = await call(GET as Handler, `/api/admin/purge-org?org_id=${spam.org}`);
    expect(again.status).toBe(200);
    expect(again.body.already_purged_at).toBeTruthy();
  });
});

describe.skipIf(!hasPostgrest)("admin/suspend-org: the signed one-click link from the tripwire email", { timeout: 120_000 }, () => {
  it("only a valid, unexpired link for that org and action works; GET only shows a button; POST suspends and undoes", async () => {
    const route = await import("@/app/api/admin/suspend-org/route");
    const { suspendLinks } = await import("@/lib/abuse-guard");
    const org = await addOrg(api.sql, "<img src=x onerror=alert(1)> Spam");
    const bystander = await addOrg(api.sql, "Bystander");
    const owner = await addMember(api.sql, org, "owner");
    await api.sql(
      "insert into public.api_keys (organization_id, key_hash, key_prefix, label, created_by) values ($1, 'hash-1', 'sk_1', 'Zapier', $2), ($3, 'hash-2', 'sk_2', 'Other', null)",
      [org, owner.membershipId, bystander],
    );
    const { suspendUrl, unsuspendUrl } = suspendLinks(org);
    expect(suspendUrl).toMatch(new RegExp(`^${SITE}/api/admin/suspend-org\\?`));
    const q = (u: string) => new URL(u).search;
    const sus = q(suspendUrl!);
    const undo = q(unsuspendUrl!);
    const state = async (id: string) =>
      (await api.sql<{ suspended: boolean; reason: string | null }>("select suspended_at is not null as suspended, suspend_reason as reason from public.organizations where id = $1", [id]))[0];
    const GET = route.GET as Handler;
    const POST = route.POST as Handler;

    // Forged, swapped, expired, other-org and malformed links are all "Not found".
    const p = new URLSearchParams(sus.slice(1));
    const forged = new URLSearchParams(p);
    forged.set("sig", "0".repeat(64));
    const swapped = new URLSearchParams(p);
    swapped.set("action", "undo");
    const otherOrg = new URLSearchParams(p);
    otherOrg.set("org", bystander);
    const expiredExp = Math.floor((Date.now() - 60_000) / 1000);
    const expired = new URLSearchParams({
      org,
      action: "suspend",
      exp: String(expiredExp),
      sig: createHmac("sha256", SECRET).update(`suspend:${org}:suspend:${expiredExp}`).digest("hex"),
    });
    for (const bad of [forged, swapped, otherOrg, expired, new URLSearchParams({ org: "nope", action: "suspend", exp: "1", sig: "x" })]) {
      for (const handler of [GET, POST]) {
        const res = await call(handler, `/api/admin/suspend-org?${bad}`, { auth: null, method: handler === POST ? "POST" : "GET" });
        expect(res.status, bad.toString()).toBe(404);
      }
    }
    expect(await state(org)).toEqual({ suspended: false, reason: null });

    // GET (what a link scanner does) shows a page and changes nothing. The name is escaped.
    const page = await call(GET, `/api/admin/suspend-org${sus}`, { auth: null });
    expect(page.status).toBe(200);
    expect(page.text).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(page.text).not.toContain("<img src=x");
    expect(page.text).toContain('method="post"');
    expect(await state(org)).toEqual({ suspended: false, reason: null });

    // POST suspends this org and revokes its API keys, nobody else's.
    const done = await call(POST, `/api/admin/suspend-org${sus}`, { auth: null, method: "POST" });
    expect(done.status).toBe(200);
    expect(done.text).toContain("Suspended");
    expect((await state(org)).suspended).toBe(true);
    expect((await state(org)).reason).toMatch(/tripwire/);
    expect(await state(bystander)).toEqual({ suspended: false, reason: null });
    const keys = await api.sql<{ organization_id: string; revoked: boolean }>(
      "select organization_id, revoked_at is not null as revoked from public.api_keys where key_hash in ('hash-1', 'hash-2') order by key_hash",
    );
    expect(keys).toEqual([
      { organization_id: org, revoked: true },
      { organization_id: bystander, revoked: false },
    ]);

    // The undo link lifts it; the suspend link cannot be replayed as the undo.
    const lifted = await call(POST, `/api/admin/suspend-org${undo}`, { auth: null, method: "POST" });
    expect(lifted.status).toBe(200);
    expect(await state(org)).toEqual({ suspended: false, reason: null });
  });
});

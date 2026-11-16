/**
 * Every page and every scheduled job, at about twice Svit's size, watched
 * for a read the API cut off at 1,000 rows.
 *
 * The API (PostgREST, max-rows 1000 like production) stops a list at 1,000
 * rows and says nothing: the screen shows the first 1,000 as if they were
 * all, a total adds up the first 1,000, a cron acts on the first 1,000.
 * Svit was already past 1,000 rows in four tables on 2026-11-16 (checklist
 * items 25,131; audit log 1,682; notifications 1,464; crew rows 1,063) and
 * at 983 bookings. pages.load.test.ts checks sixteen main pages with many
 * jobs a week; this one checks reads that grow with a company's whole
 * history, on all the pages and crons.
 *
 * The company: 30 cleaners, 200 clients, about 1,900 jobs over sixteen
 * months (a busy cleaner on a quarter of them, a commercial client on a
 * quarter), 25 checklist items on each (about 48,000), crews, a shift for
 * every finished job, an invoice and a payment for most, 3,000
 * notifications, 3,500 audit rows, 1,500 checklist template items. Jobs a
 * week stay near Svit's, so a read bounded to a week or a month is not
 * cut; a read of everything is.
 *
 * Each page is fetched as the person who would open it (server rendering;
 * reads a page makes later from the browser are not seen). Each cron is
 * called as Vercel calls it. Every database call is counted at the API's
 * door (api.traffic).
 */
import type { ChildProcess } from "node:child_process";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasPostgrest, startApi, type Api, type Traffic } from "../db/api";
import { spawnApp } from "../db/app-process";
import { addMember, addOrg, type Member } from "../db/harness";
import { hasRealPostgres } from "../db/real-postgres";

const CLEANERS = 30;
const CLIENTS = 200;
const DAYS_BACK = 420;
const DAYS_AHEAD = 60;
const CRON_SECRET = "test-cron-secret-not-real-0123456789";
const REPORT = process.env.CUTOFF_REPORT ?? join(fileURLToPath(new URL("../..", import.meta.url)), "node_modules", ".cache", "cutoff-report.json");

const ready = hasPostgrest && hasRealPostgres;
let api: Api;
let app: ChildProcess | null = null;
let base = "";
let appLog = "";
let org = "";
let owner: Member;
let busy: Member;
let portalUser = "";
const ids: Record<string, string> = {};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function seed(): Promise<void> {
  org = await addOrg(api.sql, "Big Svit");
  await api.sql(
    `update public.organizations set timezone = 'America/Regina', onboarding_completed_at = now(), automations_enabled = true,
            booking_auto_complete_hours = 2, invoice_auto_send_enabled = true where id = $1`,
    [org],
  );
  owner = await addMember(api.sql, org, "owner", "Big Owner");
  const crew: Member[] = [];
  for (let i = 0; i < CLEANERS; i++) crew.push(await addMember(api.sql, org, "employee", `Big Cleaner ${i + 1}`));
  busy = crew[0];
  await api.sql("update public.memberships set pay_rate_cents = 2200 where id = any($1::uuid[])", [crew.map((m) => m.membershipId)]);

  const db = await api.real!.pool.connect();
  try {
    await db.query("begin");
    await db.query("set local sollos.schedule_check = 'batch'");
    const { rows: [service] } = await db.query<{ id: string }>(
      `insert into public.service_types (organization_id, name, default_duration_minutes, default_price_cents, sort_order)
       values ($1, 'Standard clean', 120, 14000, 1) returning id`,
      [org],
    );
    const { rows: clients } = await db.query<{ id: string }>(
      `insert into public.clients (organization_id, name, address, email)
       select $1, 'Big Client ' || g, g || ' Test Street', 'big-client-' || g || '@example.test' from generate_series(1, $2::int) g returning id`,
      [org, CLIENTS],
    );
    ids.bigClient = clients[0].id;
    // 100 weekly series, one per client of the first hundred.
    const { rows: series } = await db.query<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes, total_cents, service_type_id)
       select $1, ($2::uuid[])[g], 'weekly', '08:00', current_date - $3::int, 120, 14000, $4 from generate_series(1, 100) g returning id`,
      [org, clients.map((c) => c.id), DAYS_BACK, service.id],
    );
    ids.series = series[0].id;
    // Four jobs a day, one per slot, so no cleaner is ever booked twice.
    // Slot 0 is always the busy cleaner; a quarter of all jobs are the big
    // client's (a commercial account); every tenth job has a second cleaner.
    await db.query(
      `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, service_type_id, service_type_label,
                                    status, total_cents, assigned_to, address, series_id)
       select $1,
              case when s = 1 then ($3::uuid[])[1] else ($3::uuid[])[1 + ((d + $5) * 4 + s) % $4::int] end,
              date_trunc('day', now()) + make_interval(days => d, hours => 8 + 3 * s),
              120, 'standard', $6, 'Standard clean',
              (case when date_trunc('day', now()) + make_interval(days => d, hours => 10 + 3 * s) >= now() then 'confirmed'
                    when ((d + $5) * 4 + s) % 50 = 0 then 'cancelled'
                    else 'completed' end)::public.booking_status,
              14000,
              ($2::uuid[])[case when s = 0 then 1 else 2 + ((d + $5) * 3 + s) % ($7::int - 1) end],
              'Somewhere',
              case when ((d + $5) * 4 + s) % 5 = 0 then ($8::uuid[])[1 + ((d + $5) * 4 + s) % 100] else null end
         from generate_series(-$5::int, $9::int - 1) d, generate_series(0, 3) s`,
      [org, crew.map((m) => m.membershipId), clients.map((c) => c.id), CLIENTS, DAYS_BACK, service.id, CLEANERS, series.map((s) => s.id), DAYS_AHEAD],
    );
    await db.query(
      `insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status)
       select organization_id, id, assigned_to, true, 'accepted' from public.bookings where organization_id = $1`,
      [org],
    );
    await db.query(
      `insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status)
       select b.organization_id, b.id, m.id, false, 'accepted'
         from (select *, row_number() over (order by scheduled_at) n from public.bookings where organization_id = $1) b
         join public.memberships m on m.organization_id = b.organization_id and m.role = 'employee' and m.id <> b.assigned_to
        where b.n % 10 = 0 and m.id = ($2::uuid[])[2 + (b.n / 10)::int % ($3::int - 1)]`,
      [org, crew.map((m) => m.membershipId), CLEANERS],
    );
    // Checklists: 60 templates of 25 items; 25 items on every job.
    await db.query(
      `with t as (insert into public.checklist_templates (organization_id, name) select $1, 'Template ' || g from generate_series(1, 60) g returning id)
       insert into public.checklist_template_items (template_id, organization_id, ordinal, title)
       select t.id, $1, i, 'Step ' || i from t, generate_series(1, 25) i`,
      [org],
    );
    await db.query(
      `insert into public.booking_checklist_items (organization_id, booking_id, ordinal, title, checked_at)
       select b.organization_id, b.id, i, 'Step ' || i, case when b.status = 'completed' then b.scheduled_at + interval '1 hour' end
         from public.bookings b, generate_series(1, 25) i where b.organization_id = $1`,
      [org],
    );
    // A shift for every finished job, for each person on it.
    await db.query(
      `insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, engagement_snapshot)
       select b.organization_id, a.membership_id, b.id, b.scheduled_at, b.scheduled_at + interval '2 hours', 2200, 'employee'
         from public.bookings b join public.booking_assignees a on a.booking_id = b.id
        where b.organization_id = $1 and b.status = 'completed'`,
      [org],
    );
    // An invoice for every finished job older than a week; the older ones paid.
    await db.query(
      `insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents, sent_at, due_date)
       select organization_id, client_id, id, 'sent', 14700, scheduled_at + interval '1 day', (scheduled_at + interval '15 days')::date
         from public.bookings where organization_id = $1 and status = 'completed' and scheduled_at < now() - interval '7 days'`,
      [org],
    );
    await db.query(
      `insert into public.invoice_line_items (organization_id, invoice_id, label, quantity, unit_price_cents, booking_id)
       select organization_id, id, 'Standard clean', 1, 14000, booking_id from public.invoices where organization_id = $1`,
      [org],
    );
    await db.query(
      "update public.bookings b set billing_invoice_id = i.id from public.invoices i where i.booking_id = b.id and i.organization_id = $1",
      [org],
    );
    await db.query(
      `insert into public.invoice_payments (organization_id, invoice_id, amount_cents, method, received_at)
       select organization_id, id, amount_cents, 'card', sent_at + interval '3 days'
         from public.invoices where organization_id = $1 and sent_at < now() - interval '30 days'`,
      [org],
    );
    // What piles up: notifications and the audit log.
    await db.query(
      `insert into public.notifications (organization_id, recipient_membership_id, type, title, body, href, created_at, read_at)
       select $1, case when g % 2 = 0 then $2::uuid else $3::uuid end, 'general', 'Note ' || g, 'Body', '/app', now() - make_interval(hours => g * 3),
              case when g > 40 then now() end
         from generate_series(1, 3000) g`,
      [org, owner.membershipId, busy.membershipId],
    );
    await db.query(
      `insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, created_at)
       select $1, $2, 'update', 'booking', null, now() - make_interval(hours => g * 3) from generate_series(1, 3500) g`,
      [org, owner.membershipId],
    );
    await db.query("commit");
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  } finally {
    db.release();
  }

  const pick = async (sql: string, params: unknown[] = []) => (await api.sql<{ id: string }>(sql, params))[0]?.id ?? "";
  ids.job = await pick(
    "select id from public.bookings where organization_id = $1 and client_id = $2 and assigned_to = $3 and scheduled_at > now() order by scheduled_at limit 1",
    [org, ids.bigClient, busy.membershipId],
  );
  if (!ids.job) ids.job = await pick("select id from public.bookings where organization_id = $1 and assigned_to = $2 and scheduled_at > now() order by scheduled_at limit 1", [org, busy.membershipId]);
  ids.invoice = await pick("select id from public.invoices where organization_id = $1 and client_id = $2 order by sent_at desc limit 1", [org, ids.bigClient]);
  ids.template = await pick("select id from public.checklist_templates where organization_id = $1 limit 1", [org]);
  const [user] = await api.sql<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id",
    [`big-client-${Date.now()}@example.test`, JSON.stringify({ full_name: "Big Client" })],
  );
  await api.sql("update public.clients set profile_id = $2 where id = $1", [ids.bigClient, user.id]);
  portalUser = user.id;
}

// ── What to open ───────────────────────────────────────────────────────────

type Who = "owner" | "cleaner" | "client" | "nobody";
type Target = { name: string; url: string; who: Who };

const APP_DIR = fileURLToPath(new URL("../../src/app", import.meta.url));
const MADE_UP_ID = "00000000-0000-4000-8000-000000000000";

function walk(dir: string, file: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, file, out);
    else if (name === file) out.push(p.slice(APP_DIR.length + 1).replace(/\\/g, "/"));
  }
  return out;
}

const routeOf = (file: string, leaf: RegExp) =>
  "/" + file.replace(leaf, "").split("/").filter((seg) => seg && !/^\(.*\)$/.test(seg)).join("/");

function targets(): Target[] {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const real: Record<string, string> = {
    "/app/bookings/[id]": ids.job,
    "/app/bookings/[id]/edit": ids.job,
    "/app/bookings/[id]/offer": ids.job,
    "/app/clients/[id]": ids.bigClient,
    "/app/clients/[id]/edit": ids.bigClient,
    "/app/clients/[id]/statement": ids.bigClient,
    "/app/invoices/[id]": ids.invoice,
    "/app/invoices/[id]/edit": ids.invoice,
    "/app/employees/[id]": busy.membershipId,
    "/app/employees/[id]/edit": busy.membershipId,
    "/app/checklists/[id]": ids.template,
    "/app/payroll/periods/[range]": `${day(-13)}_${day(0)}`,
    "/field/jobs/[id]": ids.job,
    "/client/jobs/[id]": ids.job,
    "/app/help/[slug]": "getting-around",
    "/help/[slug]": "getting-around",
    "/texting/[orgId]/privacy": org,
    "/texting/[orgId]/terms": org,
  };
  const pages = walk(APP_DIR, "page.tsx").map((file) => {
    const route = routeOf(file, /\/?page\.tsx$/);
    const who: Who = route.startsWith("/app") ? "owner" : route.startsWith("/field") ? "cleaner" : file.startsWith("client/(portal)/") ? "client" : "nobody";
    const url = route in real ? route.replace(/\[[^\]]+\]/, real[route]) : route.replace(/\[\.\.\.[^\]]+\]|\[[^\]]+\]/g, MADE_UP_ID);
    return { name: route, url: url || "/", who };
  });
  const crons = walk(join(APP_DIR, "api", "cron"), "route.ts").map((file) => {
    const route = "/" + file.replace(/\/route\.ts$/, "");
    return { name: route, url: route, who: "nobody" as Who };
  });
  const extra: Target[] = [
    { name: "/api/export", url: "/api/export", who: "owner" },
    { name: "/api/client-calendar/[id]", url: `/api/client-calendar/${ids.bigClient}`, who: "client" },
  ];
  return [...pages.sort((a, b) => a.name.localeCompare(b.name)), ...crons.sort((a, b) => a.name.localeCompare(b.name)), ...extra];
}

// ── Opening, and counting ──────────────────────────────────────────────────

function cookieFor(who: Who): string {
  const user = who === "owner" ? owner.userId : who === "cleaner" ? busy.userId : who === "client" ? portalUser : null;
  return user ? api.sessionCookies(user).map((c) => `${c.name}=${c.value}`).join("; ") : "";
}

type Seen = {
  name: string;
  who: Who;
  status: number;
  ms: number;
  calls: number;
  capped: Traffic[];
  /** Reads that came back with exactly 1,000 rows however they asked: a
   *  `.limit(1000)` used as a safety cap drops rows just the same. */
  atCap: Traffic[];
  biggest: number;
  error?: string;
};

async function visit(t: Target): Promise<Seen> {
  const headers: Record<string, string> = { cookie: cookieFor(t.who) };
  if (t.url.startsWith("/api/cron/")) headers.authorization = `Bearer ${CRON_SECRET}`;
  const isCron = t.url.startsWith("/api/cron/");
  // Pages: once to compile (dev builds a page on first visit), once counted.
  // Crons: counted on the first call, which is the one that does the work.
  if (!isCron) await (await fetch(base + t.url, { headers, redirect: "manual" }).catch(() => null))?.arrayBuffer().catch(() => {});
  api.traffic.start();
  const t0 = performance.now();
  let error: string | undefined;
  const res = await fetch(base + t.url, { headers, redirect: "manual", signal: AbortSignal.timeout(280_000) }).catch((err: unknown) => {
    error = String((err as Error)?.cause ?? err);
    return null;
  });
  await res?.arrayBuffer().catch(() => {});
  const ms = Math.round(performance.now() - t0);
  await new Promise((r) => setTimeout(r, 400)); // work it started and did not wait for
  const calls = api.traffic.stop();
  // A read that pages (asks again from 1,000 on) is whole; a single read
  // that came back with 1,000 is not, however it asked.
  const paged = new Set(calls.filter((c) => /(?:^|&)offset=[1-9]/.test(c.query)).map(readKey));
  return {
    name: t.name,
    who: t.who,
    status: res?.status ?? 0,
    ms,
    calls: calls.length,
    capped: calls.filter((c) => c.capped),
    atCap: calls.filter((c) => c.rows === 1000 && !c.capped && !paged.has(readKey(c))),
    biggest: Math.max(0, ...calls.map((c) => c.rows ?? 0)),
    error: error ?? ((res?.status ?? 0) >= 500 ? appLog.slice(-3000) : undefined),
  };
}

/** One cut-off read, stable across runs: the table and what it selects. */
const readKey = (c: Traffic) => `${c.path} select=${(/(?:^|&)select=([^&]*)/.exec(c.query)?.[1] ?? "").slice(0, 70)}`;

beforeAll(async () => {
  if (!ready) return;
  api = await startApi();
  if (api.kind !== "postgres") throw new Error("the load tests must run on a real server (pnpm test:load)");
  const t0 = performance.now();
  await seed();
  const [counts] = await api.sql<Record<string, number>>(
    `select (select count(*)::int from public.bookings) as bookings, (select count(*)::int from public.booking_assignees) as crew,
            (select count(*)::int from public.booking_checklist_items) as checklist, (select count(*)::int from public.time_entries) as shifts,
            (select count(*)::int from public.invoices) as invoices, (select count(*)::int from public.invoice_payments) as payments`,
  );
  console.log(`[cutoff] seeded ${JSON.stringify(counts)} in ${Math.round(performance.now() - t0)} ms`);
  await startApp();
}, 900_000);

async function startApp(): Promise<void> {
  const port = await freePort();
  base = `http://localhost:${port}`;
  // The morning check answers 500 when it has nobody to send to; production
  // has the address. Email itself is not configured here, so nothing goes.
  app = spawnApp(api, port, "pipe", { CRON_SECRET, MORNING_CHECK_EMAIL: "morning-check@example.test" });
  app.stdout?.on("data", (d) => (appLog = (appLog + String(d)).slice(-20_000)));
  app.stderr?.on("data", (d) => (appLog = (appLog + String(d)).slice(-20_000)));
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (app.exitCode !== null) throw new Error(`the app exited:\n${appLog.slice(-2000)}`);
    try {
      if ((await fetch(`${base}/login`, { redirect: "manual" })).status < 500) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`the app did not answer:\n${appLog.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

afterAll(async () => {
  if (app && app.exitCode === null) app.kill();
  await api?.stop();
});

describe.skipIf(!ready)("every page and cron at twice Svit's size, watched for reads cut off at 1,000 rows", () => {
  it("lists every read the API cut off", async () => {
    const seen: Seen[] = [];
    const deaths: Array<{ at: string; code: number | null; log: string }> = [];
    for (const t of targets()) {
      let s = await visit(t);
      if (s.status === 0 && app && app.exitCode !== null) {
        // The app died on this one or the one before. Keep why, start it
        // again, and try this one once more.
        deaths.push({ at: t.name, code: app.exitCode, log: appLog.slice(-4000) });
        console.log(`[cutoff] the app exited (code ${app.exitCode}) at ${t.name}; restarting`);
        await startApp();
        s = await visit(t);
      }
      seen.push(s);
      if (s.capped.length) console.log(`[cutoff] CUT ${t.name} (${t.who}): ${[...new Set(s.capped.map(readKey))].join(" ; ")}`);
      if (s.atCap.length) {
        const limitOf = (c: Traffic) => /(?:^|&)limit=(\d+)/.exec(c.query)?.[1] ?? "-";
        console.log(`[cutoff] AT 1,000 ${t.name} (${t.who}): ${[...new Set(s.atCap.map((c) => `${readKey(c)} limit=${limitOf(c)}`))].join(" ; ")}`);
      }
    }
    const byRead = new Map<string, string[]>();
    for (const s of seen) for (const c of s.capped) byRead.set(readKey(c), [...new Set([...(byRead.get(readKey(c)) ?? []), s.name])]);
    writeFileSync(
      REPORT,
      JSON.stringify(
        {
          reads: [...byRead.entries()].map(([read, where]) => ({ read, where })),
          deaths,
          targets: seen.map((s) => ({
            name: s.name,
            who: s.who,
            status: s.status,
            ms: s.ms,
            calls: s.calls,
            biggest: s.biggest,
            error: s.error,
            capped: s.capped.map((c) => `${c.path}?${c.query}`),
            atCap: s.atCap.map((c) => `${c.path}?${c.query}`),
          })),
        },
        null,
        2,
      ),
    );
    console.log(`[cutoff] ${seen.length} targets, ${byRead.size} distinct reads cut off; report at ${REPORT}`);
    expect(seen.filter((s) => s.status >= 500).map((s) => `${s.name} ${s.status}`), "targets that failed outright").toEqual([]);
  }, 3_600_000);
});

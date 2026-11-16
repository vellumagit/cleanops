/**
 * Pages at ten times Svit's size: how many database calls each makes, how
 * long it takes, and whether any read was cut off at the API's 1,000 rows.
 *
 * The app (`next dev`, test/db/app-process.ts) runs against the real server,
 * and every database call goes through the stack's proxy, which counts it
 * (api.traffic). The company: 40 cleaners, 1,000 clients, 14,400 jobs over
 * 90 days (60 behind, 30 ahead, four slots a day each), a shift for every
 * finished job, 3,000 invoices. Svit has about a tenth of each.
 *
 * Each page is opened once to compile it (dev mode builds a page on its
 * first visit), then once measured. Dev-mode times are slower than
 * production; the call counts are the same, and a page that grows its calls
 * with the data is what slows down first.
 */
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasPostgrest, startApi, type Api, type Traffic } from "../db/api";
import { spawnApp } from "../db/app-process";
import { addMember, addOrg, type Member } from "../db/harness";
import { hasRealPostgres } from "../db/real-postgres";

const CLEANERS = 40;
const CLIENTS = 1200; // more than one read can return, so a read that stops at 1,000 is cut short
const MAX_CALLS = 80;

const ready = hasPostgrest && hasRealPostgres;
let api: Api;
let app: ChildProcess | null = null;
let base = "";
let owner: Member;
let cleaner: Member;
let appLog = "";

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
  const org = await addOrg(api.sql, "Huge Co");
  await api.sql(
    `update public.organizations
        set timezone = 'UTC', onboarding_completed_at = now(), automations_enabled = true, booking_auto_complete_hours = 2,
            automation_settings = '{"divide_crew_hours":{"enabled":true}}'::jsonb
      where id = $1`,
    [org],
  );
  owner = await addMember(api.sql, org, "owner", "Huge Owner");
  await api.sql("update public.memberships set display_name = 'Huge Owner' where id = $1", [owner.membershipId]);
  const crew: Member[] = [];
  for (let i = 0; i < CLEANERS; i++) crew.push(await addMember(api.sql, org, "employee", `Huge Cleaner ${i + 1}`));
  cleaner = crew[0];
  await api.sql("update public.memberships set pay_rate_cents = 2200 where id = any($1::uuid[])", [crew.map((m) => m.membershipId)]);

  // One connection, one transaction, the schedule guard set to batch: it
  // checks every row it is asked to, and these are laid out not to collide.
  const db = await api.real!.pool.connect();
  try {
    await db.query("begin");
    await db.query("set local sollos.schedule_check = 'batch'");
    await db.query(
      `insert into public.service_types (organization_id, name, default_duration_minutes, default_price_cents, sort_order)
       values ($1, 'Standard clean', 120, 14000, 1)`,
      [org],
    );
    const { rows: clients } = await db.query<{ id: string }>(
      `insert into public.clients (organization_id, name, address)
       select $1, 'Huge Client ' || g, g || ' Test Street' from generate_series(1, $2::int) g returning id`,
      [org, CLIENTS],
    );
    await db.query(
      `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, total_cents, assigned_to, address)
       select $1,
              ($3::uuid[])[1 + ((d + 60) * 160 + s * 40 + c) % $4::int],
              date_trunc('day', now()) + make_interval(days => d, hours => 8 + 3 * s),
              120, 'standard',
              (case when date_trunc('day', now()) + make_interval(days => d, hours => 10 + 3 * s) < now()
                    then 'completed' else 'confirmed' end)::public.booking_status,
              14000, ($2::uuid[])[1 + c], 'Somewhere'
         from generate_series(-60, 29) d, generate_series(0, 3) s, generate_series(0, $5::int - 1) c`,
      [org, crew.map((m) => m.membershipId), clients.map((c) => c.id), CLIENTS, CLEANERS],
    );
    await db.query(
      `insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status)
       select organization_id, id, assigned_to, true, 'accepted' from public.bookings where organization_id = $1`,
      [org],
    );
    await db.query(
      `insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, engagement_snapshot)
       select organization_id, assigned_to, id, scheduled_at, scheduled_at + interval '2 hours', 2200, 'employee'
         from public.bookings where organization_id = $1 and status = 'completed'`,
      [org],
    );
    // 3,000 invoices for the most recent finished jobs; most paid.
    await db.query(
      `with recent as (
         select id, client_id, row_number() over (order by scheduled_at desc) as n
           from public.bookings where organization_id = $1 and status = 'completed'
          order by scheduled_at desc limit 3000)
       insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents, sent_at, due_date, paid_at)
       select $1, client_id, id,
              (case when n <= 200 then 'draft' when n <= 500 then 'sent' else 'paid' end)::public.invoice_status,
              14700,
              case when n <= 200 then null else now() - make_interval(days => (n / 50)::int) end,
              current_date + 14,
              case when n > 500 then now() else null end
         from recent`,
      [org],
    );
    await db.query(
      `insert into public.invoice_line_items (organization_id, invoice_id, label, quantity, unit_price_cents, booking_id)
       select organization_id, id, 'Standard clean', 1, 14000, booking_id from public.invoices where organization_id = $1`,
      [org],
    );
    await db.query(
      `update public.bookings b set billing_invoice_id = i.id from public.invoices i where i.booking_id = b.id and i.organization_id = $1`,
      [org],
    );
    await db.query("commit");
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

beforeAll(async () => {
  if (!ready) return;
  api = await startApi();
  if (api.kind !== "postgres") throw new Error("the load tests must run on a real server (pnpm test:load)");
  const t0 = performance.now();
  await seed();
  const [{ jobs, invoices }] = await api.sql<{ jobs: number; invoices: number }>(
    "select (select count(*)::int from public.bookings) as jobs, (select count(*)::int from public.invoices) as invoices",
  );
  console.log(`[load] seeded ${jobs} jobs and ${invoices} invoices in ${Math.round(performance.now() - t0)} ms`);

  const port = await freePort();
  base = `http://localhost:${port}`;
  app = spawnApp(api, port, "pipe");
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
}, 600_000);

afterAll(async () => {
  if (app && app.exitCode === null) app.kill();
  await api?.stop();
});

const cookieFor = (who: Member) => api.sessionCookies(who.userId).map((c) => `${c.name}=${c.value}`).join("; ");

type Measured = { path: string; status: number; ms: number; calls: number; dbMs: number; capped: Traffic[]; slowest: Traffic | null };

async function measure(path: string, who: Member): Promise<Measured> {
  const headers = { cookie: cookieFor(who) };
  await (await fetch(base + path, { headers, redirect: "manual" })).arrayBuffer(); // compile + warm
  api.traffic.start();
  const t0 = performance.now();
  const res = await fetch(base + path, { headers, redirect: "manual" });
  await res.arrayBuffer();
  const ms = Math.round(performance.now() - t0);
  // Work the page started but did not wait for still counts, a moment later.
  await new Promise((r) => setTimeout(r, 300));
  const calls = api.traffic.stop();
  const slowest = [...calls].sort((a, b) => b.ms - a.ms)[0] ?? null;
  return {
    path,
    status: res.status,
    ms,
    calls: calls.length,
    dbMs: calls.reduce((s, c) => s + c.ms, 0),
    capped: calls.filter((c) => c.capped),
    slowest,
  };
}

const OFFICE = [
  "/app",
  "/app/bookings",
  "/app/scheduling",
  "/app/calendar",
  "/app/timesheets",
  "/app/invoices",
  "/app/clients",
  "/app/employees",
  "/app/payroll",
  "/app/reports",
  "/app/bookings/series",
  "/app/notifications",
];
const FIELD = ["/field/jobs", "/field/clock", "/field/pay", "/field/shifts"];

/** A cut-off read, stable across runs: the page, the table, and what it selects (dates left out). */
function cutOffKey(page: string, call: Traffic): string {
  const select = /(?:^|&)select=([^&]*)/.exec(call.query)?.[1] ?? "";
  return `${page} ${call.path} select=${select.slice(0, 60)}`;
}

/**
 * Reads that stop at 1,000 rows for a company this size (2026-11-15). None
 * is near the limit for Svit (about 186 bookings in three months, 99
 * clients); each matters for a company with more than 1,000 clients, or
 * more than 1,000 jobs in a week. Each line is a fix to make before such a
 * company signs up: read in pages, or show a limit the screen states.
 */
const KNOWN_CUT_OFF: string[] = [
  // Dashboard: this week's jobs (revenue card), the client count, recent shifts.
  "/app bookings select=id,total_cents,status",
  "/app clients select=id",
  "/app time_entries select=id",
  // Calendar: three months of jobs, the client picker, invoices by due date.
  "/app/calendar bookings select=id,scheduled_at,duration_minutes,service_type,status,address",
  "/app/calendar clients select=id,name,address,notes,preferred_cleaner_id",
  "/app/calendar invoices select=id,due_date,status,amount_cents,number,client:clients(name)",
  // Reports: the client list.
  "/app/reports clients select=id,name,created_at",
  // Scheduling: the week's jobs and crews. The one to fix first: the board
  // would leave jobs off without saying.
  "/app/scheduling booking_assignees select=booking_id,membership_id,is_primary,split_start_offset_minut",
  "/app/scheduling bookings select=id,divide_hours_evenly,is_free",
  "/app/scheduling bookings select=id,scheduled_at,duration_minutes,status,service_type,assigne",
];

describe.skipIf(!ready)("pages at ten times Svit's size, on a real server", () => {
  it(`every main page answers, makes at most ${MAX_CALLS} database calls, and never reads a list cut off at 1,000 rows`, async () => {
    const results: Measured[] = [];
    for (const p of OFFICE) results.push(await measure(p, owner));
    for (const p of FIELD) results.push(await measure(p, cleaner));

    console.log(
      "[load] page                     status   time  db calls  db time  slowest call\n" +
        results
          .map(
            (r) =>
              `[load] ${r.path.padEnd(24)} ${String(r.status).padStart(6)} ${String(r.ms).padStart(6)} ms ${String(r.calls).padStart(6)} ${String(r.dbMs).padStart(7)} ms  ${
                r.slowest ? `${r.slowest.path} ${r.slowest.ms} ms (${r.slowest.rows ?? "?"} rows)` : ""
              }${r.capped.length ? `   CUT OFF AT 1,000: ${r.capped.map((c) => `${c.path}?${c.query.slice(0, 120)}`).join(" ; ")}` : ""}`,
          )
          .join("\n"),
    );

    expect(results.filter((r) => r.status !== 200).map((r) => `${r.path} ${r.status}`), "pages that did not answer 200").toEqual([]);
    expect(results.filter((r) => r.calls > MAX_CALLS).map((r) => `${r.path}: ${r.calls} calls`), "pages making too many database calls").toEqual([]);

    // Reads cut off at 1,000 rows at this size. The known ones are written
    // down (KNOWN_CUT_OFF): a new one fails here, and so does one that is
    // fixed but still listed, so the list only shrinks.
    const found = [...new Set(results.flatMap((r) => r.capped.map((c) => cutOffKey(r.path, c))))].sort();
    const known = new Set(KNOWN_CUT_OFF);
    expect(
      found.filter((k) => !known.has(k)),
      "new reads cut off at 1,000 rows (read in pages, or add a limit the screen states)",
    ).toEqual([]);
    expect(
      KNOWN_CUT_OFF.filter((k) => !found.includes(k)),
      "listed as cut off but no longer are: take them off KNOWN_CUT_OFF",
    ).toEqual([]);
  });
});

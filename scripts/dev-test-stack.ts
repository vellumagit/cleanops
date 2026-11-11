/**
 * Run the app locally against a throwaway database instead of production.
 *
 *   npx tsx scripts/dev-test-stack.ts          (or the "cleanops-teststack" preview)
 *
 * `npm run dev` reads .env.local, which points at the live Supabase project:
 * every click in a local preview is a click on real data. This starts the
 * same stack the API tests use (test/db/api.ts: an in-process Postgres built
 * from the migrations, behind a real PostgREST), seeds one small company, and
 * runs `next dev` pointed at it. Nothing here can reach production: the
 * Supabase URL and keys are replaced, and every other secret in .env.local
 * (Stripe, Resend, Twilio, Google, Sentry...) is blanked for the child
 * process, so a saved booking cannot send a real email or charge a real card.
 *
 * There is no login server. Sign in by setting the session cookie this
 * prints (also written to node_modules/.cache/sollos-test-db/dev-session.json):
 * paste the `document.cookie = ...` line for the person you want to be into
 * the browser console, then load /app or /field.
 *
 * The database lives in memory. Stop the script and it is gone.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startApi } from "../test/db/api";
import { addBooking, addClient, addMember, addOrg } from "../test/db/harness";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT ?? 3100);

/** Keys the app may keep from .env.local: nothing that reaches a real service. */
const KEEP = new Set(["NODE_ENV", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL"]);

function blankedSecrets(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of [".env.local", ".env", ".env.development", ".env.development.local"]) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      // Defined wins over the file: Next never overrides a variable the
      // process already has. Empty for secrets; but an on/off flag has to be
      // a valid "off", because src/lib/env.ts rejects an empty string for
      // those and every page that asks for the environment would fail.
      if (!m || KEEP.has(m[1])) continue;
      const key = m[1];
      out[key] = /_(ENABLED|PAUSED|UNPAUSED)$/.test(key) ? "false" : /_ENVIRONMENT$/.test(key) ? "sandbox" : "";
    }
  }
  return out;
}

async function main() {
  const api = await startApi();
  const sql = api.sql;
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

  // ── One small company ────────────────────────────────────────────────────
  const org = await addOrg(sql, "Test Cleaning Co");
  await sql(
    `update public.organizations
       set name = 'Test Cleaning Co', timezone = 'America/Edmonton', onboarding_completed_at = now(),
           automations_enabled = true, automation_settings = $2::jsonb, booking_auto_complete_hours = 2
     where id = $1`,
    [
      org,
      JSON.stringify({
        divide_crew_hours: { enabled: true },
        auto_complete_past_bookings: { enabled: true },
        auto_invoice_on_job_complete: { enabled: true },
      }),
    ],
  );
  const owner = await addMember(sql, org, "owner", "Olivia Owner");
  const manager = await addMember(sql, org, "manager", "Mara Manager");
  const anna = await addMember(sql, org, "employee", "Anna Cleaner");
  const bea = await addMember(sql, org, "employee", "Bea Cleaner");
  for (const [m, name] of [
    [owner, "Olivia Owner"],
    [manager, "Mara Manager"],
    [anna, "Anna Cleaner"],
    [bea, "Bea Cleaner"],
  ] as const) {
    await sql("update public.memberships set display_name = $2 where id = $1", [m.membershipId, name]);
    await sql("update public.profiles set full_name = $2 where id = $1", [m.userId, name]);
  }

  await sql(
    `insert into public.service_types (organization_id, name, default_duration_minutes, default_price_cents, sort_order)
     values ($1, 'Standard clean', 120, 14000, 1), ($1, 'Deep clean', 240, 32000, 2)`,
    [org],
  );
  const client = await addClient(sql, org, "Jordan Client");
  await sql("update public.clients set name = 'Jordan Client', address = '12 Test Street', email = 'jordan@example.test' where id = $1", [client]);

  // Today, under way: Anna on the clock, Bea not here yet.
  const today = await addBooking(sql, org, client, { scheduledAt: ago(90), durationMinutes: 240, status: "in_progress" });
  // Yesterday, finished and invoiced.
  const done = await addBooking(sql, org, client, { scheduledAt: ago(60 * 26), durationMinutes: 120, status: "completed" });
  // Tomorrow.
  const next = await addBooking(sql, org, client, {
    scheduledAt: new Date(Date.now() + 22 * 3_600_000).toISOString(),
    durationMinutes: 120,
    status: "confirmed",
  });
  for (const id of [today, done, next]) {
    await sql("update public.bookings set total_cents = 14000, address = '12 Test Street' where id = $1", [id]);
  }
  const crew = (job: string, who: { membershipId: string }, primary: boolean) =>
    sql(
      `insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status)
       values ($1, $2, $3, $4, 'accepted')`,
      [org, job, who.membershipId, primary],
    );
  await crew(today, anna, true);
  await crew(today, bea, false);
  await crew(done, bea, true);
  await crew(next, anna, true);
  await sql("update public.bookings set assigned_to = $2 where id = $1", [today, anna.membershipId]);
  await sql("update public.bookings set assigned_to = $2 where id = $1", [done, bea.membershipId]);
  await sql("update public.bookings set assigned_to = $2 where id = $1", [next, anna.membershipId]);

  await sql(
    "insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at) values ($1, $2, $3, $4)",
    [org, anna.membershipId, today, ago(85)],
  );
  await sql(
    `insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at, clock_out_at)
     values ($1, $2, $3, $4, $5)`,
    [org, bea.membershipId, done, ago(60 * 26), ago(60 * 24 + 15)],
  );
  await sql("update public.booking_assignees set completed_at = now() where booking_id = $1", [done]);
  const [invoice] = await sql<{ id: string }>(
    `insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents)
     values ($1, $2, $3, 'sent', 14000) returning id`,
    [org, client, done],
  );
  await sql(
    `insert into public.invoice_line_items (organization_id, invoice_id, label, quantity, unit_price_cents, booking_id)
     values ($1, $2, 'Standard clean', 1, 14000, $3)`,
    [org, invoice.id, done],
  );
  await sql("update public.bookings set billing_invoice_id = $2 where id = $1", [done, invoice.id]);

  // Pay: both cleaners have a rate, and Bea's finished shift sits in a pay run
  // the office has prepared but not finalized. Her pay page must still show it.
  await sql("update public.memberships set pay_rate_cents = 2200 where id = any($1::uuid[])", [
    [anna.membershipId, bea.membershipId],
  ]);
  const [draftRun] = await sql<{ id: string }>(
    `insert into public.payroll_runs (organization_id, period_start, period_end, status, total_cents, created_by)
     values ($1, (now() - interval '13 days')::date, now()::date, 'draft', 3850, $2) returning id`,
    [org, owner.membershipId],
  );
  await sql("update public.time_entries set payroll_run_id = $2 where employee_id = $1 and clock_out_at is not null", [
    bea.membershipId,
    draftRun.id,
  ]);

  // An integration that stopped working, so Settings -> Integrations has
  // something to say about it.
  await sql(
    `insert into public.integration_connections (organization_id, provider, status, last_error, external_account_id)
     values ($1, 'quickbooks', 'error', 'QBO token refresh failed: 400 invalid_grant', '9341453')`,
    [org],
  );

  // ── Who you can be ───────────────────────────────────────────────────────
  const people = { owner, manager, anna, bea };
  const session: Record<string, { cookie: string; paste: string }> = {};
  for (const [name, who] of Object.entries(people)) {
    const [cookie] = api.sessionCookies(who.userId, `${name}@example.test`);
    session[name] = {
      cookie: `${cookie.name}=${cookie.value}`,
      paste: `document.cookie = "${cookie.name}=${cookie.value}; path=/"`,
    };
  }
  const cacheDir = join(ROOT, "node_modules", ".cache", "sollos-test-db");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    join(cacheDir, "dev-session.json"),
    JSON.stringify({ app: `http://localhost:${PORT}`, org, ids: { today, done, next, invoice: invoice.id }, session }, null, 2),
  );
  console.log(`[test-stack] database + PostgREST ready at ${api.url}`);
  console.log(`[test-stack] sessions written to ${join(cacheDir, "dev-session.json")} (valid for one hour)`);
  console.log(`[test-stack] starting the app on http://localhost:${PORT}`);

  // ── The app, pointed at it, with every real secret blanked ───────────────
  const require = createRequire(import.meta.url);
  const nextBin = require.resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(PORT)], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      ...blankedSecrets(),
      NEXT_PUBLIC_SUPABASE_URL: api.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: api.anonKey,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: api.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: api.serviceKey,
      SOLLOS_TEST_STACK: "1",
    },
  });
  const shutdown = async () => {
    if (child.exitCode === null) child.kill();
    await api.stop().catch(() => {});
    process.exit(0);
  };
  child.on("exit", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("[test-stack] failed to start:", err);
  process.exit(1);
});

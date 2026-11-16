/**
 * Volume: the scheduled runs against a company ten times Svit's size.
 *
 * Svit books about forty jobs a day. This seeds one company at 400 a day for
 * the last three days (1,200 jobs, 40 cleaners, nobody tapped anything) and
 * runs what production runs on its own:
 *
 *   - the half-hourly heartbeat (syncLiveJobs, from the shift-reminders cron,
 *     120 s limit), which closes a staffed job nobody tapped once its window
 *     and the company's grace have passed;
 *   - the 2 AM sweep (autoCompletePastBookings, complete-bookings cron,
 *     120 s limit);
 *   - the morning check.
 *
 * What it asks: does every job that should close, close; does none close
 * early; and does each run finish inside its limit? It also prints how long
 * each took, so a slowdown shows before it becomes a timeout.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "../db/api";
import { addClient, addMember, addOrg, type Member } from "../db/harness";
import { hasRealPostgres } from "../db/real-postgres";

vi.mock("next/headers", async () => (await import("../db/next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("../db/next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("../db/next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("../db/next-stubs")).nextServer(),
}));

const CRON_LIMIT_MS = 120_000;
const CLEANERS = 40;
const JOBS_EACH = 30; // 40 × 30 = 1,200 jobs over three days: 400 a day
const SPACING_MIN = 144; // 2.4 h apart, so a cleaner's two-hour jobs never overlap
const DURATION_MIN = 120;
const GRACE_HOURS = 1;

const ready = hasPostgrest && hasRealPostgres;
let api: Api;
let restoreEnv: () => void;

beforeAll(async () => {
  if (!ready) return;
  api = await startApi();
  if (api.kind !== "postgres") throw new Error("the load tests must run on a real server (pnpm test:load)");
  restoreEnv = api.useAsSupabase();
});

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

/** Seed the big company in a few statements; returns its id. */
async function bigCompany(): Promise<string> {
  const org = await addOrg(api.sql, "Big Co");
  await api.sql(
    `update public.organizations
        set automations_enabled = true, timezone = 'UTC', booking_auto_complete_hours = $2,
            automation_settings = '{"auto_complete_past_bookings":{"enabled":true}}'::jsonb
      where id = $1`,
    [org, GRACE_HOURS],
  );
  await addMember(api.sql, org, "owner", "Big Owner");
  const client = await addClient(api.sql, org, "Big Client");
  const crew: Member[] = [];
  for (let i = 0; i < CLEANERS; i++) crew.push(await addMember(api.sql, org, "employee", `Big Cleaner ${i + 1}`));

  const now = Date.now();
  const times: string[] = [];
  const who: string[] = [];
  for (const [i, m] of crew.entries()) {
    for (let k = 0; k < JOBS_EACH; k++) {
      // Newest first: job 0 started a few minutes ago, job 29 about three days back.
      times.push(new Date(now - (k * SPACING_MIN + i * 3 + 5) * 60_000).toISOString());
      who.push(m.membershipId);
    }
  }
  const jobs = await api.sql<{ id: string; assigned_to: string }>(
    `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, total_cents, assigned_to)
     select $1, $2, x.at, $5, 'standard', 'confirmed', 14000, x.who
       from unnest($3::timestamptz[], $4::uuid[]) as x(at, who)
     returning id, assigned_to`,
    [org, client, times, who, DURATION_MIN],
  );
  await api.sql(
    `insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status)
     select $1, x.b, x.m, true, 'accepted' from unnest($2::uuid[], $3::uuid[]) as x(b, m)`,
    [org, jobs.map((j) => j.id), jobs.map((j) => j.assigned_to)],
  );
  return org;
}

/** Jobs whose window and grace have passed (should close), and those still inside them (must not). */
async function counts(org: string) {
  const [row] = await api.sql<{ due_open: number; due_closed: number; early_closed: number; total: number }>(
    `select count(*) filter (where due and status <> 'completed')::int as due_open,
            count(*) filter (where due and status = 'completed')::int as due_closed,
            count(*) filter (where not due and status = 'completed')::int as early_closed,
            count(*)::int as total
       from (select status::text as status,
                    scheduled_at + make_interval(mins => duration_minutes) + make_interval(hours => $2) < now() as due
               from public.bookings where organization_id = $1) j`,
    [org, GRACE_HOURS],
  );
  return row;
}

describe.skipIf(!ready)("a company ten times Svit's size, on a real server", () => {
  it("heartbeats close every job that should close, none early, each run inside the cron limit; then the sweep and the morning check", async () => {
    const tSeed = performance.now();
    const org = await bigCompany();
    const start = await counts(org);
    console.log(`[load] seeded ${start.total} jobs (${start.due_open} past window + grace) in ${Math.round(performance.now() - tSeed)} ms`);
    expect(start.total).toBe(CLEANERS * JOBS_EACH);

    const { syncLiveJobs } = await import("@/lib/job-sync");
    const runs: Array<{ considered: number; changed: number; ms: number }> = [];
    for (let i = 0; i < 12; i++) {
      const t0 = performance.now();
      const res = await syncLiveJobs();
      runs.push({ ...res, ms: Math.round(performance.now() - t0) });
      if (res.changed === 0) break;
    }
    const afterBeats = await counts(org);
    console.log(
      `[load] heartbeat runs (each = one half-hour tick): ${runs.map((r) => `${r.changed}/${r.considered} closed in ${r.ms} ms`).join("; ")}`,
    );
    console.log(`[load] after ${runs.length} heartbeat(s): ${afterBeats.due_closed} closed, ${afterBeats.due_open} still open past their window, ${afterBeats.early_closed} closed early`);

    const { autoCompletePastBookings } = await import("@/lib/automations/job-lifecycle");
    const tSweep = performance.now();
    await autoCompletePastBookings();
    const sweepMs = Math.round(performance.now() - tSweep);
    const afterSweep = await counts(org);
    console.log(`[load] nightly sweep: ${sweepMs} ms; then ${afterSweep.due_open} still open past their window`);

    const { runMorningCheck } = await import("@/lib/morning-check");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const tCheck = performance.now();
    const report = await runMorningCheck(createSupabaseAdminClient(), { orgId: org, hoursBack: 36 });
    const checkMs = Math.round(performance.now() - tCheck);
    console.log(`[load] morning check: ${checkMs} ms, ${report.lines.length} lines, flags: ${report.flags.join(" | ") || "none"}`);

    // Every run of a cron inside its limit.
    for (const r of runs) expect(r.ms, "a heartbeat run took longer than the cron allows").toBeLessThan(CRON_LIMIT_MS);
    expect(sweepMs, "the nightly sweep took longer than the cron allows").toBeLessThan(CRON_LIMIT_MS);
    expect(checkMs, "the morning check took longer than its cron allows").toBeLessThan(CRON_LIMIT_MS);
    // Nothing closed early, and the heartbeats alone caught up within the ticks run.
    expect(afterSweep.early_closed).toBe(0);
    expect(afterBeats.due_open, "jobs past their window still open after the heartbeats").toBe(0);
    // The morning check reads everything at this size, and so does not
    // mistake a crew it failed to read for a job in the wrong state.
    expect(report.flags.filter((f) => /Could not read/.test(f)), "the morning check could not read part of a big company").toEqual([]);
    expect(report.flags.filter((f) => /disagree with the computed state/.test(f))).toEqual([]);
  });
});

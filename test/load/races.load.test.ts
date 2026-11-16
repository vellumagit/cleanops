/**
 * Things happening at the same moment.
 *
 * Every test here needs a real server: on PGlite each query waits for the
 * one before, so "at the same moment" never happens and these would pass
 * by construction. vitest.load.config.ts sets SOLLOS_TEST_DB=postgres.
 *
 *   pnpm test:load
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "../db/api";
import { addBooking, addClient, addMember, addOrg, type Member } from "../db/harness";
import { inRequest } from "../db/next-stubs";
import { hasRealPostgres } from "../db/real-postgres";

vi.mock("next/headers", async () => (await import("../db/next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("../db/next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("../db/next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("../db/next-stubs")).nextServer(),
}));

const ready = hasPostgrest && hasRealPostgres;
let api: Api;
let restoreEnv: () => void;
let field: typeof import("@/app/field/jobs/actions");

beforeAll(async () => {
  if (!ready) return;
  api = await startApi();
  if (api.kind !== "postgres") throw new Error("the load tests must run on a real server (pnpm test:load)");
  restoreEnv = api.useAsSupabase();
  field = await import("@/app/field/jobs/actions");
});

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function company(label: string, opts: { autoInvoice?: boolean } = {}) {
  const org = await addOrg(api.sql, label);
  await api.sql(
    "update public.organizations set automations_enabled = true, timezone = 'UTC', automation_settings = $2::jsonb where id = $1",
    [org, JSON.stringify({ divide_crew_hours: { enabled: true }, ...(opts.autoInvoice ? { auto_invoice_on_job_complete: { enabled: true } } : {}) })],
  );
  return { org, client: await addClient(api.sql, org) };
}

async function cleaners(org: string, n: number, label: string): Promise<Member[]> {
  const out: Member[] = [];
  for (let i = 0; i < n; i++) out.push(await addMember(api.sql, org, "employee", `${label} ${i + 1}`));
  return out;
}

/** A job that started `startedMinutesAgo` ago, with this crew, all accepted. */
async function job(org: string, client: string, crew: Member[], opts: { startedMinutesAgo?: number; minutes?: number } = {}) {
  const id = await addBooking(api.sql, org, client, {
    scheduledAt: minutesAgo(opts.startedMinutesAgo ?? 10),
    durationMinutes: opts.minutes ?? 240,
    status: "confirmed",
  });
  await api.sql("update public.bookings set total_cents = 20000, divide_hours_evenly = $2 where id = $1", [id, crew.length > 1]);
  for (const [i, m] of crew.entries()) {
    await api.sql(
      `insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status)
       values ($1, $2, $3, $4, 'accepted')`,
      [org, id, m.membershipId, i === 0],
    );
  }
  return id;
}

const tapForm = (bookingId: string) => {
  const form = new FormData();
  form.set("booking_id", bookingId);
  return form;
};

/** One person's tap, as its own request with her own sign-in, timed. */
async function tap(who: Member, what: "here" | "done", bookingId: string) {
  const t0 = performance.now();
  const result = await inRequest(api.sessionCookies(who.userId), () =>
    (what === "here" ? field.startJobAction : field.completeJobAction)(tapForm(bookingId)),
  );
  return { result, ms: performance.now() - t0 };
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

describe.skipIf(!ready)("at the same moment, on a real server", () => {
  it("two saves putting one cleaner on two overlapping jobs at the same instant: at most one lands", async () => {
    const c = await company("Race Co");
    const [anna] = await cleaners(c.org, 1, "Anna");
    const at = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const jobA = await addBooking(api.sql, c.org, c.client, { scheduledAt: at, durationMinutes: 120, status: "confirmed" });
    const jobB = await addBooking(api.sql, c.org, c.client, { scheduledAt: at, durationMinutes: 120, status: "confirmed" });

    // Two connections, each in its own transaction, stepped by hand so the
    // overlap is certain rather than lucky: both put Anna on a job before
    // either commits.
    const one = await api.real!.pool.connect();
    const two = await api.real!.pool.connect();
    const insert = `insert into public.booking_assignees (organization_id, booking_id, membership_id) values ($1, $2, $3)`;
    const outcome: string[] = [];
    try {
      await one.query("begin");
      await two.query("begin");
      await one.query(insert, [c.org, jobA, anna.membershipId]);
      outcome.push("first: saved (not yet committed)");
      const second = two.query(insert, [c.org, jobB, anna.membershipId]).then(
        () => "saved",
        (err: { code?: string }) => `refused ${err.code}`,
      );
      // If the second waits on a lock the first holds, that is the guard working.
      const early = await Promise.race([second, sleep(1500).then(() => "waiting")]);
      outcome.push(`second, before the first commits: ${early}`);
      await one.query("commit");
      const late = await second;
      outcome.push(`second, after the first commits: ${late}`);
      if (late === "saved") {
        await two.query("commit").then(
          () => outcome.push("second: committed"),
          (err: { code?: string }) => outcome.push(`second: commit refused ${err.code}`),
        );
      } else {
        await two.query("rollback");
      }
    } finally {
      one.release();
      two.release();
    }

    const [{ n }] = await api.sql<{ n: number }>(
      "select count(*)::int as n from public.booking_assignees where membership_id = $1 and booking_id = any($2::uuid[])",
      [anna.membershipId, [jobA, jobB]],
    );
    console.log(`[load] same-instant double-booking:\n  ${outcome.join("\n  ")}`);
    expect(n, `Anna is on ${n} of the two jobs at the same time.\n  ${outcome.join("\n  ")}`).toBeLessThanOrEqual(1);
  });

  it("both cleaners on ten jobs tap I'm done at the same moment: each job closes once, with one invoice", async () => {
    const c = await company("Done Co", { autoInvoice: true });
    const people = await cleaners(c.org, 20, "Cleaner");
    const jobs: Array<{ id: string; crew: [Member, Member] }> = [];
    for (let i = 0; i < 10; i++) {
      const crew: [Member, Member] = [people[2 * i], people[2 * i + 1]];
      jobs.push({ id: await job(c.org, c.client, crew, { startedMinutesAgo: 30, minutes: 120 }), crew });
    }
    // Everyone is on the clock first, one tap at a time.
    for (const j of jobs) for (const who of j.crew) expect((await tap(who, "here", j.id)).result).toMatchObject({ ok: true });

    // Then all twenty "I'm done" taps at once.
    const results = await Promise.all(jobs.flatMap((j) => j.crew.map((who) => tap(who, "done", j.id))));
    const failed = results.filter((r) => !(r.result as { ok?: boolean }).ok);
    expect(failed.map((r) => r.result), "every tap should be accepted").toEqual([]);

    for (const j of jobs) {
      const [row] = await api.sql<{ status: string; invoices: number; closings: number; open: number }>(
        `select b.status::text as status,
                (select count(*)::int from public.invoices i where i.booking_id = b.id and i.status <> 'void') as invoices,
                (select count(*)::int from public.audit_log a
                  where a.entity = 'booking' and a.entity_id = b.id and a.action = 'status_change' and a.after->>'status' = 'completed') as closings,
                (select count(*)::int from public.time_entries t where t.booking_id = b.id and t.clock_out_at is null) as open
           from public.bookings b where b.id = $1`,
        [j.id],
      );
      expect(row, `job ${j.id.slice(0, 8)}`).toEqual({ status: "completed", invoices: 1, closings: 1, open: 0 });
    }
  });

  it("thirty cleaners tap I'm here at once on thirty jobs: every tap lands, and it says how long they took", async () => {
    const c = await company("Rush Co");
    const people = await cleaners(c.org, 30, "Rush");
    const jobs: string[] = [];
    for (const who of people) jobs.push(await job(c.org, c.client, [who], { startedMinutesAgo: 5, minutes: 180 }));

    const t0 = performance.now();
    const results = await Promise.all(people.map((who, i) => tap(who, "here", jobs[i])));
    const wall = performance.now() - t0;
    const ms = results.map((r) => r.ms).sort((a, b) => a - b);
    console.log(
      `[load] 30 simultaneous "I'm here": all done in ${Math.round(wall)} ms; per tap p50 ${Math.round(pct(ms, 50))} ms, p95 ${Math.round(pct(ms, 95))} ms, max ${Math.round(ms[ms.length - 1])} ms`,
    );

    const failed = results.filter((r) => !(r.result as { ok?: boolean }).ok);
    expect(failed.map((r) => r.result), "every tap should be accepted").toEqual([]);
    const [row] = await api.sql<{ open: number; started: number }>(
      `select (select count(*)::int from public.time_entries where booking_id = any($1::uuid[]) and clock_out_at is null) as open,
              (select count(*)::int from public.bookings where id = any($1::uuid[]) and status = 'in_progress') as started`,
      [jobs],
    );
    expect(row).toEqual({ open: 30, started: 30 });
    // Not a speed target: a ceiling that only a stall (a lock queue, a pool
    // running dry) would reach.
    expect(ms[ms.length - 1]).toBeLessThan(30_000);
  });
});

/**
 * The job rules in WRITE mode, run for real.
 *
 * On 2026-11-14 the rules stop shadowing and start storing a job's status
 * (docs/cutover-2026-11-14.md). Until this file, everything that proved them
 * ran against a hand-built fake of the database. Here the real syncJob loads
 * a real job through PostgREST, from rows in a real Postgres, and writes the
 * answer back: the reads, the embeds, the guarded update, the audit row and
 * the invoice draft are all the production code path.
 *
 * Each scenario is a day that already went wrong once; the dates are in
 * src/lib/job-state.ts beside the rule each one produced.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addCrew, addMember, addOrg, type Member } from "./harness";

type JobSync = typeof import("@/lib/job-sync");

let api: Api;
let restoreEnv: () => void;
let sync: JobSync;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  sync = await import("@/lib/job-sync");
}, 180_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

// ---------------------------------------------------------------------------

type Company = { org: string; client: string };

async function company(opts: { autoCompleteHours?: number | null; autoInvoice?: boolean } = {}): Promise<Company> {
  const org = await addOrg(api.sql, "Company");
  const settings: Record<string, { enabled: boolean }> = {};
  if (opts.autoCompleteHours != null) settings.auto_complete_past_bookings = { enabled: true };
  if (opts.autoInvoice) settings.auto_invoice_on_job_complete = { enabled: true };
  await api.sql(
    "update public.organizations set automations_enabled = true, automation_settings = $2::jsonb, booking_auto_complete_hours = $3 where id = $1",
    [org, JSON.stringify(settings), opts.autoCompleteHours ?? null],
  );
  return { org, client: await addClient(api.sql, org) };
}

async function jobFor(
  c: Company,
  crew: Member[],
  opts: { startedMinutesAgo: number; minutes: number },
): Promise<string> {
  const id = await addBooking(api.sql, c.org, c.client, {
    scheduledAt: minutesAgo(opts.startedMinutesAgo),
    durationMinutes: opts.minutes,
    status: "confirmed",
  });
  await api.sql("update public.bookings set total_cents = 20000 where id = $1", [id]);
  for (const m of crew) await addCrew(api.sql, c.org, id, m.membershipId);
  return id;
}

const clockIn = (c: Company, who: Member, job: string, minutes: number) =>
  api.sql(
    "insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at) values ($1, $2, $3, $4)",
    [c.org, who.membershipId, job, minutesAgo(minutes)],
  );

/** Stop her clock. `done` is the "I'm done" tap; without it, it's a break. */
async function clockOut(who: Member, job: string, done: boolean): Promise<void> {
  await api.sql(
    "update public.time_entries set clock_out_at = now() where employee_id = $1 and booking_id = $2 and clock_out_at is null",
    [who.membershipId, job],
  );
  if (done) {
    await api.sql(
      "update public.booking_assignees set completed_at = now() where membership_id = $1 and booking_id = $2",
      [who.membershipId, job],
    );
  }
}

const statusOf = async (job: string): Promise<string> =>
  (await api.sql<{ status: string }>("select status::text from public.bookings where id = $1", [job]))[0].status;

const statusChanges = (job: string) =>
  api.sql<{ status: string; reason: string }>(
    `select after ->> 'status' as status, after ->> 'reason' as reason
     from public.audit_log
     where entity = 'booking' and entity_id = $1 and action = 'status_change'
     order by created_at`,
    [job],
  );

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("job rules, write mode, real database", { timeout: 60_000 }, () => {
  it("the stack is the real one: syncJob reads a job through PostgREST", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const job = await jobFor(c, [anna], { startedMinutesAgo: 10, minutes: 120 });
    const res = await sync.syncJob(job, "test");
    expect(res, api.log()).not.toBeNull();
    expect(res?.after).toBe("confirmed");
  });

  /** 2026-10-26: Olha tapped Finish six minutes in; the other three were locked out. */
  it("an early finisher does not close the job on someone still working; the last one out does", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const bea = await addMember(api.sql, c.org, "employee", "Bea");
    const job = await jobFor(c, [anna, bea], { startedMinutesAgo: 30, minutes: 240 });

    await clockIn(c, anna, job, 30);
    await clockIn(c, bea, job, 28);
    await sync.syncJob(job, "clock_in");
    expect(await statusOf(job)).toBe("in_progress");

    await clockOut(anna, job, true);
    await sync.syncJob(job, "clock_out");
    expect(await statusOf(job)).toBe("in_progress");

    await clockOut(bea, job, true);
    await sync.syncJob(job, "clock_out");
    expect(await statusOf(job)).toBe("completed");

    expect(await statusChanges(job)).toEqual([
      { status: "in_progress", reason: "clock_in" },
      { status: "completed", reason: "clock_out" },
    ]);
  });

  /** 2026-11-03: stopping the clock used to be finishing the job, so a break closed it. */
  it("stopping the clock for a break does not finish the job", async () => {
    const c = await company();
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    const job = await jobFor(c, [olha], { startedMinutesAgo: 60, minutes: 240 });
    await clockIn(c, olha, job, 60);
    await sync.syncJob(job, "clock_in");
    await clockOut(olha, job, false);
    const res = await sync.syncJob(job, "clock_out");
    expect(res?.state.phase).toBe("on_break");
    expect(await statusOf(job)).toBe("in_progress");
  });

  /** 2026-10-27: Ivanna never clocked in; the job sat in progress from 12:30 to 10 PM. */
  it("a no-show holds the job open only until its window ends", async () => {
    const c = await company();
    const lori = await addMember(api.sql, c.org, "employee", "Came");
    const ivanna = await addMember(api.sql, c.org, "employee", "Never Came");

    const stillInWindow = await jobFor(c, [lori, ivanna], { startedMinutesAgo: 30, minutes: 240 });
    await clockIn(c, lori, stillInWindow, 30);
    await clockOut(lori, stillInWindow, true);
    const during = await sync.syncJob(stillInWindow, "clock_out");
    expect(during?.state.phase).toBe("finished_on_site");
    expect(during?.state.needs).toContain("no_show_decision");
    expect(await statusOf(stillInWindow)).toBe("in_progress");

    const came2 = await addMember(api.sql, c.org, "employee", "Came Too");
    const never2 = await addMember(api.sql, c.org, "employee", "Never Came Either");
    const windowOver = await jobFor(c, [came2, never2], { startedMinutesAgo: 300, minutes: 240 });
    await clockIn(c, came2, windowOver, 300);
    await clockOut(came2, windowOver, true);
    const after = await sync.syncJob(windowOver, "clock_out");
    expect(after?.state.noShows).toEqual([never2.membershipId]);
    expect(await statusOf(windowOver)).toBe("completed");
  });

  it("a job nobody tapped closes itself after the window and the company's grace, only if the company asked", async () => {
    const asks = await company({ autoCompleteHours: 1 });
    const doesNot = await company();
    const a = await addMember(api.sql, asks.org, "employee");
    const b = await addMember(api.sql, doesNot.org, "employee");
    const c = await addMember(api.sql, asks.org, "employee");
    // Ended three hours ago: past the one-hour grace.
    const due = await jobFor(asks, [a], { startedMinutesAgo: 300, minutes: 120 });
    const sameButNotAsked = await jobFor(doesNot, [b], { startedMinutesAgo: 300, minutes: 120 });
    // Ended twenty minutes ago: inside the grace.
    const tooSoon = await jobFor(asks, [c], { startedMinutesAgo: 140, minutes: 120 });

    const beat = await sync.syncLiveJobs();
    expect(beat.considered).toBeGreaterThanOrEqual(3);

    expect(await statusOf(due)).toBe("completed");
    expect(await statusOf(sameButNotAsked)).toBe("confirmed");
    expect(await statusOf(tooSoon)).toBe("confirmed");
    expect(await statusChanges(due)).toEqual([{ status: "completed", reason: "heartbeat" }]);
  });

  it("a late clock-in reopens a finished job, but not one an invoice already bills", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const bea = await addMember(api.sql, c.org, "employee", "Bea");

    const finish = async (who: Member) => {
      const job = await jobFor(c, [who], { startedMinutesAgo: 200, minutes: 120 });
      await clockIn(c, who, job, 200);
      await clockOut(who, job, true);
      await sync.syncJob(job, "clock_out");
      expect(await statusOf(job)).toBe("completed");
      return job;
    };

    const open = await finish(anna);
    await clockIn(c, anna, open, 1);
    await sync.syncJob(open, "clock_in");
    expect(await statusOf(open)).toBe("in_progress");

    const billed = await finish(bea);
    await api.sql(
      "insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents) values ($1, $2, $3, 'sent', 20000)",
      [c.org, c.client, billed],
    );
    await clockIn(c, bea, billed, 1);
    const res = await sync.syncJob(billed, "clock_in");
    // The rules see someone on site; the money has moved, so the status stays.
    expect(res?.state.status).toBe("in_progress");
    expect(await statusOf(billed)).toBe("completed");
  });

  it("a person's close is never overruled, even with someone on the clock", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const manager = await addMember(api.sql, c.org, "manager");
    const job = await jobFor(c, [anna], { startedMinutesAgo: 30, minutes: 240 });
    await clockIn(c, anna, job, 30);
    await api.sql("update public.bookings set closed_at = now(), closed_by = $2 where id = $1", [
      job,
      manager.membershipId,
    ]);
    await sync.syncJob(job, "manager_close");
    expect(await statusOf(job)).toBe("completed");
  });

  it("completing a job drafts its invoice once, when the company turned that on", async () => {
    const c = await company({ autoInvoice: true });
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const job = await jobFor(c, [anna], { startedMinutesAgo: 200, minutes: 120 });
    await clockIn(c, anna, job, 200);
    await clockOut(anna, job, true);
    await sync.syncJob(job, "clock_out");
    await sync.syncJob(job, "heartbeat"); // a second look must not draft a second invoice
    expect(await statusOf(job)).toBe("completed");
    const invoices = await api.sql<{ status: string; amount_cents: number }>(
      "select status::text, amount_cents from public.invoices where booking_id = $1",
      [job],
    );
    expect(invoices, api.log()).toEqual([{ status: "draft", amount_cents: 20000 }]);
  });
});

describe.skipIf(!hasPostgrest)("the 2 AM sweep, write mode, real database", { timeout: 60_000 }, () => {
  /**
   * src/lib/automations/job-lifecycle.ts. In write mode the sweep writes no
   * status of its own: it asks the rules about each due job. This is the
   * change that ships with the flag (commit cf2aa76).
   */
  it("closes a due job through the rules and leaves the rest alone", async () => {
    const { autoCompletePastBookings } = await import("@/lib/automations");
    const c = await company({ autoCompleteHours: 1 });
    const a = await addMember(api.sql, c.org, "employee");
    const b = await addMember(api.sql, c.org, "employee");
    const due = await jobFor(c, [a], { startedMinutesAgo: 400, minutes: 120 });
    const onTheClock = await jobFor(c, [b], { startedMinutesAgo: 400, minutes: 120 });
    await clockIn(c, b, onTheClock, 400);

    const result = await autoCompletePastBookings();
    expect(result.completed).toBeGreaterThanOrEqual(1);
    expect(await statusOf(due)).toBe("completed");
    // Someone still on the clock: not closed, not invoiced, by the sweep or the rules.
    expect(await statusOf(onTheClock)).not.toBe("completed");
    expect((await statusChanges(due)).map((r) => r.reason)).toEqual(["nightly_sweep"]);
  }, 60_000);
});

describe("the API stack itself", () => {
  // Skipping is for a laptop without the binary. In CI a skip would mean the
  // cutover's only end-to-end test quietly stopped running.
  it("is present wherever CI runs", () => {
    if (process.env.CI) expect(hasPostgrest, "run scripts/fetch-postgrest.mjs in the workflow").toBe(true);
  });
});

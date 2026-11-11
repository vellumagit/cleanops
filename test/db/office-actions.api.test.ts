/**
 * The office's actions, run for real, as the manager.
 *
 * The other half of what changes a job: a manager closing it, stopping
 * someone's clock, taking a no-show off the crew, fixing a timesheet,
 * changing the status by hand. Each runs unmodified against the real
 * database behind the real PostgREST (test/db/api.ts), signed in as the
 * person doing it, with a cleaner's real taps (field/jobs/actions.ts)
 * setting the scene.
 *
 * As in field-taps.api.test.ts, every scenario runs with the rules
 * shadowing and with the rules writing. Where the two are meant to differ
 * the test says so; everywhere else the job must end the same way.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async () => (await import("./next-stubs")).nextServer());

let api: Api;
let restoreEnv: () => void;
let field: typeof import("@/app/field/jobs/actions");
let needsYou: typeof import("@/app/app/needs-you-actions");
let timesheets: typeof import("@/app/app/timesheets/actions");
let bookings: typeof import("@/app/app/bookings/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  field = await import("@/app/field/jobs/actions");
  needsYou = await import("@/app/app/needs-you-actions");
  timesheets = await import("@/app/app/timesheets/actions");
  bookings = await import("@/app/app/bookings/actions");
}, 240_000);

afterAll(async () => {
  delete process.env.JOB_STATE_WRITE;
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

// ---------------------------------------------------------------------------

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
/** What a datetime-local input sends, in the company's zone (UTC here). */
const localInput = (iso: string) => iso.slice(0, 16);

/** Do something as this person: their cookies for the call, then let deferred work finish. */
async function as<T>(who: Member, act: () => Promise<T>): Promise<T> {
  request.cookies = api.sessionCookies(who.userId);
  try {
    return await act();
  } finally {
    await settle();
  }
}

const tap = (who: Member, what: "here" | "stop" | "done", job: string) =>
  as(who, () => {
    const form = new FormData();
    form.set("booking_id", job);
    return (what === "here" ? field.startJobAction : what === "stop" ? field.pauseJobAction : field.completeJobAction)(form);
  });

type Company = { org: string; client: string; manager: Member };

async function company(opts: { autoInvoice?: boolean } = {}): Promise<Company> {
  const org = await addOrg(api.sql, "Company");
  await api.sql(
    "update public.organizations set automations_enabled = true, timezone = 'UTC', automation_settings = $2::jsonb where id = $1",
    [org, JSON.stringify(opts.autoInvoice ? { auto_invoice_on_job_complete: { enabled: true } } : {})],
  );
  return { org, client: await addClient(api.sql, org), manager: await addMember(api.sql, org, "manager", "Manager") };
}

async function jobFor(
  c: Company,
  crew: Member[],
  opts: { startedMinutesAgo?: number; minutes?: number; status?: string } = {},
): Promise<string> {
  const id = await addBooking(api.sql, c.org, c.client, {
    scheduledAt: minutesAgo(opts.startedMinutesAgo ?? 30),
    durationMinutes: opts.minutes ?? 240,
    status: opts.status ?? "confirmed",
  });
  await api.sql("update public.bookings set total_cents = 20000 where id = $1", [id]);
  for (const m of crew) {
    await api.sql(
      `insert into public.booking_assignees (organization_id, booking_id, membership_id, acceptance_status)
       values ($1, $2, $3, 'accepted')`,
      [c.org, id, m.membershipId],
    );
  }
  return id;
}

const job$ = async (job: string) =>
  (
    await api.sql<{ status: string; closed: boolean; closed_by: string | null }>(
      "select status::text, closed_at is not null as closed, closed_by from public.bookings where id = $1",
      [job],
    )
  )[0];
const statusOf = async (job: string) => (await job$(job)).status;

const shiftsOf = async (who: Member, job: string) =>
  api.sql<{ id: string; state: string; minutes: number | null; needs_review: boolean }>(
    `select id, case when clock_out_at is null then 'open' else 'closed' end as state,
            round(extract(epoch from (clock_out_at - clock_in_at)) / 60)::int as minutes,
            coalesce(needs_review, false) as needs_review
     from public.time_entries where employee_id = $1 and booking_id = $2 order by clock_in_at, created_at`,
    [who.membershipId, job],
  );

const invoicesFor = (job: string) =>
  api.sql<{ status: string }>("select status::text from public.invoices where booking_id = $1", [job]);

const crewOf = async (job: string): Promise<string[]> =>
  (
    await api.sql<{ membership_id: string }>(
      "select membership_id from public.booking_assignees where booking_id = $1",
      [job],
    )
  ).map((r) => r.membership_id);

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest).each([
  ["with the rules shadowing (production until the cutover)", undefined],
  ["with the rules writing (production after it)", "1"],
] as const)("the office's actions, %s", { timeout: 90_000 }, (_label, flag) => {
  beforeEach(() => {
    if (flag) process.env.JOB_STATE_WRITE = flag;
    else delete process.env.JOB_STATE_WRITE;
  });

  describe("closing a job", () => {
    /**
     * "A person said it's over" is the one input the rules never overrule.
     * Closing does not stop anyone's clock: her hours are hers until she
     * stops them or the office does, and the job stays closed either way.
     */
    it("a manager can close a job with a clock still running; it stays closed and bills once", async () => {
      const c = await company({ autoInvoice: true });
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [anna]);
      await tap(anna, "here", job);

      expect(await as(c.manager, () => needsYou.closeJobAction(job)), api.log()).toEqual({ ok: true });
      expect(await job$(job)).toEqual({ status: "completed", closed: true, closed_by: c.manager.membershipId });
      expect((await shiftsOf(anna, job)).map((s) => s.state)).toEqual(["open"]);
      expect(await invoicesFor(job)).toEqual([{ status: "draft" }]);

      // She finishes afterwards: her clock stops, nothing reopens, nothing is billed twice.
      expect(await tap(anna, "done", job)).toEqual({ ok: true });
      expect((await shiftsOf(anna, job)).map((s) => s.state)).toEqual(["closed"]);
      expect(await statusOf(job)).toBe("completed");
      expect(await invoicesFor(job)).toHaveLength(1);
    });

    it("a late clock-in does not reopen a job a person closed", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const late = await addMember(api.sql, c.org, "employee", "Late");
      const job = await jobFor(c, [anna, late]);
      await tap(anna, "here", job);
      expect(await as(c.manager, () => needsYou.closeJobAction(job))).toEqual({ ok: true });
      expect(await tap(late, "here", job)).toEqual({ ok: true });
      expect(await job$(job)).toMatchObject({ status: "completed", closed: true });
    });

    /**
     * The contrast, and it is deliberate: a job that finished by itself (the
     * last cleaner tapped I'm done) was not closed by a person, so someone
     * coming back to it reopens it. Pressing Close on a job that is already
     * complete adds nothing; it does not turn it into a person's close.
     */
    it("a job that finished by itself reopens when someone clocks back in", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [anna]);
      await tap(anna, "here", job);
      await tap(anna, "done", job);
      expect(await job$(job)).toMatchObject({ status: "completed", closed: false });
      expect(await as(c.manager, () => needsYou.closeJobAction(job))).toEqual({ ok: true });
      expect(await job$(job)).toMatchObject({ status: "completed", closed: false });
      expect(await tap(anna, "here", job)).toEqual({ ok: true });
      expect(await statusOf(job)).toBe("in_progress");
    });

    it("a cleaner cannot close a job", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [anna]);
      await tap(anna, "here", job);
      const res = await as(anna, () => needsYou.closeJobAction(job));
      expect(res.ok).toBe(false);
      expect(await job$(job)).toMatchObject({ status: "in_progress", closed: false });
    });

    it("a manager cannot close another company's job, or one that was never confirmed", async () => {
      const c = await company();
      const other = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const theirs = await jobFor(c, [anna]);
      expect(await as(other.manager, () => needsYou.closeJobAction(theirs))).toEqual({
        ok: false,
        error: "Job not found.",
      });
      const bea = await addMember(api.sql, c.org, "employee", "Bea");
      const pending = await jobFor(c, [bea], { status: "pending" });
      expect(await as(c.manager, () => needsYou.closeJobAction(pending))).toEqual({
        ok: false,
        error: "Confirm this job before closing it.",
      });
      expect(await statusOf(theirs)).toBe("confirmed");
      expect(await statusOf(pending)).toBe("pending");
    });
  });

  describe("stopping someone's clock from Needs you", () => {
    it("closes her shift for review, marks her part done, and finishes the job if she was the last", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [anna], { startedMinutesAgo: 120 });
      await api.sql(
        "insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at) values ($1, $2, $3, $4)",
        [c.org, anna.membershipId, job, minutesAgo(120)],
      );
      await api.sql("update public.bookings set status = 'in_progress' where id = $1", [job]);
      const [open] = await shiftsOf(anna, job);

      const res = await as(c.manager, () => needsYou.clockOutAtAction(open.id, job, minutesAgo(30)));
      expect(res, api.log()).toEqual({ ok: true });
      expect(await shiftsOf(anna, job)).toEqual([
        { id: open.id, state: "closed", minutes: 90, needs_review: true },
      ]);
      expect(await statusOf(job)).toBe("completed");
    });

    it("leaves the job open while a teammate is still working", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const bea = await addMember(api.sql, c.org, "employee", "Bea");
      const job = await jobFor(c, [anna, bea], { startedMinutesAgo: 60 });
      await tap(anna, "here", job);
      await tap(bea, "here", job);
      const [open] = await shiftsOf(anna, job);
      // A minute from now: after her clock-in, whatever second this runs in.
      const at = new Date(Date.now() + 60_000).toISOString();
      expect(await as(c.manager, () => needsYou.clockOutAtAction(open.id, job, at))).toEqual({ ok: true });
      expect(await statusOf(job)).toBe("in_progress");
    });

    it("refuses a time before she clocked in, and refuses a cleaner", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [anna]);
      await tap(anna, "here", job);
      const [open] = await shiftsOf(anna, job);
      expect(await as(c.manager, () => needsYou.clockOutAtAction(open.id, job, minutesAgo(600)))).toEqual({
        ok: false,
        error: "That's before she clocked in.",
      });
      const byCleaner = await as(anna, () => needsYou.clockOutAtAction(open.id, job, new Date().toISOString()));
      expect(byCleaner.ok).toBe(false);
      expect((await shiftsOf(anna, job)).map((s) => s.state)).toEqual(["open"]);
    });
  });

  describe("taking a no-show off the job", () => {
    /** 2026-10-27: Ivanna never clocked in, and the job waited for her all evening. */
    it("with everyone who came finished, the job no longer waits for her", async () => {
      const c = await company();
      const came = await addMember(api.sql, c.org, "employee", "Came");
      const never = await addMember(api.sql, c.org, "employee", "Never Came");
      const job = await jobFor(c, [came, never]);
      await tap(came, "here", job);
      await tap(came, "done", job);
      // Still inside the window, so the job is waiting on the one who hasn't arrived.
      expect(await statusOf(job)).toBe("in_progress");

      const res = await as(c.manager, () => needsYou.removeMemberAction(job, never.membershipId));
      expect(res, api.log()).toEqual({ ok: true });
      expect(await crewOf(job)).toEqual([came.membershipId]);
      expect(await statusOf(job)).toBe("completed");
    });
  });

  describe("fixing a timesheet", () => {
    it("closing an open shift from Timesheets finishes the job when it was the last clock", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [anna], { startedMinutesAgo: 180 });
      await api.sql(
        "insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at) values ($1, $2, $3, $4)",
        [c.org, anna.membershipId, job, minutesAgo(180)],
      );
      await api.sql("update public.bookings set status = 'in_progress' where id = $1", [job]);
      const [open] = await shiftsOf(anna, job);

      const form = new FormData();
      form.set("id", open.id);
      form.set("end_at", localInput(minutesAgo(60)));
      expect(await as(c.manager, () => timesheets.closeOpenShiftAction(form)), api.log()).toEqual({ ok: true });
      const [closed] = await shiftsOf(anna, job);
      expect(closed.state).toBe("closed");
      expect(closed.minutes).toBeGreaterThanOrEqual(119);
      expect(closed.minutes).toBeLessThanOrEqual(121);
      expect(await statusOf(job)).toBe("completed");
    });

    /**
     * 2026-11-07: Iryna's shift was three minutes long because she tapped
     * I'm done by mistake. The office corrects the end time afterwards.
     */
    it("a shift that ended too early can be corrected, and the finished job stays finished", async () => {
      const c = await company();
      const iryna = await addMember(api.sql, c.org, "employee", "Iryna");
      const job = await jobFor(c, [iryna], { startedMinutesAgo: 300 });
      await api.sql(
        `insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at, clock_out_at)
         values ($1, $2, $3, $4, $5)`,
        [c.org, iryna.membershipId, job, minutesAgo(300), minutesAgo(297)],
      );
      await api.sql("update public.bookings set status = 'completed' where id = $1", [job]);
      await api.sql("update public.booking_assignees set completed_at = now() where booking_id = $1", [job]);
      const [short] = await shiftsOf(iryna, job);
      expect(short.minutes).toBe(3);

      const form = new FormData();
      form.set("id", short.id);
      form.set("employee_id", iryna.membershipId);
      form.set("booking_id", job);
      form.set("start_at", localInput(minutesAgo(300)));
      form.set("end_at", localInput(minutesAgo(60)));
      expect(await as(c.manager, () => timesheets.updateTimeEntryAction(form)), api.log()).toEqual({ ok: true });
      const [fixed] = await shiftsOf(iryna, job);
      expect(fixed.minutes).toBeGreaterThanOrEqual(239);
      expect(fixed.minutes).toBeLessThanOrEqual(241);
      expect(await statusOf(job)).toBe("completed");
    });

    it("a cleaner cannot edit anyone's hours", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [anna]);
      await tap(anna, "here", job);
      const [open] = await shiftsOf(anna, job);
      const form = new FormData();
      form.set("id", open.id);
      form.set("end_at", localInput(new Date().toISOString()));
      expect(await as(anna, () => timesheets.closeOpenShiftAction(form))).toEqual({
        ok: false,
        error: "Not authorized.",
      });
    });
  });

  describe("changing the status by hand", () => {
    const setStatus = (who: Member, job: string, status: string) =>
      as(who, () => {
        const form = new FormData();
        form.set("id", job);
        form.set("status", status);
        return bookings.setBookingStatusAction(form);
      });

    it("a job an invoice bills cannot be un-completed", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [anna]);
      await tap(anna, "here", job);
      await tap(anna, "done", job);
      await api.sql(
        "insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents) values ($1, $2, $3, 'sent', 20000)",
        [c.org, c.client, job],
      );
      const res = await setStatus(c.manager, job, "confirmed");
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/bills this job/);
      expect(await statusOf(job)).toBe("completed");
    });

    it("cancelling a job stops it being started", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [anna]);
      expect(await setStatus(c.manager, job, "cancelled"), api.log()).toEqual({ ok: true });
      expect(await statusOf(job)).toBe("cancelled");
      expect((await tap(anna, "here", job)).ok).toBe(false);
      expect(await shiftsOf(anna, job)).toEqual([]);
    });

    it("a cleaner cannot change a job's status", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [anna]);
      expect(await setStatus(anna, job, "cancelled")).toEqual({ ok: false, error: "Not authorized." });
      expect(await statusOf(job)).toBe("confirmed");
    });
  });

  describe("changing the crew", () => {
    const assign = (who: Member, job: string, primary: Member | null, additional: Member[]) =>
      as(who, () => {
        const form = new FormData();
        form.set("id", job);
        form.set("primary_id", primary?.membershipId ?? "");
        for (const m of additional) form.append("additional_ids", m.membershipId);
        return bookings.assignBookingCrewAction({}, form);
      });

    it("a manager can add a second cleaner, who can then start the job", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const bea = await addMember(api.sql, c.org, "employee", "Bea");
      const job = await jobFor(c, []);
      const res = await assign(c.manager, job, anna, [bea]);
      expect(res.error, api.log()).toBeUndefined();
      expect((await crewOf(job)).sort()).toEqual([anna.membershipId, bea.membershipId].sort());
      // Assigned by the office, she still has to say yes; the lead starting makes that moot.
      await api.sql("update public.booking_assignees set acceptance_status = 'accepted' where booking_id = $1", [job]);
      expect(await tap(bea, "here", job)).toEqual({ ok: true });
    });

    it("refuses to put a cleaner on two jobs at once, and changes nothing", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      await jobFor(c, [anna], { startedMinutesAgo: 30, minutes: 240 });
      const clash = await jobFor(c, [], { startedMinutesAgo: 10, minutes: 120 });
      const res = await assign(c.manager, clash, anna, []);
      expect(res.error, "an overlap must be refused").toBeTruthy();
      expect(await crewOf(clash)).toEqual([]);
    });
  });
});

/**
 * The last four paths from the finish plan's seam list, run for real.
 *
 *   - a tap replayed from the phone's offline queue
 *   - a split shift (a hand-off between two cleaners)
 *   - declining or cancelling a shift
 *   - completing a job through the public API
 *
 * Same stack as field-taps and office-actions (test/db/api.ts).
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
// The API route needs the real NextRequest/NextResponse; only after() is stood in for.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));

let api: Api;
let restoreEnv: () => void;
let field: typeof import("@/app/field/jobs/actions");
let route: typeof import("@/app/api/v1/bookings/[id]/route");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  field = await import("@/app/field/jobs/actions");
  route = await import("@/app/api/v1/bookings/[id]/route");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

// ---------------------------------------------------------------------------

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function as<T>(who: Member, act: () => Promise<T>): Promise<T> {
  request.cookies = api.sessionCookies(who.userId);
  try {
    return await act();
  } finally {
    await settle();
  }
}

/** A tap as the phone sends it, `tappedAt` included when it came from the queue. */
const tap = (who: Member, what: "here" | "stop" | "done", job: string, tappedAt?: string) =>
  as(who, () => {
    const form = new FormData();
    form.set("booking_id", job);
    if (tappedAt) form.set("tapped_at", tappedAt);
    return (what === "here" ? field.startJobAction : what === "stop" ? field.pauseJobAction : field.completeJobAction)(
      form,
    );
  });

type Company = { org: string; client: string; manager: Member };

async function company(settings: Record<string, { enabled: boolean }> = {}): Promise<Company> {
  const org = await addOrg(api.sql, "Company");
  await api.sql(
    "update public.organizations set automations_enabled = true, timezone = 'UTC', automation_settings = $2::jsonb where id = $1",
    [org, JSON.stringify(settings)],
  );
  return { org, client: await addClient(api.sql, org), manager: await addMember(api.sql, org, "manager", "Manager") };
}

type Seat = { who: Member; offset?: number; minutes?: number; pending?: boolean };

async function jobFor(
  c: Company,
  seats: Seat[],
  opts: { startedMinutesAgo?: number; minutes?: number; status?: string } = {},
): Promise<string> {
  const id = await addBooking(api.sql, c.org, c.client, {
    scheduledAt: minutesAgo(opts.startedMinutesAgo ?? 30),
    durationMinutes: opts.minutes ?? 240,
    status: opts.status ?? "confirmed",
  });
  await api.sql("update public.bookings set total_cents = 20000 where id = $1", [id]);
  for (const [i, s] of seats.entries()) {
    await api.sql(
      `insert into public.booking_assignees
         (organization_id, booking_id, membership_id, is_primary, acceptance_status,
          split_index, split_start_offset_minutes, split_duration_minutes)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        c.org,
        id,
        s.who.membershipId,
        i === 0,
        s.pending ? "pending" : "accepted",
        s.offset == null ? null : i,
        s.offset ?? null,
        s.minutes ?? null,
      ],
    );
  }
  if (seats[0]) await api.sql("update public.bookings set assigned_to = $2 where id = $1", [id, seats[0].who.membershipId]);
  return id;
}

const statusOf = async (job: string) =>
  (await api.sql<{ status: string }>("select status::text from public.bookings where id = $1", [job]))[0].status;

const shiftsOf = (who: Member, job: string) =>
  api.sql<{ state: string; started: string; ended: string | null }>(
    `select case when clock_out_at is null then 'open' else 'closed' end as state,
            clock_in_at::text as started, clock_out_at::text as ended
     from public.time_entries where employee_id = $1 and booking_id = $2 order by clock_in_at, created_at`,
    [who.membershipId, job],
  );

const crewOf = async (job: string) =>
  (await api.sql<{ membership_id: string }>("select membership_id from public.booking_assignees where booking_id = $1", [job])).map(
    (r) => r.membership_id,
  );

const near = (iso: string | null, expected: string, toleranceMs = 2_000) =>
  iso != null && Math.abs(new Date(iso).getTime() - new Date(expected).getTime()) <= toleranceMs;

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("the last seams", { timeout: 90_000 }, () => {

  describe("a tap replayed from the phone's offline queue", () => {
    /** A basement with no signal: both taps sit on the phone and go up together. */
    it("keeps the times she tapped, not the time the signal came back", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [{ who: anna }], { startedMinutesAgo: 60 });
      const arrived = minutesAgo(50);
      const left = minutesAgo(5);
      expect(await tap(anna, "here", job, arrived), api.log()).toEqual({ ok: true });
      expect(await tap(anna, "done", job, left)).toEqual({ ok: true });
      const [s] = await shiftsOf(anna, job);
      expect(near(s.started, arrived)).toBe(true);
      expect(near(s.ended, left)).toBe(true);
      expect(await statusOf(job)).toBe("completed");
    });

    /** The send went through, the answer didn't, the phone tries again. */
    it("the same tap sent twice opens one shift and closes it once", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [{ who: anna }]);
      const at = minutesAgo(20);
      await tap(anna, "here", job, at);
      await tap(anna, "here", job, at);
      const left = minutesAgo(2);
      await tap(anna, "done", job, left);
      await tap(anna, "done", job, left);
      expect((await shiftsOf(anna, job)).map((s) => s.state)).toEqual(["closed"]);
    });

    it("a saved 'I'm here' older than the shift she is on now is refused, and recorded", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const first = await jobFor(c, [{ who: anna }], { startedMinutesAgo: 120, minutes: 60 });
      const second = await jobFor(c, [{ who: anna }], { startedMinutesAgo: 30, minutes: 120 });
      await tap(anna, "here", second, minutesAgo(25));
      // From before she started the second job, delivered only now.
      const late = await tap(anna, "here", first, minutesAgo(110));
      expect(late.ok).toBe(false);
      expect((await shiftsOf(anna, first)).length).toBe(0);
      expect((await shiftsOf(anna, second)).map((s) => s.state)).toEqual(["open"]);
      const [r] = await api.sql<{ reason: string }>(
        "select after ->> 'reason' as reason from public.audit_log where entity_id = $1 and action = 'refused'",
        [first],
      );
      expect(r?.reason).toBe("stale_tap");
    });

    it("a saved 'I'm done' from before she clocked back in does not stop her new shift", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [{ who: anna }], { startedMinutesAgo: 90 });
      await tap(anna, "here", job, minutesAgo(80));
      await tap(anna, "stop", job, minutesAgo(60));
      await tap(anna, "here", job, minutesAgo(40));
      // An old "done" from before the break, arriving late.
      expect(await tap(anna, "done", job, minutesAgo(70))).toEqual({ ok: true });
      expect((await shiftsOf(anna, job)).map((s) => s.state)).toEqual(["closed", "open"]);
      expect(await statusOf(job)).toBe("in_progress");
    });

    it("a tap time from more than twelve hours ago, or from the future, is not believed", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const bea = await addMember(api.sql, c.org, "employee", "Bea");
      const job = await jobFor(c, [{ who: anna }, { who: bea }]);
      const before = Date.now();
      await tap(anna, "here", job, minutesAgo(13 * 60));
      await tap(bea, "here", job, new Date(Date.now() + 30 * 60_000).toISOString());
      for (const who of [anna, bea]) {
        const [s] = await shiftsOf(who, job);
        expect(new Date(s.started).getTime()).toBeGreaterThanOrEqual(before - 1_000);
      }
    });
  });

  describe("a split shift", () => {
    /** Four hours each, back to back: Anna opens, Bea closes. */
    it("the first half finishing does not close the job; the second half does", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const bea = await addMember(api.sql, c.org, "employee", "Bea");
      const job = await jobFor(
        c,
        [
          { who: anna, offset: 0, minutes: 240 },
          { who: bea, offset: 240, minutes: 240 },
        ],
        { startedMinutesAgo: 300, minutes: 480 },
      );
      await tap(anna, "here", job, minutesAgo(298));
      await tap(anna, "done", job, minutesAgo(62));
      // Bea's half runs until three hours from now.
      expect(await statusOf(job)).toBe("in_progress");

      await tap(bea, "here", job, minutesAgo(60));
      expect(await statusOf(job)).toBe("in_progress");
      await tap(bea, "done", job);
      expect(await statusOf(job)).toBe("completed");
    });

    it("a cleaner's later half does not clash with her own earlier job", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const bea = await addMember(api.sql, c.org, "employee", "Bea");
      // Bea has another job for the first three hours.
      await jobFor(c, [{ who: bea }], { startedMinutesAgo: -60, minutes: 180 });
      const handOff = await jobFor(c, [{ who: anna, offset: 0, minutes: 240 }], { startedMinutesAgo: -60, minutes: 480 });
      const add = (offset: number | null, minutes: number | null) =>
        api.sql(
          `insert into public.booking_assignees
             (organization_id, booking_id, membership_id, split_index, split_start_offset_minutes, split_duration_minutes)
           values ($1, $2, $3, 1, $4, $5) returning id`,
          [c.org, handOff, bea.membershipId, offset, minutes],
        );
      // On the whole window she would overlap her other job, so that is refused...
      await expect(add(null, null)).rejects.toThrow(/overlapping booking/);
      // ...and her own second half, starting after it, is not.
      expect(await add(240, 240)).toHaveLength(1);
    });
  });

  describe("declining or cancelling a shift", () => {
    it("declining a shift she never accepted takes her off it and hands the lead on", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const bea = await addMember(api.sql, c.org, "employee", "Bea");
      const job = await jobFor(c, [{ who: anna, pending: true }, { who: bea }], { startedMinutesAgo: -24 * 60 });
      expect(await as(anna, () => field.declineShiftAction(job)), api.log()).toEqual({ ok: true });
      expect(await crewOf(job)).toEqual([bea.membershipId]);
      const [b] = await api.sql<{ assigned_to: string | null }>("select assigned_to from public.bookings where id = $1", [job]);
      expect(b.assigned_to).toBe(bea.membershipId);
      expect(await statusOf(job)).toBe("confirmed");
    });

    it("someone not on the shift cannot decline it", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const stranger = await addMember(api.sql, c.org, "employee", "Stranger");
      const job = await jobFor(c, [{ who: anna }], { startedMinutesAgo: -24 * 60 });
      expect(await as(stranger, () => field.declineShiftAction(job))).toEqual({
        ok: false,
        error: "This shift isn't assigned to you.",
      });
      expect(await crewOf(job)).toEqual([anna.membershipId]);
    });

    /**
     * The job page offers "Cancel shift" and "Call in sick" until the job is
     * complete, including while she is on the clock. Taking her off the crew
     * then would leave her clock running on a job that no longer lists her,
     * where "I'm done" answers "This job isn't assigned to you".
     */
    it("a cleaner on the clock cannot cancel herself off the job", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [{ who: anna }]);
      await tap(anna, "here", job);
      for (const act of [
        () => field.cancelShiftAction(job, "car broke down"),
        () => field.callInSickAction(job),
        () => field.declineShiftAction(job),
      ]) {
        const res = await as(anna, act);
        expect(res.ok).toBe(false);
      }
      expect(await crewOf(job)).toEqual([anna.membershipId]);
      expect(await tap(anna, "done", job)).toEqual({ ok: true });
      expect(await statusOf(job)).toBe("completed");
    });

    it("a cleaner who already worked part of the job cannot cancel herself off it either", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [{ who: anna }]);
      await tap(anna, "here", job);
      await tap(anna, "stop", job);
      expect((await as(anna, () => field.callInSickAction(job))).ok).toBe(false);
      expect(await crewOf(job)).toEqual([anna.membershipId]);
    });
  });

  describe("completing a job through the public API", () => {
    async function apiKey(org: string): Promise<string> {
      const { generateApiKey } = await import("@/lib/api-keys");
      const { rawKey, keyHash, keyPrefix } = generateApiKey();
      await api.sql(
        "insert into public.api_keys (organization_id, label, key_hash, key_prefix) values ($1, 'Zapier', $2, $3)",
        [org, keyHash, keyPrefix],
      );
      return rawKey;
    }

    const patch = async (key: string, job: string, body: Record<string, unknown>) => {
      const res = await route.PATCH(
        new NextRequest(`http://localhost/api/v1/bookings/${job}`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: job }) },
      );
      await settle();
      return { status: res.status, body: (await res.json()) as { error?: string; data?: { status?: string } } };
    };

    it("marks it complete as a person's close: it stays closed, and bills once", async () => {
      const c = await company({ auto_invoice_on_job_complete: { enabled: true } });
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const late = await addMember(api.sql, c.org, "employee", "Late");
      const job = await jobFor(c, [{ who: anna }, { who: late }], { startedMinutesAgo: 60 });
      await tap(anna, "here", job);
      const key = await apiKey(c.org);

      const res = await patch(key, job, { status: "completed" });
      expect(res, api.log()).toMatchObject({ status: 200, body: { data: { status: "completed" } } });
      const [b] = await api.sql<{ closed: boolean }>("select closed_at is not null as closed from public.bookings where id = $1", [job]);
      expect(b.closed).toBe(true);
      expect(await api.sql("select id from public.invoices where booking_id = $1", [job])).toHaveLength(1);

      // A late arrival does not reopen it, and finishing does not bill it again.
      await tap(late, "here", job);
      await tap(anna, "done", job);
      expect(await statusOf(job)).toBe("completed");
      expect(await api.sql("select id from public.invoices where booking_id = $1", [job])).toHaveLength(1);
      const [audit] = await api.sql<{ via: string }>(
        "select after ->> 'via' as via from public.audit_log where entity_id = $1 and action = 'status_change' and after ->> 'via' = 'api'",
        [job],
      );
      expect(audit?.via).toBe("api");
    });

    it("refuses to complete a job days in the future", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [{ who: anna }], { startedMinutesAgo: -3 * 24 * 60 });
      const res = await patch(await apiKey(c.org), job, { status: "completed" });
      expect(res.status).toBe(400);
      expect(await statusOf(job)).toBe("confirmed");
    });

    it("refuses to un-complete a job an invoice bills", async () => {
      const c = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [{ who: anna }], { startedMinutesAgo: 300, minutes: 120 });
      await tap(anna, "here", job, minutesAgo(290));
      await tap(anna, "done", job, minutesAgo(180));
      await api.sql(
        "insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents) values ($1, $2, $3, 'sent', 20000)",
        [c.org, c.client, job],
      );
      const res = await patch(await apiKey(c.org), job, { status: "confirmed" });
      expect(res.status).toBe(409);
      expect(await statusOf(job)).toBe("completed");
    });

    it("another company's key cannot touch the job, and a revoked key cannot touch anything", async () => {
      const c = await company();
      const other = await company();
      const anna = await addMember(api.sql, c.org, "employee", "Anna");
      const job = await jobFor(c, [{ who: anna }], { startedMinutesAgo: 60 });
      const theirs = await patch(await apiKey(other.org), job, { status: "completed" });
      expect(theirs.status).toBeGreaterThanOrEqual(400);
      expect(await statusOf(job)).toBe("confirmed");

      const key = await apiKey(c.org);
      await api.sql("update public.api_keys set revoked_at = now() where organization_id = $1", [c.org]);
      expect((await patch(key, job, { status: "completed" })).status).toBe(401);
      expect(await statusOf(job)).toBe("confirmed");
    });
  });
});

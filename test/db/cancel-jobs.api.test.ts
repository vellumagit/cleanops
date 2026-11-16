/**
 * Cancelling a job, through each of its five doors.
 *
 * Until 2026-11-15 each door wrote `status: "cancelled"` itself and did a
 * different subset of what a cancel owes. They all go through
 * src/lib/cancel-jobs.ts now. These run each door unmodified against the
 * real database behind the real PostgREST and check the same three things
 * every time: the job is cancelled, it has exactly one history row naming
 * the door, and a job the door must not touch is left alone. Where a door
 * owes the crew a "Job cancelled" push, that is counted too.
 *
 * The last test is the guard: no other file may write "cancelled" to a
 * booking, so a sixth door cannot appear without failing here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
let bookings: typeof import("@/app/app/bookings/actions");
let requests: typeof import("@/app/app/bookings/requests/client-job-request-actions");
let portal: typeof import("@/app/client/(portal)/jobs/[id]/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  bookings = await import("@/app/app/bookings/actions");
  requests = await import("@/app/app/bookings/requests/client-job-request-actions");
  portal = await import("@/app/client/(portal)/jobs/[id]/actions");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

const daysOut = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

async function asUser<T>(userId: string, act: () => Promise<T>): Promise<T> {
  request.cookies = api.sessionCookies(userId);
  try {
    return await act();
  } finally {
    await settle();
  }
}

type Company = { org: string; client: string; manager: Member; cleaner: Member };

async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Cancel Co");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  return {
    org,
    client: await addClient(api.sql, org),
    manager: await addMember(api.sql, org, "manager", "Manager"),
    cleaner: await addMember(api.sql, org, "employee", "Cleaner"),
  };
}

async function job(c: Company, opts: { at?: string; status?: string; series?: string } = {}): Promise<string> {
  const id = await addBooking(api.sql, c.org, c.client, {
    scheduledAt: opts.at ?? daysOut(10),
    durationMinutes: 120,
    status: opts.status ?? "confirmed",
  });
  if (opts.series) await api.sql("update public.bookings set series_id = $2 where id = $1", [id, opts.series]);
  await api.sql(
    `insert into public.booking_assignees (organization_id, booking_id, membership_id, acceptance_status)
     values ($1, $2, $3, 'accepted')`,
    [c.org, id, c.cleaner.membershipId],
  );
  return id;
}

const statusOf = async (id: string) =>
  (await api.sql<{ status: string }>("select status::text from public.bookings where id = $1", [id]))[0].status;

/** The cancel history rows for a job: who, from what, through which door. */
const history = (id: string) =>
  api.sql<{ actor_id: string | null; was: string | null; via: string | null }>(
    `select actor_id, before->>'status' as was, after->>'via' as via
       from public.audit_log
      where entity = 'booking' and entity_id = $1 and action = 'status_change' and after->>'status' = 'cancelled'`,
    [id],
  );

/** How many "Job cancelled" notices this cleaner has been sent. */
const cancelPushes = async (c: Company) =>
  Number(
    (
      await api.sql<{ n: string }>(
        "select count(*)::text as n from public.notifications where organization_id = $1 and recipient_membership_id = $2 and title = 'Job cancelled'",
        [c.org, c.cleaner.membershipId],
      )
    )[0].n,
  );

async function skipRequest(c: Company, bookingId: string): Promise<string> {
  const [req] = await api.sql<{ id: string }>(
    `insert into public.client_job_requests (organization_id, client_id, booking_id, kind, status, occurrence_date)
     values ($1, $2, $3, 'skip_occurrence', 'open', current_date) returning id`,
    [c.org, c.client, bookingId],
  );
  return req.id;
}

const requestStatus = async (id: string) =>
  (await api.sql<{ status: string }>("select status from public.client_job_requests where id = $1", [id]))[0].status;

const approve = (c: Company, requestId: string) => {
  const form = new FormData();
  form.set("request_id", requestId);
  form.set("accept", "1");
  return asUser(c.manager.userId, () => requests.resolveClientSkipAction({}, form));
};

describe.skipIf(!hasPostgrest)("cancelling a job: five doors, one path", () => {
  it("the office's status dropdown", async () => {
    const c = await company();
    const id = await job(c);
    const form = new FormData();
    form.set("id", id);
    form.set("status", "cancelled");
    const res = await asUser(c.manager.userId, () => bookings.setBookingStatusAction(form));
    expect(res).toEqual({ ok: true });
    expect(await statusOf(id)).toBe("cancelled");
    expect(await history(id)).toEqual([{ actor_id: c.manager.membershipId, was: "confirmed", via: "status_set" }]);
    // The crew is told, once.
    expect(await cancelPushes(c)).toBe(1);
  });

  it("the dropdown, cancelling a job a manager had closed: no longer closed by anyone", async () => {
    const c = await company();
    const id = await job(c, { at: daysOut(-2), status: "completed" });
    await api.sql("update public.bookings set closed_at = now(), closed_by = $2 where id = $1", [
      id,
      c.manager.membershipId,
    ]);
    const form = new FormData();
    form.set("id", id);
    form.set("status", "cancelled");
    const res = await asUser(c.manager.userId, () => bookings.setBookingStatusAction(form));
    expect(res).toEqual({ ok: true });
    const [row] = await api.sql<{ status: string; closed: boolean; closed_by: string | null }>(
      "select status::text, closed_at is not null as closed, closed_by from public.bookings where id = $1",
      [id],
    );
    expect(row).toEqual({ status: "cancelled", closed: false, closed_by: null });
    expect((await history(id)).map((h) => h.was)).toEqual(["completed"]);
    // Correcting the record of a job that already happened is not news.
    expect(await cancelPushes(c)).toBe(0);
  });

  it("ending a series: future visits cancelled, a finished one and a past one left alone", async () => {
    const c = await company();
    const [series] = await api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes)
       values ($1, $2, 'weekly', '09:00', current_date, 120) returning id`,
      [c.org, c.client],
    );
    const next = await job(c, { at: daysOut(7), series: series.id });
    const later = await job(c, { at: daysOut(14), status: "pending", series: series.id });
    const done = await job(c, { at: daysOut(-7), status: "completed", series: series.id });
    const missed = await job(c, { at: daysOut(-1), series: series.id });

    const form = new FormData();
    form.set("series_id", series.id);
    await asUser(c.manager.userId, () => bookings.cancelSeriesAction(form)).catch((e) => {
      if (!/redirected to/.test(String(e))) throw e;
    });
    await settle();

    expect(await statusOf(next)).toBe("cancelled");
    expect(await statusOf(later)).toBe("cancelled");
    expect(await statusOf(done)).toBe("completed");
    expect(await statusOf(missed)).toBe("confirmed");
    expect(await history(next)).toEqual([{ actor_id: c.manager.membershipId, was: "confirmed", via: "cancel_series" }]);
    expect(await history(later)).toEqual([{ actor_id: c.manager.membershipId, was: "pending", via: "cancel_series" }]);
    expect(await history(done)).toEqual([]);
    const [s] = await api.sql<{ active: boolean }>("select active from public.booking_series where id = $1", [series.id]);
    expect(s.active).toBe(false);
    // One push per cancelled visit, none for the two left alone.
    expect(await cancelPushes(c)).toBe(2);
  });

  it("ending a series is the office's call: a cleaner on one visit cancels nothing", async () => {
    const c = await company();
    const [series] = await api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes)
       values ($1, $2, 'weekly', '09:00', current_date, 120) returning id`,
      [c.org, c.client],
    );
    const next = await job(c, { at: daysOut(7), series: series.id });
    const form = new FormData();
    form.set("series_id", series.id);
    await asUser(c.cleaner.userId, () => bookings.cancelSeriesAction(form)).catch(() => undefined);
    expect(await statusOf(next)).toBe("confirmed");
    expect(await history(next)).toEqual([]);
  });

  it("archiving a client: open visits cancelled, the crew told only about the ones still ahead", async () => {
    const c = await company();
    const upcoming = await job(c, { at: daysOut(5) });
    const missed = await job(c, { at: daysOut(-1) });
    const done = await job(c, { at: daysOut(-3), status: "completed" });
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const { sweepArchivedClient } = await import("@/lib/client-offboarding");
    const result = await sweepArchivedClient(createSupabaseAdminClient(), {
      organizationId: c.org,
      clientId: c.client,
    } as never);
    await settle();
    expect([...result.cancelledBookingIds].sort()).toEqual([upcoming, missed].sort());
    expect(await statusOf(upcoming)).toBe("cancelled");
    expect(await statusOf(missed)).toBe("cancelled");
    expect(await statusOf(done)).toBe("completed");
    expect(await history(upcoming)).toEqual([{ actor_id: null, was: "confirmed", via: "client_archived" }]);
    expect(await history(missed)).toEqual([{ actor_id: null, was: "confirmed", via: "client_archived" }]);
    // Nobody needs a push about yesterday's visit.
    expect(await cancelPushes(c)).toBe(1);
  });

  async function portalClient(c: Company): Promise<string> {
    const [user] = await api.sql<{ id: string }>(
      "insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id",
      [`portal${Date.now()}${Math.random().toString(36).slice(2, 7)}@example.test`, JSON.stringify({ full_name: "Portal Client" })],
    );
    await api.sql("update public.clients set profile_id = $2 where id = $1", [c.client, user.id]);
    return user.id;
  }

  it("the client's own skip, far enough out: cancelled, and the request is closed", async () => {
    const c = await company();
    const userId = await portalClient(c);
    const id = await job(c, { at: daysOut(10) });
    const form = new FormData();
    form.set("booking_id", id);
    form.set("reason", "Away that week");
    const res = await asUser(userId, () => portal.requestSkipAction({}, form));
    expect((res as { error?: string }).error).toBeUndefined();
    expect(await statusOf(id)).toBe("cancelled");
    expect(await history(id)).toEqual([{ actor_id: null, was: "confirmed", via: "client_skip" }]);
    const reqs = await api.sql<{ status: string; auto_applied: boolean }>(
      "select status, auto_applied from public.client_job_requests where booking_id = $1",
      [id],
    );
    expect(reqs).toEqual([{ status: "resolved", auto_applied: true }]);
    // The job's history says who really did it, not "Sollos".
    const { loadJobTimeline } = await import("@/lib/job-sync");
    const lines = (await loadJobTimeline(id, c.org)).map((e) => e.text);
    expect(lines).toContain("Cancelled: the client skipped this visit");
    // This door words its own notice to the crew; the standard one is not sent as well.
    expect(await cancelPushes(c)).toBe(0);
  });

  it("the office approving a client's skip", async () => {
    const c = await company();
    const id = await job(c, { at: daysOut(1) });
    const req = await skipRequest(c, id);
    const res = await approve(c, req);
    expect((res as { error?: string }).error).toBeUndefined();
    expect(await statusOf(id)).toBe("cancelled");
    expect(await history(id)).toEqual([
      { actor_id: c.manager.membershipId, was: "confirmed", via: "client_skip_approved" },
    ]);
    expect(await requestStatus(req)).toBe("resolved");
  });

  it("approving a skip for a visit already finished is refused in words, and the request stays open", async () => {
    const c = await company();
    const id = await job(c, { at: daysOut(-1), status: "completed" });
    const req = await skipRequest(c, id);
    const res = await approve(c, req);
    expect((res as { error?: string }).error).toMatch(/already finished/);
    expect(await statusOf(id)).toBe("completed");
    expect(await history(id)).toEqual([]);
    expect(await requestStatus(req)).toBe("open");
  });

  it("approving a skip for a visit under way is refused the same way", async () => {
    const c = await company();
    const id = await job(c, { at: daysOut(0), status: "in_progress" });
    const req = await skipRequest(c, id);
    const res = await approve(c, req);
    expect((res as { error?: string }).error).toMatch(/already under way/);
    expect(await statusOf(id)).toBe("in_progress");
    expect(await requestStatus(req)).toBe("open");
  });

  it("approving a skip for a visit someone already cancelled just answers the request", async () => {
    const c = await company();
    const id = await job(c, { at: daysOut(2), status: "cancelled" });
    const req = await skipRequest(c, id);
    const res = await approve(c, req);
    expect((res as { error?: string }).error).toBeUndefined();
    expect(await history(id)).toEqual([]);
    expect(await requestStatus(req)).toBe("resolved");
  });

  it("cancelJobs leaves another company's job alone", async () => {
    const mine = await company();
    const theirs = await company();
    const id = await job(theirs);
    const { cancelJobs } = await import("@/lib/cancel-jobs");
    const res = await cancelJobs({
      organizationId: mine.org,
      bookingIds: [id],
      fromStatuses: ["pending", "confirmed"],
      via: "status_set",
      syncReason: "status_set",
      actorId: mine.manager.membershipId,
      calendars: "all",
      notices: "none",
    });
    expect(res).toEqual({ cancelled: [] });
    expect(await statusOf(id)).toBe("confirmed");
  });
});

// ---------------------------------------------------------------------------
// The guard. No database needed: it reads the source.

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

// `.from("bookings")` followed, within the same statement, by an update
// whose object sets status to the literal "cancelled".
const CANCEL_WRITE =
  /\.from\(\s*["']bookings["'](?:\s+as\s+never)?\s*\)\s*\.update\(\s*\{[^}]*\bstatus:\s*["']cancelled["']/;

describe("one place cancels a job", () => {
  it("nothing outside cancel-jobs.ts writes cancelled to a booking", () => {
    const root = join(__dirname, "..", "..", "src");
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      const rel = file.slice(root.length + 1).replace(/\\/g, "/");
      if (rel === "lib/cancel-jobs.ts") continue;
      if (CANCEL_WRITE.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
    expect(offenders, "cancel a job through cancelJobs() in src/lib/cancel-jobs.ts").toEqual([]);
  });

  it("the guard recognises the write it allows, and the shapes the old doors used", () => {
    const src = readFileSync(join(__dirname, "..", "..", "src", "lib", "cancel-jobs.ts"), "utf8");
    expect(CANCEL_WRITE.test(src)).toBe(true);
    // As ending a series and the client's skip wrote it.
    expect(CANCEL_WRITE.test('await admin\n      .from("bookings")\n      .update({ status: "cancelled" })\n      .eq("id", id)')).toBe(true);
    // As archiving a client wrote it.
    expect(
      CANCEL_WRITE.test('admin\n          .from("bookings")\n          .update({ status: "cancelled" } as never)'),
    ).toBe(true);
    // With other fields ahead of it.
    expect(
      CANCEL_WRITE.test(".from('bookings' as never).update({\n  closed_at: null,\n  status: 'cancelled',\n})"),
    ).toBe(true);
    // Reading, or writing something else, is not a cancel.
    expect(CANCEL_WRITE.test('.from("bookings").select("id").eq("status", "cancelled")')).toBe(false);
    expect(CANCEL_WRITE.test('.from("job_offers").update({ status: "cancelled" })')).toBe(false);
  });
});

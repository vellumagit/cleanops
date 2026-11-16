/**
 * A cleaner's taps, run for real, as her.
 *
 * The buttons on a cleaner's phone call the server actions in
 * src/app/field/jobs/actions.ts. Here those actions run unmodified: the
 * app's own server client signs in from a session cookie, her membership is
 * resolved the way a request resolves it, every read and write of hers goes
 * through PostgREST under row-level security, and the admin-client writes
 * and the job rules behind them hit the same real database.
 *
 * Only the framework is stood in for: cookies and headers (there is no
 * request), revalidatePath and after() (there is no render).
 *
 * Until the 2026-11-14 cutover every scenario ran twice, with the rules
 * shadowing and writing, and ended the same way both times. Since then the
 * rules are the only writer.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async () => (await import("./next-stubs")).nextServer());

type FieldActions = typeof import("@/app/field/jobs/actions");
type Result = { ok: true } | { ok: false; error: string };

let api: Api;
let restoreEnv: () => void;
let actions: FieldActions;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  actions = await import("@/app/field/jobs/actions");
}, 180_000);

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

type Tap = "here" | "stop" | "done";

/** One tap on her phone: sign in as her, call the action the button calls. */
async function tap(who: Member, what: Tap, job: string): Promise<Result> {
  request.cookies = api.sessionCookies(who.userId);
  const form = new FormData();
  form.set("booking_id", job);
  const action =
    what === "here" ? actions.startJobAction : what === "stop" ? actions.pauseJobAction : actions.completeJobAction;
  const result = await action(form);
  await settle();
  return result;
}

type Company = { org: string; client: string };

async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Company");
  await api.sql("update public.organizations set automations_enabled = true where id = $1", [org]);
  return { org, client: await addClient(api.sql, org) };
}

async function jobFor(
  c: Company,
  crew: Member[],
  opts: { startedMinutesAgo?: number; minutes?: number; status?: string; pending?: Member[] } = {},
): Promise<string> {
  const id = await addBooking(api.sql, c.org, c.client, {
    scheduledAt: minutesAgo(opts.startedMinutesAgo ?? 10),
    durationMinutes: opts.minutes ?? 240,
    status: opts.status ?? "confirmed",
  });
  await api.sql("update public.bookings set total_cents = 20000 where id = $1", [id]);
  for (const m of crew) {
    await api.sql(
      `insert into public.booking_assignees (organization_id, booking_id, membership_id, acceptance_status)
       values ($1, $2, $3, $4)`,
      [c.org, id, m.membershipId, opts.pending?.includes(m) ? "pending" : "accepted"],
    );
  }
  return id;
}

const statusOf = async (job: string): Promise<string> =>
  (await api.sql<{ status: string }>("select status::text from public.bookings where id = $1", [job]))[0].status;

/** Her shifts on a job, oldest first: "open" or "closed". */
const shiftsOf = async (who: Member, job: string): Promise<string[]> =>
  (
    await api.sql<{ state: string }>(
      `select case when clock_out_at is null then 'open' else 'closed' end as state
       from public.time_entries where employee_id = $1 and booking_id = $2 order by clock_in_at, created_at`,
      [who.membershipId, job],
    )
  ).map((r) => r.state);

const partDone = async (who: Member, job: string): Promise<boolean> =>
  (
    await api.sql<{ done: boolean }>(
      "select completed_at is not null as done from public.booking_assignees where membership_id = $1 and booking_id = $2",
      [who.membershipId, job],
    )
  )[0].done;

const refusals = (job: string) =>
  api.sql<{ reason: string }>(
    `select after ->> 'reason' as reason from public.audit_log
     where entity = 'booking' and entity_id = $1 and action = 'refused' order by created_at`,
    [job],
  );

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("a cleaner's taps", { timeout: 60_000 }, () => {

  it("I'm here: opens her shift and starts the job", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const job = await jobFor(c, [anna]);
    expect(await tap(anna, "here", job), api.log()).toEqual({ ok: true });
    expect(await shiftsOf(anna, job)).toEqual(["open"]);
    expect(await statusOf(job)).toBe("in_progress");
  });

  it("a second tap on I'm here does not open a second shift", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const job = await jobFor(c, [anna]);
    await tap(anna, "here", job);
    expect(await tap(anna, "here", job)).toEqual({ ok: true });
    expect(await shiftsOf(anna, job)).toEqual(["open"]);
  });

  it("someone not on the job is refused, and the refusal is recorded", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const stranger = await addMember(api.sql, c.org, "employee", "Not On It");
    const job = await jobFor(c, [anna]);
    const res = await tap(stranger, "here", job);
    expect(res).toEqual({ ok: false, error: "This job isn't assigned to you" });
    expect(await shiftsOf(stranger, job)).toEqual([]);
    expect(await statusOf(job)).toBe("confirmed");
    expect((await refusals(job)).map((r) => r.reason)).toEqual(["not_assigned"]);
  });

  it("someone at another company cannot even see the job", async () => {
    const c = await company();
    const other = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const outsider = await addMember(api.sql, other.org, "employee", "Outsider");
    const job = await jobFor(c, [anna]);
    const res = await tap(outsider, "here", job);
    expect(res).toEqual({ ok: false, error: "Job not found" });
    expect(await statusOf(job)).toBe("confirmed");
  });

  it("a cancelled job cannot be started", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const job = await jobFor(c, [anna], { status: "cancelled" });
    const res = await tap(anna, "here", job);
    expect(res.ok).toBe(false);
    expect(await shiftsOf(anna, job)).toEqual([]);
    expect(await statusOf(job)).toBe("cancelled");
  });

  it("I'm done without ever clocking in is refused", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const job = await jobFor(c, [anna]);
    const res = await tap(anna, "done", job);
    expect(res.ok).toBe(false);
    expect(await partDone(anna, job)).toBe(false);
    expect(await statusOf(job)).toBe("confirmed");
  });

  it("working alone: I'm here, then I'm done, finishes the job", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const job = await jobFor(c, [anna]);
    await tap(anna, "here", job);
    expect(await tap(anna, "done", job)).toEqual({ ok: true });
    expect(await shiftsOf(anna, job)).toEqual(["closed"]);
    expect(await partDone(anna, job)).toBe(true);
    expect(await statusOf(job)).toBe("completed");
  });

  /**
   * The rules write the status now, so they write the history row too. It
   * still names the person whose tap it was, not "Sollos".
   */
  it("the job's history says who finished it", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const job = await jobFor(c, [anna]);
    await tap(anna, "here", job);
    await tap(anna, "done", job);
    const rows = await api.sql<{ status: string; actor_id: string | null; reason: string }>(
      `select after ->> 'status' as status, actor_id, after ->> 'reason' as reason
       from public.audit_log where entity = 'booking' and entity_id = $1 and action = 'status_change'
       order by created_at`,
      [job],
    );
    expect(rows).toEqual([
      { status: "in_progress", actor_id: anna.membershipId, reason: "clock_in" },
      { status: "completed", actor_id: anna.membershipId, reason: "finish" },
    ]);
  });

  /** 2026-10-26: Olha tapped Finish six minutes in; the other three were locked out. */
  it("the first of two to finish does not close the job; the second does", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const bea = await addMember(api.sql, c.org, "employee", "Bea");
    const job = await jobFor(c, [anna, bea]);
    await tap(anna, "here", job);
    await tap(bea, "here", job);

    expect(await tap(anna, "done", job)).toEqual({ ok: true });
    expect(await partDone(anna, job)).toBe(true);
    expect(await shiftsOf(bea, job)).toEqual(["open"]);
    expect(await statusOf(job)).toBe("in_progress");

    expect(await tap(bea, "done", job)).toEqual({ ok: true });
    expect(await statusOf(job)).toBe("completed");
  });

  /**
   * 2026-11-07, Iryna. She tapped I'm done three minutes in by mistake while
   * the others kept working, and could not get back on the clock: her Today
   * card offered nothing (fixed in 396dc28). This is the server's half:
   * tapping I'm here again must put her back, with her part reopened.
   */
  it("after I'm done by mistake, I'm here puts her back on the clock", async () => {
    const c = await company();
    const iryna = await addMember(api.sql, c.org, "employee", "Iryna");
    const alona = await addMember(api.sql, c.org, "employee", "Alona");
    const job = await jobFor(c, [iryna, alona]);
    await tap(iryna, "here", job);
    await tap(alona, "here", job);
    await tap(iryna, "done", job);
    expect(await partDone(iryna, job)).toBe(true);

    expect(await tap(iryna, "here", job), api.log()).toEqual({ ok: true });
    expect(await shiftsOf(iryna, job)).toEqual(["closed", "open"]);
    expect(await partDone(iryna, job)).toBe(false);
    expect(await statusOf(job)).toBe("in_progress");

    await tap(alona, "done", job);
    expect(await statusOf(job)).toBe("in_progress"); // Iryna is still working
    await tap(iryna, "done", job);
    expect(await statusOf(job)).toBe("completed");
  });

  /** 2026-11-03, Olha: stopping the clock used to finish the job and draft the invoice. */
  it("Stop my clock is a break: the job stays open and she can come back", async () => {
    const c = await company();
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    const job = await jobFor(c, [olha]);
    await tap(olha, "here", job);
    expect(await tap(olha, "stop", job)).toEqual({ ok: true });
    expect(await shiftsOf(olha, job)).toEqual(["closed"]);
    expect(await partDone(olha, job)).toBe(false);
    expect(await statusOf(job)).toBe("in_progress");

    await tap(olha, "here", job);
    expect(await shiftsOf(olha, job)).toEqual(["closed", "open"]);
    await tap(olha, "done", job);
    expect(await statusOf(job)).toBe("completed");
  });

  it("starting the next job closes her clock on the one before", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const first = await jobFor(c, [anna], { startedMinutesAgo: 120, minutes: 60 });
    const second = await jobFor(c, [anna], { startedMinutesAgo: 5, minutes: 60 });
    await tap(anna, "here", first);
    expect(await tap(anna, "here", second)).toEqual({ ok: true });
    expect(await shiftsOf(anna, first)).toEqual(["closed"]);
    expect(await shiftsOf(anna, second)).toEqual(["open"]);
    expect(await partDone(anna, first)).toBe(true);
    expect(await statusOf(first)).toBe("completed");
    expect(await statusOf(second)).toBe("in_progress");
  });

  /**
   * The second-cleaner-can't-clock-in bug: once the job is under way the
   * page hides Accept, so a server that still demanded it was a dead end.
   */
  it("an unanswered shift must be accepted first, unless the job is already under way", async () => {
    const c = await company();
    const lead = await addMember(api.sql, c.org, "employee", "Lead");
    const late = await addMember(api.sql, c.org, "employee", "Never Answered");
    const job = await jobFor(c, [lead, late], { pending: [late] });

    const early = await tap(late, "here", job);
    expect(early).toEqual({ ok: false, error: "Please accept this shift before starting it." });
    expect(await shiftsOf(late, job)).toEqual([]);

    await tap(lead, "here", job);
    expect(await tap(late, "here", job)).toEqual({ ok: true });
    expect(await shiftsOf(late, job)).toEqual(["open"]);
    const [row] = await api.sql<{ acceptance_status: string }>(
      "select acceptance_status from public.booking_assignees where membership_id = $1 and booking_id = $2",
      [late.membershipId, job],
    );
    expect(row.acceptance_status).toBe("accepted");
  });
});

describe.skipIf(!hasPostgrest)("who is tapping", { timeout: 60_000 }, () => {
  // If these passed with any cookie at all, nothing above would mean much.
  it("a tap with no session is sent to sign in, and nothing is written", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const job = await jobFor(c, [anna]);
    const form = new FormData();
    form.set("booking_id", job);
    request.cookies = [];
    await expect(actions.startJobAction(form)).rejects.toThrow("redirected to /login");
    expect(await shiftsOf(anna, job)).toEqual([]);
    expect(await statusOf(job)).toBe("confirmed");
  });

  it("a session signed with the wrong key is not her", async () => {
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna");
    const job = await jobFor(c, [anna]);
    const [cookie] = api.sessionCookies(anna.userId);
    const session = JSON.parse(Buffer.from(cookie.value.slice("base64-".length), "base64url").toString("utf8"));
    const [head, body] = String(session.access_token).split(".");
    session.access_token = [head, body, "forged-signature"].join(".");
    request.cookies = [{ name: cookie.name, value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url") }];
    const form = new FormData();
    form.set("booking_id", job);
    // The auth server does not recognise the token, so she is nobody: either
    // sent to sign in, or refused. Never served.
    const outcome = await actions.startJobAction(form).then(
      (r) => r,
      (err: unknown) => ({ ok: false as const, error: String(err) }),
    );
    expect(outcome.ok).toBe(false);
    expect(await shiftsOf(anna, job)).toEqual([]);
    expect(await statusOf(job)).toBe("confirmed");
  });
});

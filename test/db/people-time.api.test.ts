/**
 * Training, time off, hours and bonuses, pressed as the office and the crew
 * press them, against a real database behind the real PostgREST. Outbound
 * email is caught. Two daily jobs ride along: the pay-period autodraft and
 * the certification-expiry reminders.
 *
 * The checks that matter: a cleaner's own time-off request lands when she
 * presses it (tightened rules once refused every one of them for two months)
 * and never reaches a teammate's; a bonus is paid once for one period; a
 * button that changed nothing doesn't say "done".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

type Sent = { to: string; subject: string; text?: string; html?: string };
const outbox = vi.hoisted(() => ({ email: [] as Sent[] }));
vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  isEmailConfigured: () => true,
  sendEmail: async (a: Sent) => {
    outbox.email.push(a);
    return true;
  },
  sendOrgEmail: async (_o: string, a: Sent) => {
    outbox.email.push(a);
    return true;
  },
  sendOrgEmailDetailed: async (_o: string, a: Sent) => {
    outbox.email.push(a);
    return { ok: true };
  },
}));

let api: Api;
let restoreEnv: () => void;
let training: typeof import("@/app/app/training/actions");
let timesheets: typeof import("@/app/app/timesheets/actions");
let bonuses: typeof import("@/app/app/bonuses/actions");
const CRON_SECRET = "people-time-test-cron-secret";

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  process.env.CRON_SECRET = CRON_SECRET;
  training = await import("@/app/app/training/actions");
  timesheets = await import("@/app/app/timesheets/actions");
  bonuses = await import("@/app/app/bonuses/actions");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  outbox.email.length = 0;
});

/** Signed in as this member; a redirect is an answer too. */
async function as<T>(m: Member, press: () => Promise<T>): Promise<T | { redirected: string }> {
  request.cookies = api.sessionCookies(m.userId);
  try {
    return await press();
  } catch (err) {
    const r = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
    if (r) return { redirected: r[1] };
    throw err;
  } finally {
    await settle();
  }
}

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const x of v) f.append(k, x);
    else f.set(k, v);
  }
  return f;
};

async function cron(path: string, get: (r: NextRequest) => Promise<Response>, secret: string | null = CRON_SECRET) {
  const res = await get(new NextRequest(`http://localhost${path}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));
  await settle();
  return res;
}

/** The org's calendar day, n days from today, read from the same clock the app reads. */
async function regina(n = 0): Promise<string> {
  const [{ d }] = await api.sql<{ d: string }>("select to_char((now() at time zone 'America/Regina')::date + $1::int, 'YYYY-MM-DD') as d", [n]);
  return d;
}

async function company(name = "Time Co") {
  const org = await addOrg(api.sql, name);
  await api.sql("update public.organizations set timezone = 'America/Regina', automations_enabled = true where id = $1", [org]);
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    admin: await addMember(api.sql, org, "admin", "Iryna"),
    olha: await addMember(api.sql, org, "manager", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    bea: await addMember(api.sql, org, "employee", "Bea"),
  };
}
type Co = Awaited<ReturnType<typeof company>>;

async function payrollRun(org: string, start: string, end: string) {
  const [r] = await api.sql<{ id: string }>(
    "insert into public.payroll_runs (organization_id, period_start, period_end, status) values ($1, $2, $3, 'draft') returning id",
    [org, start, end],
  );
  return r.id;
}
const auditFor = (id: string) =>
  api.sql<{ action: string; actor_id: string | null; before: unknown; after: unknown }>(
    "select action, actor_id, before, after from public.audit_log where entity_id = $1 order by created_at",
    [id],
  );
const told = (org: string, title: string) =>
  api.sql<{ r: string; body: string }>(
    "select recipient_membership_id as r, body from public.notifications where organization_id = $1 and title = $2",
    [org, title],
  );

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("training modules", () => {
  async function trainingModule(c: Co, title = "Bathrooms", steps = ["Spray", "Wipe"]) {
    const [m] = await api.sql<{ id: string }>(
      "insert into public.training_modules (organization_id, title, status, audience_roles) values ($1, $2, 'published', '{employee}') returning id",
      [c.org, title],
    );
    for (const [i, body] of steps.entries()) {
      await api.sql("insert into public.training_steps (organization_id, module_id, ord, body) values ($1, $2, $3, $4)", [c.org, m.id, i, body]);
    }
    return m.id;
  }
  const moduleRow = async (id: string) =>
    (await api.sql<{ title: string; status: string; audience_roles: string[]; assign_on_join: boolean }>(
      "select title, status, audience_roles, assign_on_join from public.training_modules where id = $1",
      [id],
    ))[0];
  const stepsOf = async (id: string) =>
    (await api.sql<{ body: string; link_url: string | null; organization_id: string }>(
      "select body, link_url, organization_id from public.training_steps where module_id = $1 order by ord",
      [id],
    ));

  it("the office makes a module with its steps in order; a web link is kept and anything else dropped", async () => {
    const c = await company();
    const res = await as(c.owner, () =>
      training.createTrainingModuleAction(
        {},
        form({
          title: "  Kitchens  ",
          description: "The full kitchen routine",
          status: "published",
          assign_on_join: "1",
          audience_levels: ["employee", "admins"],
          step_0_title: "Degrease",
          step_0_body: "Hood and stovetop first",
          step_0_link: "https://example.com/video",
          step_1_title: "",
          step_1_body: "Floors last",
          step_1_link: "javascript:alert(1)",
          step_2_title: "",
          step_2_body: "",
        }),
      ),
    );
    expect(res, api.log()).toEqual({ redirected: "/app/training" });
    const [{ id }] = await api.sql<{ id: string }>("select id from public.training_modules where organization_id = $1", [c.org]);
    expect(await moduleRow(id)).toEqual({ title: "Kitchens", status: "published", audience_roles: ["employee", "admin", "owner"], assign_on_join: true });
    expect(await stepsOf(id)).toEqual([
      { body: "**Degrease**\n\nHood and stovetop first", link_url: "https://example.com/video", organization_id: c.org },
      { body: "Floors last", link_url: null, organization_id: c.org },
    ]);

    expect(await as(c.owner, () => training.createTrainingModuleAction({}, form({ title: " ", audience_levels: ["employee"] })))).toEqual({ error: "Title is required" });
    expect(await as(c.owner, () => training.createTrainingModuleAction({}, form({ title: "Nobody's" })))).toEqual({
      error: "Pick at least one level this module is for",
    });
    const byCleaner = await as(c.anna, () => training.createTrainingModuleAction({}, form({ title: "Mine", audience_levels: ["employee"] })));
    expect(byCleaner).toMatchObject({ error: expect.any(String) });
    expect(await api.sql("select 1 from public.training_modules where organization_id = $1", [c.org])).toHaveLength(1);
  });

  it("an edit replaces the steps; another company's module and a cleaner's edit change nothing", async () => {
    const c = await company();
    const other = await company();
    const id = await trainingModule(c);
    const theirs = await trainingModule(other, "Their module");

    const res = await as(c.olha, () =>
      training.updateTrainingModuleAction(id, {}, form({ title: "Bathrooms v2", status: "draft", audience_levels: ["manager"], step_0_title: "Only step", step_0_body: "Do it" })),
    );
    expect(res, api.log()).toEqual({ redirected: "/app/training" });
    expect(await moduleRow(id)).toMatchObject({ title: "Bathrooms v2", status: "draft", audience_roles: ["manager"], assign_on_join: false });
    expect((await stepsOf(id)).map((s) => s.body)).toEqual(["**Only step**\n\nDo it"]);

    await as(c.anna, () => training.updateTrainingModuleAction(id, {}, form({ title: "Anna's", audience_levels: ["employee"], step_0_body: "x" })));
    expect((await moduleRow(id)).title).toBe("Bathrooms v2");
    expect((await stepsOf(id)).map((s) => s.body)).toEqual(["**Only step**\n\nDo it"]);

    await as(c.owner, () => training.updateTrainingModuleAction(theirs, {}, form({ title: "Taken", audience_levels: ["employee"], step_0_body: "x" })));
    expect((await moduleRow(theirs)).title).toBe("Their module");
    expect((await stepsOf(theirs)).map((s) => s.body)).toEqual(["Spray", "Wipe"]);
  });

  it("a cleaner's edit is told no instead of being sent back to the list as saved", async () => {
    const c = await company();
    const id = await trainingModule(c);
    const res = await as(c.anna, () => training.updateTrainingModuleAction(id, {}, form({ title: "Anna's", audience_levels: ["employee"], step_0_body: "x" })));
    expect(res).toMatchObject({ error: expect.any(String) });
  });

  it("an edit aimed at another company's module attaches nothing to it", async () => {
    const c = await company();
    const other = await company();
    const theirs = await trainingModule(other, "Their draft", []);
    await as(c.owner, () => training.updateTrainingModuleAction(theirs, {}, form({ title: "Taken", audience_levels: ["employee"], step_0_body: "Injected step" })));
    expect(await stepsOf(theirs)).toEqual([]);
  });

  it("a step keeps its photo through an edit that doesn't touch it, and loses it when removed", async () => {
    const c = await company();
    const id = await trainingModule(c, "Photos", ["Before"]);
    await api.sql("update public.training_steps set image_url = 'https://cdn.example.com/before.png?v=1' where module_id = $1", [id]);
    const save = (extra: Record<string, string>) =>
      as(c.owner, () =>
        training.updateTrainingModuleAction(
          id,
          {},
          form({ title: "Photos", audience_levels: ["employee"], step_0_body: "Before", step_0_existing_image: "https://cdn.example.com/before.png?v=1", ...extra }),
        ),
      );
    const image = async () => (await api.sql<{ image_url: string | null }>("select image_url from public.training_steps where module_id = $1", [id]))[0]?.image_url;
    expect(await save({})).toEqual({ redirected: "/app/training" });
    expect(await image()).toBe("https://cdn.example.com/before.png?v=1");
    expect(await save({ step_0_remove_image: "1" })).toEqual({ redirected: "/app/training" });
    expect(await image()).toBeNull();
  });

  it("replacing a step's photo with one too big to keep leaves the old photo (or says no)", async () => {
    const c = await company();
    const id = await trainingModule(c, "Photos", ["Before"]);
    const existing = "https://cdn.example.com/before.png?v=1";
    await api.sql("update public.training_steps set image_url = $2 where module_id = $1", [id, existing]);
    const f = form({ title: "Photos", audience_levels: ["employee"], step_0_body: "Before", step_0_existing_image: existing });
    // A 5 MB phone photo: past the 4 MB the action keeps, inside the 25 MB a request may carry.
    const big = new Uint8Array(5 * 1024 * 1024);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    f.set("step_0_image", new File([big], "kitchen.png", { type: "image/png" }));
    await as(c.owner, () => training.updateTrainingModuleAction(id, {}, f));
    expect((await api.sql<{ image_url: string | null }>("select image_url from public.training_steps where module_id = $1", [id]))[0].image_url).toBe(existing);
  });

  it("is deleted with its steps by the office; a cleaner's or another company's delete leaves it", async () => {
    const c = await company();
    const other = await company();
    const id = await trainingModule(c);
    const theirs = await trainingModule(other);

    await as(c.anna, () => training.deleteTrainingModuleAction(form({ id })));
    await as(c.owner, () => training.deleteTrainingModuleAction(form({ id: theirs })));
    expect(await moduleRow(id)).toBeTruthy();
    expect(await moduleRow(theirs)).toBeTruthy();
    expect(await stepsOf(theirs)).toHaveLength(2);

    expect(await as(c.olha, () => training.deleteTrainingModuleAction(form({ id })))).toEqual({ redirected: "/app/training" });
    expect(await moduleRow(id)).toBeUndefined();
    expect(await stepsOf(id)).toEqual([]);
  });

  it("the audit log doesn't record a cleaner deleting a module she couldn't delete", async () => {
    const c = await company();
    const id = await trainingModule(c);
    await as(c.anna, () => training.deleteTrainingModuleAction(form({ id })));
    expect(await moduleRow(id)).toBeTruthy();
    expect(await auditFor(id)).toEqual([]);
  });

  it("the office marks someone trained, keeps the first date on a second tick, and un-ticks; only within the company", async () => {
    const c = await company();
    const other = await company();
    const id = await trainingModule(c);
    await api.sql("update public.training_modules set expires_after_days = 365 where id = $1", [id]);
    const theirs = await trainingModule(other);
    const assignment = async () =>
      (await api.sql<{ completed_at: string | null; expires_in_days: number | null }>(
        `select completed_at, round(extract(epoch from certification_expires_at - completed_at) / 86400)::int as expires_in_days
           from public.training_assignments where module_id = $1 and employee_id = $2`,
        [id, c.anna.membershipId],
      ))[0];

    // Already assigned (the usual case): ticking it dates the certificate.
    await api.sql("insert into public.training_assignments (organization_id, module_id, employee_id) values ($1, $2, $3)", [c.org, id, c.anna.membershipId]);
    expect(await as(c.olha, () => training.setTrainingCompletionAction(form({ module_id: id, employee_id: c.anna.membershipId, completed: "1" }))), api.log()).toEqual({ ok: true });
    const first = await assignment();
    expect(first.completed_at).not.toBeNull();
    expect(first.expires_in_days, "a module that expires dates the certificate").toBe(365);

    expect(await as(c.owner, () => training.setTrainingCompletionAction(form({ module_id: id, employee_id: c.anna.membershipId, completed: "1" })))).toEqual({ ok: true });
    expect((await assignment()).completed_at).toEqual(first.completed_at);
    expect(await as(c.owner, () => training.setTrainingCompletionAction(form({ module_id: id, employee_id: c.anna.membershipId, completed: "0" })))).toEqual({ ok: true });
    expect((await assignment()).completed_at).toBeNull();

    expect(await as(c.owner, () => training.setTrainingCompletionAction(form({ module_id: theirs, employee_id: c.anna.membershipId, completed: "1" })))).toEqual({
      ok: false,
      error: "Module not found.",
    });
    expect(await as(c.owner, () => training.setTrainingCompletionAction(form({ module_id: id, employee_id: other.anna.membershipId, completed: "1" })))).toEqual({
      ok: false,
      error: "Employee not found.",
    });
    expect(await as(c.anna, () => training.setTrainingCompletionAction(form({ module_id: id, employee_id: c.anna.membershipId, completed: "1" })))).toEqual({
      ok: false,
      error: "Not authorized.",
    });
    expect(await api.sql("select 1 from public.training_assignments where module_id = $1", [theirs])).toHaveLength(0);
  });

  it("marking a new hire trained on a module that expires dates her certificate even when she had no assignment yet", async () => {
    const c = await company();
    const id = await trainingModule(c);
    await api.sql("update public.training_modules set expires_after_days = 365 where id = $1", [id]);
    expect(await as(c.owner, () => training.setTrainingCompletionAction(form({ module_id: id, employee_id: c.bea.membershipId, completed: "1" })))).toEqual({ ok: true });
    const [row] = await api.sql<{ completed: boolean; expires: boolean }>(
      "select completed_at is not null as completed, certification_expires_at is not null as expires from public.training_assignments where module_id = $1 and employee_id = $2",
      [id, c.bea.membershipId],
    );
    expect(row).toEqual({ completed: true, expires: true });
  });
});

// ---------------------------------------------------------------------------
// Time off
// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("a cleaner's own time off", () => {
  async function pto(c: Co, who: Member, startIn: number, endIn: number, status = "pending", hours = 8) {
    const [r] = await api.sql<{ id: string }>(
      "insert into public.pto_requests (organization_id, employee_id, start_date, end_date, hours, status) values ($1, $2, $3, $4, $5, $6) returning id",
      [c.org, who.membershipId, await regina(startIn), await regina(endIn), hours, status],
    );
    return r.id;
  }
  const ptoRow = async (id: string) =>
    (await api.sql<{ start_date: string; end_date: string; hours: string; status: string; reason: string | null; reviewed_by: string | null }>(
      "select to_char(start_date, 'YYYY-MM-DD') as start_date, to_char(end_date, 'YYYY-MM-DD') as end_date, hours::text, status, reason, reviewed_by from public.pto_requests where id = $1",
      [id],
    ))[0];

  it("she asks, changes and cancels her own request, as herself, and the office hears each time", async () => {
    const c = await company();
    const from = await regina(20);
    const to = await regina(21);
    expect(await as(c.anna, () => timesheets.submitSelfPtoRequestAction(form({ start_date: from, end_date: to, hours: "16", reason: "Wedding" }))), api.log()).toEqual({ ok: true });
    const [{ id }] = await api.sql<{ id: string }>("select id from public.pto_requests where employee_id = $1", [c.anna.membershipId]);
    expect(await ptoRow(id)).toMatchObject({ start_date: from, end_date: to, hours: "16.00", status: "pending" });

    const later = await regina(22);
    expect(await as(c.anna, () => timesheets.updateSelfPtoRequestAction(form({ id, start_date: from, end_date: later, hours: "24", reason: "Wedding + travel" })))).toEqual({ ok: true });
    expect(await ptoRow(id)).toEqual({ start_date: from, end_date: later, hours: "24.00", status: "pending", reason: "Wedding + travel", reviewed_by: null });
    expect((await told(c.org, "Time-off request updated")).map((n) => n.r).sort()).toEqual([c.owner.membershipId, c.admin.membershipId, c.olha.membershipId].sort());

    expect(await as(c.anna, () => timesheets.cancelSelfPtoRequestAction(form({ id })))).toEqual({ ok: true });
    expect((await ptoRow(id)).status).toBe("cancelled");
    expect(await told(c.org, "Time off cancelled")).toHaveLength(3);
    expect(await as(c.anna, () => timesheets.cancelSelfPtoRequestAction(form({ id })))).toEqual({
      ok: false,
      error: "This request can no longer be cancelled — ask your manager.",
    });
  });

  it("changing an approved request sends it back for approval", async () => {
    const c = await company();
    const id = await pto(c, c.anna, 15, 15, "approved");
    await api.sql("update public.pto_requests set reviewed_by = $2, reviewed_at = now() where id = $1", [id, c.owner.membershipId]);
    const day = await regina(16);
    expect(await as(c.anna, () => timesheets.updateSelfPtoRequestAction(form({ id, start_date: day, end_date: day, hours: "8" })))).toEqual({ ok: true });
    expect(await ptoRow(id)).toMatchObject({ start_date: day, status: "pending", reviewed_by: null });
    expect(await told(c.org, "Changed time off needs re-approval")).toHaveLength(3);
  });

  it("she can't change or cancel a teammate's request, another company's, one under way, or one a pay run holds", async () => {
    const c = await company();
    const other = await company();
    const beas = await pto(c, c.bea, 10, 11);
    const theirs = await pto(other, other.anna, 10, 11);
    const underWay = await pto(c, c.anna, -1, 2, "approved");
    const inRun = await pto(c, c.anna, 30, 30, "approved");
    await api.sql("update public.pto_requests set payroll_run_id = $2 where id = $1", [inRun, await payrollRun(c.org, await regina(25), await regina(35))]);
    const d = await regina(12);
    const edit = (id: string) => as(c.anna, () => timesheets.updateSelfPtoRequestAction(form({ id, start_date: d, end_date: d, hours: "8" })));
    const cancel = (id: string) => as(c.anna, () => timesheets.cancelSelfPtoRequestAction(form({ id })));

    expect(await edit(beas)).toEqual({ ok: false, error: "Request not found." });
    expect(await cancel(beas)).toEqual({ ok: false, error: "Request not found." });
    expect(await edit(theirs)).toEqual({ ok: false, error: "Request not found." });
    expect(await cancel(theirs)).toEqual({ ok: false, error: "Request not found." });
    expect(await edit(underWay)).toEqual({ ok: false, error: "This request can no longer be changed — cancel it or ask your manager." });
    expect(await edit(inRun)).toMatchObject({ ok: false, error: expect.stringContaining("payroll run") });
    expect(await cancel(inRun)).toMatchObject({ ok: false, error: expect.stringContaining("payroll run") });
    expect((await ptoRow(beas)).status).toBe("pending");
    expect((await ptoRow(theirs)).status).toBe("pending");
    expect((await ptoRow(inRun)).status).toBe("approved");

    // Cancelling mid-leave is allowed: "I'm coming back early".
    expect(await cancel(underWay)).toEqual({ ok: true });
  });
});

describe.skipIf(!hasPostgrest)("time off the office records", () => {
  const ptoOf = (who: Member) =>
    api.sql<{ id: string; status: string; hours: string; reviewed_by: string | null; start_date: string }>(
      "select id, status, hours::text, reviewed_by, to_char(start_date, 'YYYY-MM-DD') as start_date from public.pto_requests where employee_id = $1",
      [who.membershipId],
    );

  it("a manager records approved time off for a cleaner; a contractor's is unpaid; the wrong person, company or period is refused", async () => {
    const c = await company();
    const other = await company();
    const d1 = await regina(30);
    const d2 = await regina(31);
    const create = (who: Member, f: Record<string, string>) => as(who, () => timesheets.createPtoRequestAction(form({ start_date: d1, end_date: d2, hours: "16", ...f })));

    expect(await create(c.olha, { employee_id: c.anna.membershipId, reason: "Surgery" }), api.log()).toEqual({ ok: true });
    expect(await ptoOf(c.anna)).toMatchObject([{ status: "approved", hours: "16.00", reviewed_by: c.olha.membershipId }]);

    await api.sql("update public.memberships set engagement = 'subcontractor' where id = $1", [c.bea.membershipId]);
    expect(await create(c.owner, { employee_id: c.bea.membershipId })).toEqual({ ok: true });
    expect((await ptoOf(c.bea))[0].hours, "a contractor's time off carries no pay").toBe("0.00");

    expect(await create(c.owner, { employee_id: other.anna.membershipId })).toEqual({ ok: false, error: "That person isn't in this organization." });
    expect(await create(c.owner, { employee_id: c.anna.membershipId, hours: "999" })).toEqual({ ok: false, error: "Hours must be between 0 and 200." });
    expect(await create(c.owner, { employee_id: c.anna.membershipId, start_date: d2, end_date: d1 })).toEqual({ ok: false, error: "End date must be on or after start date." });
    expect(await create(c.anna, { employee_id: c.anna.membershipId })).toEqual({ ok: false, error: "Not authorized." });
    await payrollRun(c.org, await regina(28), await regina(35));
    expect(await create(c.owner, { employee_id: c.anna.membershipId })).toMatchObject({ ok: false, error: expect.stringContaining("A payroll run already covers") });
    expect(await ptoOf(other.anna)).toEqual([]);
    expect(await ptoOf(c.anna)).toHaveLength(1);
  });

  it("a manager edits a request, keeping its status, and the cleaner is told; frozen and foreign requests are refused", async () => {
    const c = await company();
    const other = await company();
    const d = await regina(40);
    await as(c.owner, () => timesheets.createPtoRequestAction(form({ employee_id: c.anna.membershipId, start_date: d, end_date: d, hours: "8" })));
    await as(other.owner, () => timesheets.createPtoRequestAction(form({ employee_id: other.anna.membershipId, start_date: d, end_date: d, hours: "8" })));
    const [mine] = await ptoOf(c.anna);
    const [theirs] = await ptoOf(other.anna);
    const d2 = await regina(41);

    expect(await as(c.olha, () => timesheets.updatePtoRequestAction(form({ id: mine.id, start_date: d2, end_date: d2, hours: "6", reason: "Moved" }))), api.log()).toEqual({ ok: true });
    expect((await ptoOf(c.anna))[0]).toMatchObject({ status: "approved", hours: "6.00", start_date: d2 });
    const notes = await told(c.org, "Your time off was updated");
    expect(notes.map((n) => n.r)).toEqual([c.anna.membershipId]);

    expect(await as(c.owner, () => timesheets.updatePtoRequestAction(form({ id: theirs.id, start_date: d2, end_date: d2, hours: "1" })))).toEqual({ ok: false, error: "Request not found." });
    expect(await as(c.anna, () => timesheets.updatePtoRequestAction(form({ id: mine.id, start_date: d2, end_date: d2, hours: "1" })))).toEqual({ ok: false, error: "Not authorized." });
    // An approved request can't be moved into a period a run already covers.
    await payrollRun(c.org, await regina(50), await regina(60));
    const d3 = await regina(55);
    expect(await as(c.owner, () => timesheets.updatePtoRequestAction(form({ id: mine.id, start_date: d3, end_date: d3, hours: "6" })))).toMatchObject({
      ok: false,
      error: expect.stringContaining("A payroll run already covers"),
    });
    expect((await ptoOf(other.anna))[0].hours).toBe("8.00");
    expect((await ptoOf(c.anna))[0].start_date).toBe(d2);
  });

  it("a manager deletes a request; one a pay run holds, another company's, or a cleaner's press, leaves it", async () => {
    const c = await company();
    const other = await company();
    const d = await regina(40);
    for (const [co, who] of [
      [c, c.anna],
      [c, c.bea],
      [other, other.anna],
    ] as const) {
      await as(co.owner, () => timesheets.createPtoRequestAction(form({ employee_id: who.membershipId, start_date: d, end_date: d, hours: "8" })));
    }
    const [annas] = await ptoOf(c.anna);
    const [beas] = await ptoOf(c.bea);
    const [theirs] = await ptoOf(other.anna);
    await api.sql("update public.pto_requests set payroll_run_id = $2 where id = $1", [beas.id, await payrollRun(c.org, await regina(35), await regina(45))]);

    expect(await as(c.anna, () => timesheets.deletePtoRequestAction(form({ id: annas.id })))).toEqual({ ok: false, error: "Not authorized." });
    expect(await as(c.owner, () => timesheets.deletePtoRequestAction(form({ id: theirs.id })))).toEqual({ ok: false, error: "Request not found." });
    expect(await as(c.owner, () => timesheets.deletePtoRequestAction(form({ id: beas.id })))).toMatchObject({ ok: false, error: expect.stringContaining("payroll run") });
    expect(await as(c.olha, () => timesheets.deletePtoRequestAction(form({ id: annas.id })))).toEqual({ ok: true });
    expect(await ptoOf(c.anna)).toEqual([]);
    expect(await ptoOf(c.bea)).toHaveLength(1);
    expect(await ptoOf(other.anna)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("hours on the timesheet", () => {
  async function entry(org: string, who: Member, daysAgo: number) {
    const [r] = await api.sql<{ id: string }>(
      `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at)
       values ($1, $2, now() - ($3 || ' days')::interval, now() - ($3 || ' days')::interval + interval '3 hours') returning id`,
      [org, who.membershipId, String(daysAgo)],
    );
    return r.id;
  }
  const entriesLeft = async (ids: string[]) =>
    (await api.sql<{ id: string }>("select id from public.time_entries where id = any($1::uuid[])", [ids])).map((r) => r.id).sort();

  it("a manager deletes selected shifts with an audit row each; a batch holding a paid shift, a cleaner's press, or another company's shift is left alone", async () => {
    const c = await company();
    const other = await company();
    const a1 = await entry(c.org, c.anna, 3);
    const a2 = await entry(c.org, c.anna, 2);
    const locked = await entry(c.org, c.bea, 4);
    await api.sql("update public.time_entries set payroll_run_id = $2 where id = $1", [locked, await payrollRun(c.org, await regina(-10), await regina(-1))]);
    const theirs = await entry(other.org, other.anna, 2);
    const del = (who: Member, ids: string[]) => as(who, () => timesheets.bulkDeleteTimeEntriesAction(form({ ids })));

    expect(await del(c.anna, [a1])).toEqual({ ok: false, error: "Not authorized." });
    expect(await del(c.owner, [a1, locked])).toEqual({
      ok: false,
      error: "1 of the selected entries are locked inside a pay run or statement. Delete that run/statement first, or deselect them.",
    });
    expect(await del(c.owner, [])).toEqual({ ok: false, error: "No entries selected." });
    expect(await entriesLeft([a1, a2, locked])).toEqual([a1, a2, locked].sort());

    expect(await del(c.olha, [a1, a2, theirs]), api.log()).toEqual({ ok: true, deleted: 2 });
    expect(await entriesLeft([a1, a2, locked, theirs])).toEqual([locked, theirs].sort());
    expect((await auditFor(a1)).map((a) => a.action)).toEqual(["delete"]);
    expect((await auditFor(a2)).map((a) => a.action)).toEqual(["delete"]);
    expect(await auditFor(theirs)).toEqual([]);
  });

  it("an owner sees who changed a shift, newest first; a cleaner and another company see nothing", async () => {
    const c = await company();
    const other = await company();
    const id = await entry(c.org, c.anna, 2);
    await api.sql(
      `insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, before, after, created_at) values
         ($1, $2, 'create', 'time_entry', $3, null, '{"clock_in_at":"09:00"}', now() - interval '2 days'),
         ($1, $4, 'update', 'time_entry', $3, '{"clock_out_at":"12:00"}', '{"clock_out_at":"12:30"}', now() - interval '1 day')`,
      [c.org, c.anna.membershipId, id, c.olha.membershipId],
    );
    const history = (await as(c.owner, () => timesheets.fetchTimeEntryHistoryAction(id))) as Array<{ action: string; actor_name: string }>;
    expect(history.map((h) => [h.action, h.actor_name.replace(/ \d+$/, "")])).toEqual([
      ["update", "Olha"],
      ["create", "Anna"],
    ]);
    expect(await as(c.anna, () => timesheets.fetchTimeEntryHistoryAction(id))).toEqual([]);
    expect(await as(other.owner, () => timesheets.fetchTimeEntryHistoryAction(id))).toEqual([]);
  });

  it("a manager opening a shift's history sees its edits, not an empty history", async () => {
    const c = await company();
    const id = await entry(c.org, c.anna, 2);
    await api.sql(
      "insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, after) values ($1, $2, 'update', 'time_entry', $3, '{\"clock_out_at\":\"12:30\"}')",
      [c.org, c.owner.membershipId, id],
    );
    expect(await as(c.olha, () => timesheets.fetchTimeEntryHistoryAction(id))).toHaveLength(1);
  });

  it("a manager whose timesheets access is switched off can't delete shifts or record time off", async () => {
    const c = await company();
    await api.sql(`update public.memberships set capabilities = '{"timesheets": false}'::jsonb where id = $1`, [c.olha.membershipId]);
    const id = await entry(c.org, c.anna, 2);
    expect(await as(c.olha, () => timesheets.bulkDeleteTimeEntriesAction(form({ ids: [id] })))).toMatchObject({ ok: false });
    const d = await regina(30);
    expect(await as(c.olha, () => timesheets.createPtoRequestAction(form({ employee_id: c.anna.membershipId, start_date: d, end_date: d, hours: "8" })))).toMatchObject({
      ok: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Bonuses
// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("bonuses", () => {
  async function rule(c: Co, over: Record<string, unknown> = {}) {
    const cols = {
      enabled: true,
      min_avg_rating: 4.5,
      min_reviews_count: 2,
      period_days: 30,
      amount_cents: 5000,
      efficiency_enabled: true,
      efficiency_min_hours_saved: 1,
      efficiency_min_jobs: 1,
      efficiency_amount_cents: 2500,
      ...over,
    };
    const keys = Object.keys(cols);
    await api.sql(
      `insert into public.bonus_rules (organization_id, ${keys.join(", ")}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")})`,
      [c.org, ...Object.values(cols)],
    );
  }
  async function review(c: Co, who: Member, rating: number, daysAgo: number) {
    await api.sql("insert into public.reviews (organization_id, employee_id, rating, submitted_at) values ($1, $2, $3, now() - ($4 || ' days')::interval)", [
      c.org,
      who.membershipId,
      rating,
      String(daysAgo),
    ]);
  }
  /** A finished job N days ago, booked for `minutes`, and each cleaner's worked minutes on it. */
  async function finishedJob(c: Co, minutes: number, worked: Array<[Member, number]>, daysAgo = 3, divide = false) {
    const client = await addClient(api.sql, c.org, "Bonus Client");
    const [b] = await api.sql<{ id: string }>(
      `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, assigned_to, divide_hours_evenly)
       values ($1, $2, now() - ($3 || ' days')::interval, $4, 'standard', 'completed', $5, $6) returning id`,
      [c.org, client, String(daysAgo), minutes, worked[0][0].membershipId, divide],
    );
    for (const [who, mins] of worked) {
      await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id) values ($1, $2, $3)", [c.org, b.id, who.membershipId]);
      await api.sql(
        `insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at, clock_out_at)
         values ($1, $2, $3, now() - ($4 || ' days')::interval, now() - ($4 || ' days')::interval + ($5 || ' minutes')::interval)`,
        [c.org, who.membershipId, b.id, String(daysAgo), String(mins)],
      );
    }
    return b.id;
  }
  const bonusesOf = (c: Co) =>
    api.sql<{ id: string; employee_id: string; bonus_type: string; amount_cents: number; status: string; period_start: string; period_end: string; reason: string; paid_at: string | null }>(
      `select id, employee_id, bonus_type, amount_cents, status::text as status, to_char(period_start, 'YYYY-MM-DD') as period_start,
              to_char(period_end, 'YYYY-MM-DD') as period_end, reason, paid_at::text as paid_at
         from public.bonuses where organization_id = $1 order by bonus_type, employee_id`,
      [c.org],
    );
  let nth = 0;
  async function bonus(c: Co, who: Member, over: { status?: string; run?: string; amount?: number } = {}) {
    // One manual bonus per person per period (bonuses_unique_period_uidx): each gets its own.
    const n = ++nth;
    const [r] = await api.sql<{ id: string }>(
      `insert into public.bonuses (organization_id, employee_id, period_start, period_end, amount_cents, status, bonus_type, payroll_run_id, reason)
       values ($1, $2, current_date - 10 - $6::int, current_date - 3, $3, $4::public.bonus_status, 'manual', $5, 'Year end') returning id`,
      [c.org, who.membershipId, over.amount ?? 10000, over.status ?? "pending", over.run ?? null, n],
    );
    return r.id;
  }

  it("review bonuses go to whoever met the bar in the last 30 days, once, dated on the org's calendar", async () => {
    const c = await company();
    const other = await company();
    await rule(c);
    await rule(other);
    await review(c, c.anna, 5, 2);
    await review(c, c.anna, 5, 9);
    await review(c, c.anna, 4, 20);
    await review(c, c.bea, 3, 2); // average too low
    await review(c, c.bea, 4, 3);
    await review(c, c.olha, 5, 40); // outside the window
    await review(c, c.olha, 5, 45);
    await review(other, other.anna, 5, 1);
    await review(other, other.anna, 5, 2);

    const first = await as(c.owner, () => bonuses.computeBonusesAction());
    expect(first, api.log()).toEqual({ ok: true, created: 1, skipped: 1 });
    expect(await bonusesOf(c)).toMatchObject([
      {
        employee_id: c.anna.membershipId,
        bonus_type: "review",
        amount_cents: 5000,
        status: "pending",
        period_start: await regina(-30),
        period_end: await regina(0),
        reason: "Avg 4.67 across 3 reviews (last 30d)",
      },
    ]);
    expect(await bonusesOf(other), "another company's reviews are theirs").toEqual([]);

    expect(await as(c.admin, () => bonuses.computeBonusesAction())).toEqual({ ok: true, created: 0, skipped: 2 });
    expect(await bonusesOf(c), "a second run pays nobody twice").toHaveLength(1);

    expect(await as(c.olha, () => bonuses.computeBonusesAction())).toEqual({ ok: false, error: "Only owners and admins can compute bonuses." });
    await api.sql("update public.bonus_rules set enabled = false where organization_id = $1", [c.org]);
    expect(await as(c.owner, () => bonuses.computeBonusesAction())).toEqual({ ok: false, error: "The review bonus engine is currently disabled." });
  });

  it("a cleaner who earned both gets her review bonus even when efficiency was computed first", async () => {
    const c = await company();
    await rule(c);
    await review(c, c.anna, 5, 2);
    await review(c, c.anna, 5, 4);
    await finishedJob(c, 240, [[c.anna, 120]]);
    expect(await as(c.owner, () => bonuses.computeEfficiencyBonusesAction())).toMatchObject({ ok: true, created: 1 });
    expect(await as(c.owner, () => bonuses.computeBonusesAction())).toMatchObject({ ok: true, created: 1 });
    expect((await bonusesOf(c)).map((b) => b.bonus_type)).toEqual(["efficiency", "review"]);
  });

  it("pressing Compute again a few days later doesn't pay the same reviews twice; once the earlier period is behind the window, it pays again", async () => {
    const c = await company();
    await rule(c);
    await review(c, c.anna, 5, 2);
    await review(c, c.anna, 5, 4);
    expect(await as(c.owner, () => bonuses.computeBonusesAction())).toMatchObject({ ok: true, created: 1 });
    // The same press three days ago would have left this period on the row.
    await api.sql(
      "update public.bonuses set period_start = period_start - 3, period_end = period_end - 3 where organization_id = $1 and bonus_type = 'review'",
      [c.org],
    );
    expect(await as(c.owner, () => bonuses.computeBonusesAction())).toEqual({ ok: true, created: 0, skipped: 1 });
    expect((await bonusesOf(c)).filter((b) => b.bonus_type === "review")).toHaveLength(1);

    // A bonus for a period that ended before this window began doesn't block a new one.
    await api.sql(
      "update public.bonuses set period_start = period_start - 60, period_end = period_end - 60 where organization_id = $1 and bonus_type = 'review'",
      [c.org],
    );
    expect(await as(c.owner, () => bonuses.computeBonusesAction())).toMatchObject({ ok: true, created: 1 });
  });

  it("efficiency bonuses go to whoever finished faster than booked, once per period", async () => {
    const c = await company();
    await rule(c);
    await finishedJob(c, 240, [[c.anna, 120]]);
    await finishedJob(c, 120, [[c.bea, 150]]); // ran over
    // Outside the 30 days, or not finished: neither counts, however fast.
    const olhaWorker = c.olha;
    await finishedJob(c, 600, [[olhaWorker, 60]], 40);
    const unfinished = await finishedJob(c, 600, [[olhaWorker, 60]], 5);
    await api.sql("update public.bookings set status = 'confirmed' where id = $1", [unfinished]);

    expect(await as(c.owner, () => bonuses.computeEfficiencyBonusesAction()), api.log()).toEqual({ ok: true, created: 1, skipped: 1 });
    expect(await bonusesOf(c)).toMatchObject([
      { employee_id: c.anna.membershipId, bonus_type: "efficiency", amount_cents: 2500, reason: "Saved 2.0h across 1 jobs (last 30d)", period_end: await regina(0) },
    ]);
    expect(await as(c.owner, () => bonuses.computeEfficiencyBonusesAction())).toEqual({ ok: true, created: 0, skipped: 2 });
    expect(await bonusesOf(c)).toHaveLength(1);

    expect(await as(c.olha, () => bonuses.computeEfficiencyBonusesAction())).toEqual({ ok: false, error: "Only owners and admins can compute bonuses." });
    await api.sql("update public.bonus_rules set efficiency_enabled = false where organization_id = $1", [c.org]);
    expect(await as(c.owner, () => bonuses.computeEfficiencyBonusesAction())).toEqual({ ok: false, error: "The efficiency bonus engine is currently disabled." });
  });

  /**
   * Fix-later #92. The duplicate check matched only the very same dates, and
   * the window is the last N days, so pressing Efficiency bonuses (or Compute
   * all) on another day gave a new pair of dates and paid the same people
   * again. Same rule as review bonuses now: a period reaching into this
   * window counts as paid.
   */
  it("pressing Efficiency bonuses again a few days later doesn't pay twice; once the earlier period is behind the window, it pays again", async () => {
    const c = await company();
    await rule(c);
    await finishedJob(c, 240, [[c.anna, 120]]);
    expect(await as(c.owner, () => bonuses.computeEfficiencyBonusesAction()), api.log()).toMatchObject({ ok: true, created: 1 });
    // The same press three days ago would have left this period on the row.
    await api.sql(
      "update public.bonuses set period_start = period_start - 3, period_end = period_end - 3 where organization_id = $1 and bonus_type = 'efficiency'",
      [c.org],
    );
    expect(await as(c.owner, () => bonuses.computeEfficiencyBonusesAction())).toEqual({ ok: true, created: 0, skipped: 1 });
    expect((await bonusesOf(c)).filter((b) => b.bonus_type === "efficiency")).toHaveLength(1);

    // Compute all presses both: still nobody paid twice.
    const [review, efficiency] = await Promise.all([
      as(c.owner, () => bonuses.computeBonusesAction()),
      as(c.owner, () => bonuses.computeEfficiencyBonusesAction()),
    ]);
    expect(review).toMatchObject({ ok: true });
    expect(efficiency).toEqual({ ok: true, created: 0, skipped: 1 });

    // A review bonus in the window doesn't count as an efficiency bonus paid.
    await api.sql("delete from public.bonuses where organization_id = $1 and bonus_type = 'efficiency'", [c.org]);
    await api.sql(
      `insert into public.bonuses (organization_id, employee_id, period_start, period_end, amount_cents, bonus_type, reason)
       values ($1, $2, current_date - 30, current_date, 5000, 'review', 'Avg 5.00 across 2 reviews (last 30d)')`,
      [c.org, c.anna.membershipId],
    );
    expect(await as(c.owner, () => bonuses.computeEfficiencyBonusesAction())).toMatchObject({ ok: true, created: 1 });

    // A bonus for a period that ended before this window began doesn't block a new one.
    await api.sql(
      "update public.bonuses set period_start = period_start - 60, period_end = period_end - 60 where organization_id = $1 and bonus_type = 'efficiency'",
      [c.org],
    );
    expect(await as(c.owner, () => bonuses.computeEfficiencyBonusesAction())).toMatchObject({ ok: true, created: 1 });
  });

  it("two cleaners who each worked their half of a divided job saved nothing", async () => {
    const c = await company();
    await rule(c);
    await api.sql(`update public.organizations set automation_settings = '{"divide_crew_hours": {"enabled": true}}'::jsonb where id = $1`, [c.org]);
    await finishedJob(c, 240, [
      [c.anna, 120],
      [c.bea, 120],
    ], 3, true);
    expect(await as(c.owner, () => bonuses.computeEfficiencyBonusesAction())).toMatchObject({ ok: true, created: 0 });
    expect(await bonusesOf(c)).toEqual([]);
  });

  it("a company with 400 finished jobs in the window still gets its efficiency bonuses", async () => {
    const c = await company();
    await rule(c);
    const client = await addClient(api.sql, c.org, "Busy Client");
    await api.sql(
      `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, assigned_to)
       select $1, $2, now() - interval '5 days' - (g * 90 || ' minutes')::interval, 60, 'standard', 'completed', $3 from generate_series(1, 399) g`,
      [c.org, client, c.bea.membershipId],
    );
    await finishedJob(c, 240, [[c.anna, 120]]);
    expect(await as(c.owner, () => bonuses.computeEfficiencyBonusesAction())).toMatchObject({ ok: true, created: 1 });
  }, 120_000);

  it("an owner adds a bonus by hand, dated today on the org's calendar; the wrong amount, dates, person, period or role is refused", async () => {
    const c = await company();
    const other = await company();
    const add = (who: Member, f: Record<string, string>) => as(who, () => bonuses.createAdHocBonusAction(form({ employee_id: c.anna.membershipId, amount_dollars: "$150", ...f })));

    expect(await add(c.owner, { reason: "Referral" }), api.log()).toEqual({ ok: true });
    const today = await regina(0);
    expect(await bonusesOf(c)).toMatchObject([
      { employee_id: c.anna.membershipId, bonus_type: "manual", amount_cents: 15000, status: "pending", reason: "Referral", period_start: today, period_end: today },
    ]);
    expect(await add(c.owner, { amount_dollars: "0" })).toEqual({ ok: false, error: "Enter a dollar amount greater than zero." });
    expect(await add(c.owner, { period_start: await regina(-1), period_end: await regina(-5) })).toEqual({ ok: false, error: "End date must be on or after start date." });
    expect(await add(c.owner, { employee_id: other.anna.membershipId })).toEqual({ ok: false, error: "Employee not found in this organization." });
    expect(await add(c.olha, {})).toEqual({ ok: false, error: "Only owners and admins can add bonuses." });
    await payrollRun(c.org, await regina(-14), await regina(-1));
    expect(await add(c.owner, { period_start: await regina(-5), period_end: await regina(-5) })).toMatchObject({
      ok: false,
      error: expect.stringContaining("A payroll run already covers"),
    });
    expect(await bonusesOf(c)).toHaveLength(1);
    expect(await bonusesOf(other)).toEqual([]);
  });

  it("marking paid lands once for the office, and never on a bonus a pay run holds", async () => {
    const c = await company();
    const other = await company();
    const id = await bonus(c, c.anna);
    const held = await bonus(c, c.bea, { run: await payrollRun(c.org, await regina(-14), await regina(-1)) });
    const theirs = await bonus(other, other.anna);

    expect(await as(c.olha, () => bonuses.markBonusPaidAction(id))).toEqual({ ok: false, error: "Only owners and admins can mark bonuses paid." });
    expect(await as(c.owner, () => bonuses.markBonusPaidAction(held))).toMatchObject({ ok: false, error: expect.stringContaining("inside a pay period") });
    expect(await as(c.owner, () => bonuses.markBonusPaidAction(id)), api.log()).toEqual({ ok: true });
    await as(c.owner, () => bonuses.markBonusPaidAction(theirs));
    const rows = await api.sql<{ id: string; status: string; paid: boolean }>(
      "select id, status::text as status, paid_at is not null as paid from public.bonuses where id = any($1::uuid[])",
      [[id, held, theirs]],
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, [r.status, r.paid]]))).toEqual({
      [id]: ["paid", true],
      [held]: ["pending", false],
      [theirs]: ["pending", false],
    });
  });

  it("a second 'mark paid' keeps the date it was first paid", async () => {
    const c = await company();
    const id = await bonus(c, c.anna);
    await as(c.owner, () => bonuses.markBonusPaidAction(id));
    await api.sql("update public.bonuses set paid_at = now() - interval '7 days' where id = $1", [id]);
    const [{ paid_at: first }] = await api.sql<{ paid_at: string }>("select paid_at::text as paid_at from public.bonuses where id = $1", [id]);
    await as(c.admin, () => bonuses.markBonusPaidAction(id));
    const [{ paid_at: after }] = await api.sql<{ paid_at: string }>("select paid_at::text as paid_at from public.bonuses where id = $1", [id]);
    expect(after).toBe(first);
  });

  it("marking another company's bonus paid is answered 'not found', not ok", async () => {
    const c = await company();
    const other = await company();
    const theirs = await bonus(other, other.anna);
    expect(await as(c.owner, () => bonuses.markBonusPaidAction(theirs))).toMatchObject({ ok: false });
  });

  it("an owner adjusts or deletes a pending bonus with an audit row; paid ones and ones a run holds are frozen", async () => {
    const c = await company();
    const other = await company();
    const id = await bonus(c, c.anna);
    const paid = await bonus(c, c.anna, { status: "paid" });
    const held = await bonus(c, c.bea, { run: await payrollRun(c.org, await regina(-14), await regina(-1)) });
    const gone = await bonus(c, c.bea);
    const theirs = await bonus(other, other.anna);
    const amountOf = async (b: string) => (await api.sql<{ a: number }>("select amount_cents as a from public.bonuses where id = $1", [b]))[0]?.a;

    expect(await as(c.owner, () => bonuses.updateBonusAction(form({ id, amount_dollars: "125.50", reason: "Adjusted" }))), api.log()).toEqual({ ok: true });
    expect(await amountOf(id)).toBe(12550);
    expect((await auditFor(id)).map((a) => a.action)).toEqual(["update"]);
    expect(await as(c.owner, () => bonuses.updateBonusAction(form({ id: paid, amount_dollars: "1" })))).toMatchObject({ ok: false, error: expect.stringContaining("marked paid") });
    expect(await as(c.owner, () => bonuses.updateBonusAction(form({ id: held, amount_dollars: "1" })))).toMatchObject({ ok: false, error: expect.stringContaining("payroll run") });
    expect(await as(c.owner, () => bonuses.updateBonusAction(form({ id, amount_dollars: "0" })))).toEqual({ ok: false, error: "Enter a dollar amount greater than zero." });
    expect(await as(c.olha, () => bonuses.updateBonusAction(form({ id, amount_dollars: "1" })))).toEqual({ ok: false, error: "Only owners and admins can edit bonuses." });

    expect(await as(c.owner, () => bonuses.deleteBonusAction(form({ id: paid })))).toMatchObject({ ok: false, error: expect.stringContaining("marked paid") });
    expect(await as(c.owner, () => bonuses.deleteBonusAction(form({ id: held })))).toMatchObject({ ok: false, error: expect.stringContaining("payroll run") });
    expect(await as(c.olha, () => bonuses.deleteBonusAction(form({ id: gone })))).toEqual({ ok: false, error: "Only owners and admins can delete bonuses." });
    expect(await as(c.admin, () => bonuses.deleteBonusAction(form({ id: gone })))).toEqual({ ok: true });
    expect(await amountOf(gone)).toBeUndefined();

    await as(c.owner, () => bonuses.updateBonusAction(form({ id: theirs, amount_dollars: "1" })));
    await as(c.owner, () => bonuses.deleteBonusAction(form({ id: theirs })));
    expect(await amountOf(theirs), "another company's bonus is untouched").toBe(10000);
    expect([await amountOf(paid), await amountOf(held)]).toEqual([10000, 10000]);
  });

  it("editing or deleting another company's bonus is answered 'not found', and logs nothing", async () => {
    const c = await company();
    const other = await company();
    const theirs = await bonus(other, other.anna);
    expect(await as(c.owner, () => bonuses.updateBonusAction(form({ id: theirs, amount_dollars: "1" })))).toMatchObject({ ok: false });
    expect(await as(c.owner, () => bonuses.deleteBonusAction(form({ id: theirs })))).toMatchObject({ ok: false });
    expect(await auditFor(theirs)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Daily jobs
// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("the pay-period autodraft", () => {
  it("prepares the period that just ended once, tells the office once, and leaves companies without a schedule alone", async () => {
    const { GET } = await import("@/app/api/cron/payroll-autodraft/route");
    const { suggestedPayPeriod } = await import("@/lib/pay-schedule");
    const c = await company("Autodraft Co");
    const manual = await company("Manual Co");
    const today = await regina(0);
    const p = suggestedPayPeriod("semimonthly", null, today, null);
    await api.sql("update public.organizations set pay_schedule = 'semimonthly' where id = $1", [c.org]);
    for (const co of [c, manual]) {
      await api.sql("update public.memberships set pay_rate_cents = 2000 where id = $1", [co.anna.membershipId]);
      for (const day of [p.start, p.end]) {
        await api.sql(
          `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, engagement_snapshot)
           values ($1, $2, $3::date + time '15:00' at time zone 'UTC', $3::date + time '18:00' at time zone 'UTC', 2000, 'employee')`,
          [co.org, co.anna.membershipId, day],
        );
      }
    }
    const runs = (org: string) =>
      api.sql<{ period_start: string; period_end: string; status: string; total_cents: number }>(
        "select to_char(period_start, 'YYYY-MM-DD') as period_start, to_char(period_end, 'YYYY-MM-DD') as period_end, status, total_cents from public.payroll_runs where organization_id = $1",
        [org],
      );

    expect((await cron("/api/cron/payroll-autodraft", GET, null)).status, "no secret, no run").toBe(401);
    expect(await runs(c.org)).toEqual([]);

    const res = await cron("/api/cron/payroll-autodraft", GET);
    expect(res.status, api.log()).toBe(200);
    expect(await res.json()).toEqual({ prepared: 1, blocked: 0 });
    expect(await runs(c.org)).toEqual([{ period_start: p.start, period_end: p.end, status: "draft", total_cents: 12000 }]);
    const ready = await told(c.org, "Pay period ready for review");
    expect(ready.map((n) => n.r).sort()).toEqual([c.owner.membershipId, c.admin.membershipId, c.olha.membershipId].sort());
    expect(await runs(manual.org), "no schedule, no autodraft").toEqual([]);

    expect(await (await cron("/api/cron/payroll-autodraft", GET)).json()).toEqual({ prepared: 0, blocked: 0 });
    expect(await runs(c.org), "the next morning makes nothing new").toHaveLength(1);
    expect(await told(c.org, "Pay period ready for review")).toHaveLength(ready.length);
  });

  it("leaves a period alone when the office already prepared either half of it", async () => {
    const { GET } = await import("@/app/api/cron/payroll-autodraft/route");
    const { suggestedPayPeriod } = await import("@/lib/pay-schedule");
    const c = await company("Beat To It Co");
    const p = suggestedPayPeriod("semimonthly", null, await regina(0), null);
    await api.sql("update public.organizations set pay_schedule = 'semimonthly' where id = $1", [c.org]);
    await api.sql("update public.memberships set pay_rate_cents = 2000, engagement = 'subcontractor' where id = $1", [c.bea.membershipId]);
    await api.sql(
      `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, engagement_snapshot)
       values ($1, $2, $3::date + time '15:00' at time zone 'UTC', $3::date + time '18:00' at time zone 'UTC', 2000, 'employee')`,
      [c.org, c.anna.membershipId, p.start],
    );
    // A contractor statement for the window already exists; the employee half doesn't.
    await api.sql(
      "insert into public.subcontractor_pay_runs (organization_id, period_start, period_end, status) values ($1, $2, $3, 'finalized')",
      [c.org, p.start, p.end],
    );
    expect((await cron("/api/cron/payroll-autodraft", GET)).status, api.log()).toBe(200);
    expect(await api.sql("select 1 from public.payroll_runs where organization_id = $1", [c.org])).toHaveLength(0);
    expect(await told(c.org, "Pay period ready for review")).toEqual([]);
  });
});

describe.skipIf(!hasPostgrest)("certification expiry reminders", () => {
  async function certCompany(name: string, on = true) {
    const c = await company(name);
    if (on) {
      await api.sql(`update public.organizations set automation_settings = '{"certification_expiry_reminder": {"enabled": true}}'::jsonb where id = $1`, [c.org]);
    }
    return c;
  }
  const emailOf = async (m: Member) => (await api.sql<{ email: string }>("select email from auth.users where id = $1", [m.userId]))[0].email;
  /** A certificate expiring in N days; `sent30` = the 30-day reminder already went out two weeks ago. */
  async function cert(co: Co, who: Member, inDays: number, sent30 = false) {
    const [m] = await api.sql<{ id: string }>(
      "insert into public.training_modules (organization_id, title, status, audience_roles) values ($1, 'WHMIS', 'published', '{employee}') returning id",
      [co.org],
    );
    const [a] = await api.sql<{ id: string }>(
      `insert into public.training_assignments (organization_id, module_id, employee_id, completed_at, certification_expires_at, expiry_reminder_30d_sent_at)
       values ($1, $2, $3, now() - interval '300 days', now() + ($4 || ' days')::interval, case when $5 then now() - interval '14 days' end) returning id`,
      [co.org, m.id, who.membershipId, String(inDays), sent30],
    );
    return a.id;
  }
  const stamps = async (id: string) =>
    (await api.sql<{ d30: boolean; d7: boolean }>(
      "select expiry_reminder_30d_sent_at is not null as d30, expiry_reminder_7d_sent_at is not null as d7 from public.training_assignments where id = $1",
      [id],
    ))[0];

  it("reminds a cleaner 30 days out and again 7 days out, once each, and never someone who left or a company that switched it off", async () => {
    const { GET } = await import("@/app/api/cron/certification-expiry/route");
    const c = await certCompany("Cert Co");
    const off = await certCompany("Cert Off Co", false);
    const gone = await addMember(api.sql, c.org, "employee", "Gone");
    await api.sql("update public.memberships set status = 'disabled' where id = $1", [gone.membershipId]);
    const month = await cert(c, c.anna, 20);
    const week = await cert(c, c.bea, 6, true);
    await cert(c, gone, 20);
    await cert(off, off.anna, 20);

    expect((await cron("/api/cron/certification-expiry", GET, "wrong-secret")).status).toBe(401);
    expect(outbox.email).toHaveLength(0);

    const res = await cron("/api/cron/certification-expiry", GET);
    expect(res.status, api.log()).toBe(200);
    expect(await res.json()).toEqual({ sent: 2 });
    expect(outbox.email.map((m) => m.to).sort()).toEqual([await emailOf(c.anna), await emailOf(c.bea)].sort());
    expect(await stamps(month)).toEqual({ d30: true, d7: false });
    expect(await stamps(week)).toEqual({ d30: true, d7: true });

    outbox.email.length = 0;
    expect(await (await cron("/api/cron/certification-expiry", GET)).json()).toEqual({ sent: 0 });
    expect(outbox.email).toHaveLength(0);
  });

  it("a certificate first seen a week out is reminded once, not again the next morning as a '30-day' reminder", async () => {
    const { GET } = await import("@/app/api/cron/certification-expiry/route");
    const c = await certCompany("Cert Late Co");
    const late = await cert(c, c.anna, 5);
    const to = await emailOf(c.anna);
    await cron("/api/cron/certification-expiry", GET);
    expect(outbox.email.filter((m) => m.to === to)).toHaveLength(1);
    expect(await stamps(late)).toEqual({ d30: false, d7: true });
    outbox.email.length = 0;
    await cron("/api/cron/certification-expiry", GET);
    expect(outbox.email.filter((m) => m.to === to), "the next morning").toHaveLength(0);
  });
});

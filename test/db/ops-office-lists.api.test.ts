/**
 * The office's quieter lists, pressed as the office presses them, against a
 * real database behind the real PostgREST. Push, text, email and the
 * support@ mail are caught; nothing leaves the building.
 *
 *   reviews        record, correct, delete; the owner hears of a new one
 *   feedback       file, answer, move along; who is told, and Sollos
 *   packages       add, change, remove
 *   inventory      add, change, remove; low stock tells the office
 *   network        add, change, remove
 *   on-call pool   the contact list; shift offers to the chosen few; a
 *                  cancelled offer can't be claimed
 *   tasks          edit; the hourly reminder job
 *
 * For each: the right person's press lands, a cleaner's doesn't, another
 * company's ids reach nothing, and a save that saved nothing says so.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

type Mail = { to: string; subject: string; text?: string; html?: string };
const outbox = vi.hoisted(() => ({
  email: [] as Array<{ to: string; subject: string; text?: string; html?: string }>,
  support: [] as Array<{ subject: string; replyTo?: string | null; message?: string | null }>,
  push: [] as Array<{ to: string; title: string; body?: string }>,
  orgPush: [] as Array<{ org: string; title: string }>,
  sms: [] as Array<{ org: string; to: string; body: string; automationKey: string }>,
}));

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
  sendEmail: async (a: Mail) => {
    outbox.email.push(a);
    return true;
  },
  sendEmailDetailed: async (a: Mail) => {
    outbox.email.push(a);
    return { ok: true, id: "test" };
  },
  sendOrgEmail: async (_o: string, a: Mail) => {
    outbox.email.push(a);
    return true;
  },
  sendOrgEmailDetailed: async (_o: string, a: Mail) => {
    outbox.email.push(a);
    return { ok: true };
  },
}));
vi.mock("@/lib/support-mail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/support-mail")>()),
  emailSupport: async (a: { subject: string; replyTo?: string | null; message?: string | null }) => {
    outbox.support.push(a);
  },
}));
vi.mock("@/lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/push")>()),
  sendPushToMembership: async (to: string, p: { title: string; body?: string }) => {
    outbox.push.push({ to, title: p.title, body: p.body });
    return 1;
  },
  sendPushToOrg: async (org: string, p: { title: string }) => {
    outbox.orgPush.push({ org, title: p.title });
    return 1;
  },
  sendPushToOrgAdmins: async (org: string, p: { title: string }) => {
    outbox.orgPush.push({ org, title: p.title });
    return 1;
  },
}));
vi.mock("@/lib/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms")>()),
  sendOrgSms: async (org: string, a: { to: string; body: string; automationKey: string }) => {
    outbox.sms.push({ org, ...a });
    return { ok: true, sid: `SMtest${outbox.sms.length}`, status: "sent", segments: 1 };
  },
}));

const reviews = await import("@/app/app/reviews/actions");
const feedback = await import("@/app/app/feedback/actions");
const packages = await import("@/app/app/packages/actions");
const inventory = await import("@/app/app/inventory/actions");
const network = await import("@/app/app/network/actions");
const freelancers = await import("@/app/app/freelancers/actions");
const tasks = await import("@/app/app/tasks/actions");
const { claimOfferAction } = await import("@/app/claim/[token]/actions");
const { GET: taskRemindersCron } = await import("@/app/api/cron/task-reminders/route");

let api: Api;
let restoreEnv: () => void;
const CRON_SECRET = "ops-office-lists-test-cron-secret";

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  process.env.CRON_SECRET = CRON_SECRET;
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  outbox.email.length = 0;
  outbox.support.length = 0;
  outbox.push.length = 0;
  outbox.orgPush.length = 0;
  outbox.sms.length = 0;
});

// ---------------------------------------------------------------------------

const emails = new Map<string, string>();
async function emailOf(m: Member): Promise<string> {
  const known = emails.get(m.userId);
  if (known) return known;
  const [u] = await api.sql<{ email: string }>("select email from auth.users where id = $1", [m.userId]);
  emails.set(m.userId, u.email);
  return u.email;
}

/** Signed in as this member; a redirect is an answer too. */
async function as<T>(m: Member, press: () => Promise<T>): Promise<T | { redirected: string }> {
  request.cookies = api.sessionCookies(m.userId, await emailOf(m));
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

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const formErrors = (r: unknown) => (r as { errors?: Record<string, string> } | undefined)?.errors;

async function company(label = "Ops Co") {
  const org = await addOrg(api.sql, label);
  await api.sql(
    `update public.organizations
        set timezone = 'America/Regina', automations_enabled = true, automation_settings = $2::jsonb
      where id = $1`,
    [org, JSON.stringify({ review_submitted_notify: { enabled: true } })],
  );
  const [{ name }] = await api.sql<{ name: string }>("select name from public.organizations where id = $1", [org]);
  return {
    org,
    name,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    olha: await addMember(api.sql, org, "manager", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    bea: await addMember(api.sql, org, "employee", "Bea"),
  };
}
type Co = Awaited<ReturnType<typeof company>>;

const narrow = (m: Member, caps: Record<string, boolean>) =>
  api.sql("update public.memberships set capabilities = $2::jsonb where id = $1", [m.membershipId, JSON.stringify(caps)]);

const notesFor = (m: Member, title: string) =>
  api.sql<{ title: string; body: string | null; href: string | null }>(
    "select title, body, href from public.notifications where recipient_membership_id = $1 and title = $2",
    [m.membershipId, title],
  );

/** For work the app fires without waiting: poll until it shows, or give up. */
async function waitFor<T>(read: () => Promise<T[]>, ms = 4000): Promise<T[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const rows = await read();
    if (rows.length > 0 || Date.now() > deadline) return rows;
    await new Promise((r) => setTimeout(r, 100));
  }
}

const auditFor = (org: string, entityId: string) =>
  api.sql<{ action: string }>(
    "select action from public.audit_log where organization_id = $1 and entity_id = $2 order by created_at",
    [org, entityId],
  );

async function cron(get: (r: NextRequest) => Promise<Response>, path: string, secret = CRON_SECRET) {
  const res = await get(new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${secret}` } }));
  await settle();
  return res;
}

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("reviews", () => {
  async function review(c: Co, rating: number, comment: string) {
    const client = await addClient(api.sql, c.org, "Reviewer");
    const [r] = await api.sql<{ id: string }>(
      "insert into public.reviews (organization_id, client_id, rating, comment) values ($1, $2, $3, $4) returning id",
      [c.org, client, rating, comment],
    );
    return r.id;
  }
  const reviewRow = async (id: string) =>
    (await api.sql<{ rating: number; comment: string | null }>("select rating, comment from public.reviews where id = $1", [id]))[0];

  it("the office records a review and the owner hears of it; a cleaner can't record one", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Margaret MacLeod");
    const res = await as(c.olha, () =>
      reviews.createReviewAction({}, form({ client_id: client, rating: "5", comment: "Spotless kitchen", booking_id: "", employee_id: "" })),
    );
    expect(res, api.log()).toEqual({ redirected: "/app/reviews" });
    expect(await api.sql("select rating, comment, organization_id from public.reviews where client_id = $1", [client])).toEqual([
      { rating: 5, comment: "Spotless kitchen", organization_id: c.org },
    ]);
    // The notice is sent without waiting (see Questions in the report).
    expect(await waitFor(() => notesFor(c.owner, "New 5-star review"))).toHaveLength(1);
    expect(await notesFor(c.anna, "New 5-star review"), "management-facing").toHaveLength(0);

    const refused = await as(c.anna, () =>
      reviews.createReviewAction({}, form({ client_id: client, rating: "1", comment: "", booking_id: "", employee_id: "" })),
    );
    expect(formErrors(refused)?._form, "a cleaner can't record one").toBeTruthy();
    expect(await api.sql("select 1 from public.reviews where client_id = $1", [client])).toHaveLength(1);
  });

  it("the owner's notice names the cleaner the review is for", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Patricia Poohkay");
    await as(c.olha, () =>
      reviews.createReviewAction({}, form({ client_id: client, rating: "4", comment: "", booking_id: "", employee_id: c.anna.membershipId })),
    );
    const [row] = await api.sql<{ employee_id: string }>("select employee_id from public.reviews where client_id = $1", [client]);
    expect(row.employee_id).toBe(c.anna.membershipId);
    const told = await waitFor(() => notesFor(c.owner, "New 4-star review"));
    expect(told).toHaveLength(1);
    expect(told[0].body).toContain("for Anna");
  });

  it("the office corrects a review; a cleaner can't, a rating outside 1 to 5 is refused, another company's is out of reach", async () => {
    const c = await company();
    const other = await company("Other Co");
    const id = await review(c, 3, "ok i gess");
    const theirs = await review(other, 5, "Wonderful");

    expect(await as(c.owner, () => reviews.updateReviewAction(form({ id, rating: "4", comment: "OK, I guess" })))).toEqual({ ok: true });
    expect(await reviewRow(id)).toEqual({ rating: 4, comment: "OK, I guess" });
    expect(await as(c.anna, () => reviews.updateReviewAction(form({ id, rating: "1", comment: "Anna was here" })))).toEqual({
      ok: false,
      error: "Not authorized.",
    });
    expect(await as(c.owner, () => reviews.updateReviewAction(form({ id, rating: "6", comment: "" })))).toEqual({
      ok: false,
      error: "Rating must be a whole number from 1 to 5.",
    });
    expect(await reviewRow(id)).toEqual({ rating: 4, comment: "OK, I guess" });

    await as(c.owner, () => reviews.updateReviewAction(form({ id: theirs, rating: "1", comment: "vandalised" })));
    expect(await reviewRow(theirs)).toEqual({ rating: 5, comment: "Wonderful" });
  });

  it("a correction that changed no review says so", async () => {
    const c = await company();
    const other = await company("Other Co");
    const theirs = await review(other, 5, "Wonderful");
    const res = await as(c.owner, () => reviews.updateReviewAction(form({ id: theirs, rating: "1", comment: "vandalised" })));
    expect(await reviewRow(theirs)).toEqual({ rating: 5, comment: "Wonderful" });
    expect(res).toMatchObject({ ok: false });
  });

  it("the office deletes a review; a cleaner's press, and another company's id, delete nothing", async () => {
    const c = await company();
    const other = await company("Other Co");
    const id = await review(c, 2, "Late");
    const theirs = await review(other, 2, "Late too");

    await as(c.anna, () => reviews.deleteReviewAction(form({ id })));
    expect(await api.sql("select 1 from public.reviews where id = $1", [id]), "a cleaner can't").toHaveLength(1);
    await as(c.owner, () => reviews.deleteReviewAction(form({ id: theirs })));
    expect(await api.sql("select 1 from public.reviews where id = $1", [theirs])).toHaveLength(1);
    await as(c.olha, () => reviews.deleteReviewAction(form({ id })));
    expect(await api.sql("select 1 from public.reviews where id = $1", [id])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("the feedback board", () => {
  async function item(c: Co, by: Member, status: string, title = "Clock-in button greyed out") {
    const [r] = await api.sql<{ id: string }>(
      "insert into public.feedback_items (organization_id, created_by, kind, title, status) values ($1, $2, 'bug', $3, $4) returning id",
      [c.org, by.membershipId, title, status],
    );
    return r.id;
  }
  const itemRow = async (id: string) =>
    (await api.sql<{ status: string }>("select status from public.feedback_items where id = $1", [id]))[0];
  const repliesOn = (id: string) =>
    api.sql<{ body: string; created_by: string }>("select body, created_by from public.feedback_replies where feedback_item_id = $1 order by created_at", [id]);

  it("a cleaner files a bug: it lands as hers, the owner and Sollos hear of it, and she is taken to it", async () => {
    const c = await company();
    const res = await as(c.anna, () =>
      feedback.createFeedbackAction({}, form({ kind: "bug", title: "Clock-in button greyed out", body: "Tapped three times at 9", page_context: "/field/jobs" })),
    );
    const rows = await api.sql<{ id: string; created_by: string; status: string; kind: string; page_context: string }>(
      "select id, created_by, status, kind, page_context from public.feedback_items where organization_id = $1",
      [c.org],
    );
    expect(rows, api.log()).toHaveLength(1);
    expect(res).toEqual({ redirected: `/app/feedback/${rows[0].id}` });
    expect(rows[0]).toMatchObject({ created_by: c.anna.membershipId, status: "open", kind: "bug", page_context: "/field/jobs" });

    const title = "Something's broken: Clock-in button greyed out";
    expect(await notesFor(c.owner, title)).toHaveLength(1);
    expect(await notesFor(c.anna, title), "not back to the reporter").toHaveLength(0);
    expect(outbox.support).toHaveLength(1);
    expect(outbox.support[0].subject).toBe(`[Something's broken] Clock-in button greyed out — ${c.name}`);
    expect(outbox.support[0].replyTo, "answering the email answers her").toBe(await emailOf(c.anna));
  });

  it("the office answers a cleaner's item and moves it along; she is told, with the new status", async () => {
    const c = await company();
    const id = await item(c, c.anna, "open");
    expect(await as(c.olha, () => feedback.replyFeedbackAction(id, {}, form({ body: "On it this week", status: "in_progress" })))).toEqual({});
    expect(await repliesOn(id)).toEqual([{ body: "On it this week", created_by: c.olha.membershipId }]);
    expect((await itemRow(id)).status).toBe("in_progress");
    const told = await notesFor(c.anna, "Reply: Clock-in button greyed out");
    expect(told.map((n) => n.body)).toEqual(["Being built — On it this week"]);
    expect(outbox.support, "Sollos isn't mailed about the office answering").toHaveLength(0);
  });

  it("a cleaner answers a question on her own item: it goes back to Sollos and the owner hears", async () => {
    const c = await company();
    const id = await item(c, c.anna, "needs_answer", "Which phone?");
    expect(await as(c.anna, () => feedback.replyFeedbackAction(id, {}, form({ body: "The Android one" })))).toEqual({});
    expect(await repliesOn(id)).toEqual([{ body: "The Android one", created_by: c.anna.membershipId }]);
    expect((await itemRow(id)).status, "the reply hands it back").toBe("open");
    expect(await notesFor(c.owner, "Reply: Which phone?")).toHaveLength(1);
    expect(outbox.support.map((s) => s.subject)).toEqual(["Re: Which phone?"]);
  });

  it("nobody else's thread: another cleaner, or another company's office, finds nothing to answer", async () => {
    const c = await company();
    const other = await company("Other Co");
    const id = await item(c, c.anna, "open");
    expect(await as(c.bea, () => feedback.replyFeedbackAction(id, {}, form({ body: "Me too" })))).toEqual({
      errors: { _form: "That item no longer exists." },
    });
    expect(await as(other.owner, () => feedback.replyFeedbackAction(id, {}, form({ body: "Hello", status: "closed" })))).toEqual({
      errors: { _form: "That item no longer exists." },
    });
    const card = await as(c.olha, () => feedback.replyFeedbackAction(id, {}, form({ body: "card 4242 4242 4242 4242" })));
    expect(formErrors(card)?.body).toBeTruthy();
    expect(await repliesOn(id)).toEqual([]);
    expect((await itemRow(id)).status).toBe("open");
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("packages", () => {
  async function pkg(c: Co, name: string) {
    const [r] = await api.sql<{ id: string }>(
      "insert into public.packages (organization_id, name, price_cents, duration_minutes) values ($1, $2, 15000, 180) returning id",
      [c.org, name],
    );
    return r.id;
  }
  const pkgForm = (over: Record<string, string> = {}) =>
    form({ name: "Deep clean, 3 bed", description: "Top to bottom", duration_minutes: "240", price_cents: "289.50", is_active: "on", included: "Oven, Fridge\nBaseboards", ...over });
  const pkgRow = async (id: string) =>
    (await api.sql<{ name: string; price_cents: number; is_active: boolean }>("select name, price_cents, is_active from public.packages where id = $1", [id]))[0];

  it("the office adds, changes and removes a package; a cleaner can't, and another company's is out of reach", async () => {
    const c = await company();
    const other = await company("Other Co");
    expect(await as(c.olha, () => packages.createPackageAction({}, pkgForm())), api.log()).toEqual({ redirected: "/app/packages" });
    const [made] = await api.sql<{ id: string; price_cents: number; duration_minutes: number; included: string[]; is_active: boolean }>(
      "select id, price_cents, duration_minutes, included, is_active from public.packages where organization_id = $1",
      [c.org],
    );
    expect(made).toMatchObject({ price_cents: 28950, duration_minutes: 240, included: ["Oven", "Fridge", "Baseboards"], is_active: true });
    expect(formErrors(await as(c.anna, () => packages.createPackageAction({}, pkgForm({ name: "Anna's" }))))?._form).toBeTruthy();
    expect(await api.sql("select 1 from public.packages where organization_id = $1", [c.org])).toHaveLength(1);

    expect(await as(c.owner, () => packages.updatePackageAction(made.id, {}, pkgForm({ name: "Deep clean 2026", is_active: "" })))).toEqual({
      redirected: "/app/packages",
    });
    expect(await pkgRow(made.id)).toEqual({ name: "Deep clean 2026", price_cents: 28950, is_active: false });
    await as(c.anna, () => packages.updatePackageAction(made.id, {}, pkgForm({ name: "Anna's", price_cents: "1" })));
    expect((await pkgRow(made.id)).name, "a cleaner can't").toBe("Deep clean 2026");

    const theirs = await pkg(other, "Their standard");
    await as(c.owner, () => packages.updatePackageAction(theirs, {}, pkgForm({ name: "Mine now" })));
    await as(c.owner, () => packages.deletePackageAction(form({ id: theirs })));
    expect(await pkgRow(theirs)).toEqual({ name: "Their standard", price_cents: 15000, is_active: true });

    await as(c.anna, () => packages.deletePackageAction(form({ id: made.id })));
    expect(await pkgRow(made.id), "a cleaner can't delete").toBeDefined();
    expect(await as(c.olha, () => packages.deletePackageAction(form({ id: made.id })))).toEqual({ redirected: "/app/packages" });
    expect(await pkgRow(made.id)).toBeUndefined();
  });

  it("a save that changed no package says so", async () => {
    const c = await company();
    const other = await company("Other Co");
    const theirs = await pkg(other, "Their standard");
    const res = await as(c.owner, () => packages.updatePackageAction(theirs, {}, pkgForm({ name: "Mine now" })));
    expect((await pkgRow(theirs)).name).toBe("Their standard");
    expect(formErrors(res)?._form).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("inventory", () => {
  const invForm = (over: Record<string, string> = {}) =>
    form({ name: "Glass cleaner", category: "chemical", quantity: "10", reorder_threshold: "4", assigned_to: "", notes: "", ...over });
  const invRow = async (id: string) =>
    (await api.sql<{ name: string; quantity: number; assigned_to: string | null }>("select name, quantity, assigned_to from public.inventory_items where id = $1", [id]))[0];
  async function item(c: Co, name: string) {
    const [r] = await api.sql<{ id: string }>(
      "insert into public.inventory_items (organization_id, name, category, quantity, reorder_threshold) values ($1, $2, 'equipment', 3, 1) returning id",
      [c.org, name],
    );
    return r.id;
  }

  it("the office adds, changes and removes stock; a cleaner can't, and another company's is out of reach", async () => {
    const c = await company();
    const other = await company("Other Co");
    expect(await as(c.olha, () => inventory.createInventoryAction({}, invForm({ assigned_to: c.anna.membershipId }))), api.log()).toEqual({
      redirected: "/app/inventory",
    });
    const [made] = await api.sql<{ id: string }>("select id from public.inventory_items where organization_id = $1", [c.org]);
    expect(await invRow(made.id)).toEqual({ name: "Glass cleaner", quantity: 10, assigned_to: c.anna.membershipId });
    expect(formErrors(await as(c.anna, () => inventory.createInventoryAction({}, invForm({ name: "Anna's" }))))?._form).toBeTruthy();

    await as(c.owner, () => inventory.updateInventoryAction(made.id, {}, invForm({ quantity: "8" })));
    expect((await invRow(made.id)).quantity).toBe(8);
    await as(c.anna, () => inventory.updateInventoryAction(made.id, {}, invForm({ quantity: "0" })));
    expect((await invRow(made.id)).quantity, "a cleaner can't").toBe(8);

    const theirs = await item(other, "Their vacuum");
    await as(c.owner, () => inventory.updateInventoryAction(theirs, {}, invForm({ name: "Mine now" })));
    await as(c.owner, () => inventory.deleteInventoryAction(form({ id: theirs })));
    expect(await invRow(theirs)).toEqual({ name: "Their vacuum", quantity: 3, assigned_to: null });

    await as(c.anna, () => inventory.deleteInventoryAction(form({ id: made.id })));
    expect(await invRow(made.id)).toBeDefined();
    expect(await as(c.olha, () => inventory.deleteInventoryAction(form({ id: made.id })))).toEqual({ redirected: "/app/inventory" });
    expect(await invRow(made.id)).toBeUndefined();
  });

  it("stock dropping to its reorder level tells the office, and only the office", async () => {
    const c = await company();
    await as(c.olha, () => inventory.createInventoryAction({}, invForm()));
    const [made] = await api.sql<{ id: string }>("select id from public.inventory_items where organization_id = $1", [c.org]);
    await as(c.olha, () => inventory.updateInventoryAction(made.id, {}, invForm({ quantity: "3" })));
    expect(
      await api.sql("select min_role::text as min_role, recipient_membership_id from public.notifications where organization_id = $1 and title = 'Low stock: Glass cleaner'", [c.org]),
    ).toEqual([{ min_role: "manager", recipient_membership_id: null }]);
  });

  it("low stock gives whoever looks after the item a task and tells them, once", async () => {
    const c = await company();
    await as(c.olha, () => inventory.createInventoryAction({}, invForm({ assigned_to: c.anna.membershipId })));
    const [made] = await api.sql<{ id: string }>("select id from public.inventory_items where organization_id = $1", [c.org]);
    const tasks = () =>
      api.sql<{ title: string; assigned_to: string; notes: string; done: boolean }>(
        "select title, assigned_to, notes, completed_at is not null as done from public.tasks where organization_id = $1 order by created_at",
        [c.org],
      );
    expect(await tasks(), "10 in stock, level 4: nothing yet").toEqual([]);

    await as(c.olha, () => inventory.updateInventoryAction(made.id, {}, invForm({ quantity: "3", assigned_to: c.anna.membershipId })));
    expect(await tasks(), api.log()).toEqual([
      { title: "Restock: Glass cleaner", assigned_to: c.anna.membershipId, notes: "Glass cleaner is down to 3 (low-stock level 4).", done: false },
    ]);
    const told = () =>
      api.sql<{ r: string; href: string }>(
        "select recipient_membership_id as r, href from public.notifications where organization_id = $1 and title = 'Low stock: a task for you'",
        [c.org],
      );
    expect(await told()).toEqual([{ r: c.anna.membershipId, href: "/field/tasks" }]);

    // Still low, counted down again: no second task, no second notice.
    await as(c.olha, () => inventory.updateInventoryAction(made.id, {}, invForm({ quantity: "2", assigned_to: c.anna.membershipId })));
    expect(await tasks()).toHaveLength(1);
    expect(await told()).toHaveLength(1);
  });

  it("a save that changed no item says so", async () => {
    const c = await company();
    const other = await company("Other Co");
    const theirs = await item(other, "Their vacuum");
    const res = await as(c.owner, () => inventory.updateInventoryAction(theirs, {}, invForm({ name: "Mine now" })));
    expect((await invRow(theirs)).name).toBe("Their vacuum");
    expect(formErrors(res)?._form).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("the network list", () => {
  const netForm = (over: Record<string, string> = {}) =>
    form({ name: "Dana Realty", category: "realtor", company: "Dana & Co", phone: "306-555-0110", email: "dana@example.com", notes: "", ...over });
  const netRow = async (id: string) =>
    (await api.sql<{ name: string; category: string }>("select name, category from public.network_contacts where id = $1", [id]))[0];
  async function contact(c: Co, name: string) {
    const [r] = await api.sql<{ id: string }>(
      "insert into public.network_contacts (organization_id, name, category) values ($1, $2, 'supplier') returning id",
      [c.org, name],
    );
    return r.id;
  }

  it("the office adds, edits and removes a contact; a cleaner can't, and another company's is out of reach", async () => {
    const c = await company();
    const other = await company("Other Co");
    expect(await as(c.olha, () => network.createNetworkContactAction({}, netForm())), api.log()).toEqual({ redirected: "/app/network" });
    const [made] = await api.sql<{ id: string; created_by: string; email: string }>(
      "select id, created_by, email from public.network_contacts where organization_id = $1",
      [c.org],
    );
    expect(made).toMatchObject({ created_by: c.olha.membershipId, email: "dana@example.com" });
    expect(formErrors(await as(c.anna, () => network.createNetworkContactAction({}, netForm({ name: "Anna's" }))))?._form).toBeTruthy();

    await as(c.owner, () => network.updateNetworkContactAction(made.id, {}, netForm({ name: "Dana Realty Group", category: "referral_partner" })));
    expect(await netRow(made.id)).toEqual({ name: "Dana Realty Group", category: "referral_partner" });
    await as(c.anna, () => network.updateNetworkContactAction(made.id, {}, netForm({ name: "Anna's" })));
    expect((await netRow(made.id)).name).toBe("Dana Realty Group");

    const theirs = await contact(other, "Their supplier");
    await as(c.owner, () => network.updateNetworkContactAction(theirs, {}, netForm({ name: "Mine now" })));
    await as(c.owner, () => network.deleteNetworkContactAction(form({ id: theirs })));
    expect(await netRow(theirs)).toEqual({ name: "Their supplier", category: "supplier" });

    await as(c.anna, () => network.deleteNetworkContactAction(form({ id: made.id })));
    expect(await netRow(made.id)).toBeDefined();
    expect(await as(c.olha, () => network.deleteNetworkContactAction(form({ id: made.id })))).toEqual({ redirected: "/app/network" });
    expect(await netRow(made.id)).toBeUndefined();
    const history = (await auditFor(c.org, made.id)).map((a) => a.action);
    expect([history[0], history.at(-1)]).toEqual(["create", "delete"]);
  });

  it("a save that changed no contact says so, and logs nothing", async () => {
    const c = await company();
    const other = await company("Other Co");
    const theirs = await contact(other, "Their supplier");
    const res = await as(c.owner, () => network.updateNetworkContactAction(theirs, {}, netForm({ name: "Mine now" })));
    expect((await netRow(theirs)).name).toBe("Their supplier");
    expect(await auditFor(c.org, theirs), "no update to log").toEqual([]);
    expect(formErrors(res)?._form).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("the on-call list", () => {
  const benchForm = (over: Record<string, string> = {}) =>
    form({ full_name: "Iryna Bench", phone: "+1 (306) 555-0101", email: "iryna@example.com", notes: "", active: "on", ...over });
  const benchRow = async (id: string) =>
    (await api.sql<{ full_name: string; phone: string; active: boolean; notes: string | null }>(
      "select full_name, phone, active, notes from public.freelancer_contacts where id = $1",
      [id],
    ))[0];
  async function bench(c: Co, name: string, phone = "+13065550150") {
    const [r] = await api.sql<{ id: string }>(
      "insert into public.freelancer_contacts (organization_id, full_name, phone) values ($1, $2, $3) returning id",
      [c.org, name, phone],
    );
    return r.id;
  }

  it("the office adds, edits and removes a contact; a cleaner can't, and another company's is out of reach", async () => {
    const c = await company();
    const other = await company("Other Co");
    expect(await as(c.olha, () => freelancers.createFreelancerContactAction({}, benchForm())), api.log()).toEqual({ redirected: "/app/freelancers" });
    const [made] = await api.sql<{ id: string }>("select id from public.freelancer_contacts where organization_id = $1", [c.org]);
    expect(await benchRow(made.id)).toEqual({ full_name: "Iryna Bench", phone: "+13065550101", active: true, notes: null });
    expect(formErrors(await as(c.anna, () => freelancers.createFreelancerContactAction({}, benchForm({ full_name: "Anna's friend" }))))?._form).toBeTruthy();

    // The active box left unticked takes her off the list.
    const edit = form({ full_name: "Iryna Koval", phone: "+13065550101", email: "", notes: "Has a car" });
    expect(await as(c.owner, () => freelancers.updateFreelancerContactAction(made.id, {}, edit))).toEqual({ redirected: "/app/freelancers" });
    expect(await benchRow(made.id)).toEqual({ full_name: "Iryna Koval", phone: "+13065550101", active: false, notes: "Has a car" });
    await as(c.anna, () => freelancers.updateFreelancerContactAction(made.id, {}, benchForm({ full_name: "Anna's friend" })));
    expect((await benchRow(made.id)).full_name).toBe("Iryna Koval");

    const theirs = await bench(other, "Their bench");
    await as(c.owner, () => freelancers.updateFreelancerContactAction(theirs, {}, benchForm({ full_name: "Mine now" })));
    await as(c.owner, () => freelancers.deleteFreelancerContactAction(form({ id: theirs })));
    expect((await benchRow(theirs)).full_name).toBe("Their bench");

    await as(c.anna, () => freelancers.deleteFreelancerContactAction(form({ id: made.id })));
    expect(await benchRow(made.id)).toBeDefined();
    expect(await as(c.olha, () => freelancers.deleteFreelancerContactAction(form({ id: made.id })))).toEqual({ redirected: "/app/freelancers" });
    expect(await benchRow(made.id)).toBeUndefined();
  });

  it("a local ten-digit number is saved as the North American number it is", async () => {
    const c = await company();
    await as(c.olha, () => freelancers.createFreelancerContactAction({}, benchForm({ phone: "780 271 1971" })));
    const [made] = await api.sql<{ phone: string }>("select phone from public.freelancer_contacts where organization_id = $1", [c.org]);
    expect(made?.phone).toBe("+17802711971");
  });

  it("a manager without the on-call pool can't add, change or remove contacts", async () => {
    const c = await company();
    const kept = await bench(c, "Kept Bench");
    await narrow(c.olha, { subcontractors: false });
    const added = await as(c.olha, () => freelancers.createFreelancerContactAction({}, benchForm({ full_name: "Sneaked In" })));
    await as(c.olha, () => freelancers.updateFreelancerContactAction(kept, {}, benchForm({ full_name: "Renamed" })));
    await as(c.olha, () => freelancers.deleteFreelancerContactAction(form({ id: kept })));
    expect(await api.sql("select 1 from public.freelancer_contacts where full_name = 'Sneaked In' and organization_id = $1", [c.org])).toHaveLength(0);
    expect((await benchRow(kept))?.full_name).toBe("Kept Bench");
    expect(formErrors(added)?._form ?? formErrors(added)?.full_name).toBeTruthy();
  });

  it("a save that changed no contact says so", async () => {
    const c = await company();
    const other = await company("Other Co");
    const theirs = await bench(other, "Their bench");
    const res = await as(c.owner, () => freelancers.updateFreelancerContactAction(theirs, {}, benchForm({ full_name: "Mine now" })));
    expect((await benchRow(theirs)).full_name).toBe("Their bench");
    expect(await auditFor(c.org, theirs), "no update to log").toEqual([]);
    expect(formErrors(res)?._form).toBeTruthy();
  });

  it("a delete that removed nothing leaves no 'deleted' in the history", async () => {
    const c = await company();
    const mine = await bench(c, "My bench");
    await as(c.anna, () => freelancers.deleteFreelancerContactAction(form({ id: mine })));
    expect(await benchRow(mine), "a cleaner can't delete").toBeDefined();
    expect((await auditFor(c.org, mine)).map((a) => a.action)).not.toContain("delete");
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("shift offers", () => {
  const at = (days: number, utcHour: number) => {
    const d = new Date(Date.now() + days * 86_400_000);
    d.setUTCHours(utcHour, 0, 0, 0);
    return d.toISOString();
  };

  async function setup() {
    const c = await company();
    const other = await company("Other Co");
    const client = await addClient(api.sql, c.org, "Nancy Ellestad");
    const job = await addBooking(api.sql, c.org, client, { scheduledAt: at(3, 16), durationMinutes: 180 });
    await api.sql("update public.bookings set address = '12 Elm Street\nRegina' where id = $1", [job]);
    const contact = async (org: string, name: string, phone: string, extra = "") => {
      const [r] = await api.sql<{ id: string }>(
        `insert into public.freelancer_contacts (organization_id, full_name, phone, active, sms_opted_out_at)
         values ($1, $2, $3, ${extra.includes("inactive") ? "false" : "true"}, ${extra.includes("stop") ? "now()" : "null"}) returning id`,
        [org, name, phone],
      );
      return r.id;
    };
    const iryna = await contact(c.org, "Iryna", "+13065550101");
    const oksana = await contact(c.org, "Oksana", "+13065550102", "inactive");
    const petra = await contact(c.org, "Petra", "+13065550103", "stop");
    const theirContact = await contact(other.org, "Theirs", "+13065550104");
    const sub = await addMember(api.sql, c.org, "employee", "Sasha");
    await api.sql("update public.memberships set engagement = 'subcontractor', contact_phone = '+13065550199' where id = $1", [sub.membershipId]);
    await api.sql("update public.memberships set contact_phone = '+13065550198' where id = $1", [c.anna.membershipId]);
    const theirSub = await addMember(api.sql, other.org, "employee", "Their Sub");
    await api.sql("update public.memberships set engagement = 'subcontractor', contact_phone = '+13065550197' where id = $1", [theirSub.membershipId]);
    return { c, other, client, job, iryna, oksana, petra, theirContact, sub, theirSub };
  }

  const offerForm = (job: string, contacts: string[], members: string[]) => {
    const f = form({ booking_id: job, pay_dollars: "120", notes: "Bring a vacuum", positions_needed: "1", expires_in_minutes: "60" });
    for (const id of contacts) f.append("contact_ids", id);
    for (const id of members) f.append("member_ids", id);
    return f;
  };

  it("go only to the chosen on-call cleaners who are active and haven't said STOP, and to our own subcontractors", async () => {
    const s = await setup();
    const res = await as(s.c.olha, () =>
      freelancers.createJobOfferAction(
        {},
        offerForm(s.job, [s.iryna, s.oksana, s.petra, s.theirContact], [s.sub.membershipId, s.c.anna.membershipId, s.theirSub.membershipId]),
      ),
    );
    const offers = await api.sql<{ id: string; status: string; pay_cents: number; posted_by: string }>(
      "select id, status, pay_cents, posted_by from public.job_offers where booking_id = $1",
      [s.job],
    );
    expect(offers, JSON.stringify(res)).toHaveLength(1);
    expect(res).toEqual({ redirected: `/app/freelancers/offers/${offers[0].id}` });
    expect(offers[0]).toMatchObject({ status: "open", pay_cents: 12000, posted_by: s.c.olha.membershipId });

    const dispatches = await api.sql<{ contact_id: string | null; membership_id: string | null; claim_token: string; delivery_status: string }>(
      "select contact_id, membership_id, claim_token, delivery_status from public.job_offer_dispatches where offer_id = $1",
      [offers[0].id],
    );
    expect(dispatches.map((d) => d.contact_id ?? d.membership_id).sort()).toEqual([s.iryna, s.sub.membershipId].sort());
    expect(dispatches.every((d) => d.delivery_status === "sent")).toBe(true);
    expect(outbox.sms.map((m) => m.to).sort()).toEqual(["+13065550101", "+13065550199"]);
    for (const d of dispatches) {
      const to = d.contact_id ? "+13065550101" : "+13065550199";
      expect(outbox.sms.find((m) => m.to === to)?.body).toContain(`/claim/${d.claim_token}`);
    }
    expect(outbox.sms.every((m) => m.org === s.c.org), "sent from the company's own number").toBe(true);
    const stamped = await api.sql<{ id: string }>(
      "select id from public.freelancer_contacts where last_offered_at is not null and id = any($1::uuid[])",
      [[s.iryna, s.oksana, s.petra, s.theirContact]],
    );
    expect(stamped.map((r) => r.id)).toEqual([s.iryna]);
  });

  it("are refused to a cleaner, to a manager without the on-call pool, and for another company's job", async () => {
    const s = await setup();
    const theirClient = await addClient(api.sql, s.other.org, "Their Client");
    const theirJob = await addBooking(api.sql, s.other.org, theirClient, { scheduledAt: at(4, 16) });

    expect(await as(s.c.anna, () => freelancers.createJobOfferAction({}, offerForm(s.job, [s.iryna], [])))).toMatchObject({
      errors: { contact_ids: "Sending shift offers isn't part of your access. Ask an owner to turn it on." },
    });
    expect(await as(s.c.owner, () => freelancers.createJobOfferAction({}, offerForm(theirJob, [s.iryna], [])))).toMatchObject({
      errors: { _form: "Booking not found" },
    });
    expect(await as(s.c.owner, () => freelancers.createJobOfferAction({}, offerForm(s.job, [], [])))).toMatchObject({
      errors: { contact_ids: "Pick at least one recipient" },
    });
    expect(await as(s.c.owner, () => freelancers.createJobOfferAction({}, offerForm(s.job, [s.oksana, s.petra, s.theirContact], [s.theirSub.membershipId])))).toMatchObject({
      errors: { contact_ids: expect.stringContaining("Nobody left to text") },
    });
    await narrow(s.c.olha, { subcontractors: false });
    expect(await as(s.c.olha, () => freelancers.createJobOfferAction({}, offerForm(s.job, [s.iryna], [])))).toMatchObject({
      errors: { contact_ids: "Sending shift offers isn't part of your access. Ask an owner to turn it on." },
    });

    expect(await api.sql("select 1 from public.job_offers where booking_id = any($1::uuid[])", [[s.job, theirJob]])).toHaveLength(0);
    expect(outbox.sms).toHaveLength(0);
  });

  async function openOffer(s: Awaited<ReturnType<typeof setup>>) {
    const [offer] = await api.sql<{ id: string }>(
      `insert into public.job_offers (organization_id, booking_id, posted_by, pay_cents, status, expires_at, positions_needed, positions_filled)
       values ($1, $2, $3, 12000, 'open', now() + interval '1 hour', 1, 0) returning id`,
      [s.c.org, s.job, s.c.owner.membershipId],
    );
    const token = `opscancel${offer.id.replace(/-/g, "").slice(0, 16)}`;
    await api.sql("insert into public.job_offer_dispatches (organization_id, offer_id, contact_id, claim_token) values ($1, $2, $3, $4)", [
      s.c.org,
      offer.id,
      s.iryna,
      token,
    ]);
    return { offer: offer.id, token };
  }
  const offerStatus = async (id: string) =>
    (await api.sql<{ status: string; positions_filled: number }>("select status, positions_filled from public.job_offers where id = $1", [id]))[0];

  it("only the office of the company that posted it can cancel it, and a cancelled offer can't be claimed", async () => {
    const s = await setup();
    const { offer, token } = await openOffer(s);

    await as(s.c.anna, () => freelancers.cancelJobOfferAction(form({ id: offer })));
    await as(s.other.owner, () => freelancers.cancelJobOfferAction(form({ id: offer })));
    expect((await offerStatus(offer)).status, "a cleaner, or another company, can't cancel it").toBe("open");

    await as(s.c.olha, () => freelancers.cancelJobOfferAction(form({ id: offer })));
    expect((await offerStatus(offer)).status).toBe("cancelled");
    expect((await auditFor(s.c.org, offer)).map((a) => a.action)).toEqual(["status_change"]);

    request.cookies = [];
    expect(await claimOfferAction(token)).toEqual({ ok: false, reason: "cancelled" });
    expect(await offerStatus(offer)).toEqual({ status: "cancelled", positions_filled: 0 });
    expect(await api.sql("select 1 from public.job_offer_claims where offer_id = $1", [offer])).toHaveLength(0);
    expect(await claimOfferAction("not-a-real-token-at-all")).toEqual({ ok: false, reason: "invalid" });
  });

  it("a manager without the on-call pool can't cancel an offer", async () => {
    const s = await setup();
    const { offer } = await openOffer(s);
    await narrow(s.c.olha, { subcontractors: false });
    await as(s.c.olha, () => freelancers.cancelJobOfferAction(form({ id: offer })));
    expect((await offerStatus(offer)).status).toBe("open");
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("tasks", () => {
  async function task(c: Co, opts: { title: string; assignedTo?: Member | null; remindAt?: string | null; remindedAt?: string | null; dueAt?: string | null; completed?: boolean }) {
    const [r] = await api.sql<{ id: string }>(
      `insert into public.tasks (organization_id, created_by, assigned_to, title, remind_at, reminded_at, due_at, completed_at)
       values ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::timestamptz, ${opts.completed ? "now()" : "null"}) returning id`,
      [c.org, c.owner.membershipId, opts.assignedTo?.membershipId ?? null, opts.title, opts.remindAt ?? null, opts.remindedAt ?? null, opts.dueAt ?? null],
    );
    return r.id;
  }
  const taskRow = async (id: string) =>
    (
      await api.sql<{ title: string; assigned_to: string | null; due_at: string | null; remind_at: string | null; reminded_at: string | null }>(
        `select title, assigned_to,
                to_char(due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as due_at,
                to_char(remind_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as remind_at,
                reminded_at::text as reminded_at
           from public.tasks where id = $1`,
        [id],
      )
    )[0];
  const taskForm = (over: Record<string, string>) =>
    form({ title: "Order microfibre cloths", notes: "", assigned_to: "", due_at: "", remind_at: "", recurrence: "", ...over });

  it("the office edits a task; a cleaner can't clear one, and another company's is out of reach", async () => {
    const c = await company();
    const other = await company("Other Co");
    const id = await task(c, { title: "Order microfibre", assignedTo: c.olha });
    const res = await as(c.olha, () => tasks.updateTaskAction(id, {}, taskForm({ title: "Order microfibre cloths", assigned_to: c.bea.membershipId })));
    expect(res, api.log()).toEqual({ redirected: "/app/tasks" });
    expect(await taskRow(id)).toMatchObject({ title: "Order microfibre cloths", assigned_to: c.bea.membershipId });

    // Editing is the office's; a cleaner is told so.
    const byAnna = await as(c.anna, () => tasks.updateTaskAction(id, {}, taskForm({ title: "Anna was here" })));
    expect(formErrors(byAnna)?._form).toBe("Only the office can edit a task.");
    expect((await taskRow(id)).title).toBe("Order microfibre cloths");

    const theirs = await task(other, { title: "Their task" });
    await as(c.owner, () => tasks.updateTaskAction(theirs, {}, taskForm({ title: "Mine now" })));
    expect((await taskRow(theirs)).title).toBe("Their task");
  });

  it("a cleaner can't take over a task that isn't hers, through the app or straight through the API", async () => {
    const c = await company();
    const id = await task(c, { title: "Call the window supplier", assignedTo: c.olha });
    await as(c.anna, () => tasks.updateTaskAction(id, {}, taskForm({ title: "Nothing to see", assigned_to: c.anna.membershipId })));
    expect(await taskRow(id)).toMatchObject({ title: "Call the window supplier", assigned_to: c.olha.membershipId });
    // Around the app, with her own sign-in: the database rule is the backstop.
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/tasks?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        Authorization: `Bearer ${api.tokenFor(c.anna.userId)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Mine now", assigned_to: c.anna.membershipId }),
    });
    expect(await taskRow(id)).toMatchObject({ title: "Call the window supplier", assigned_to: c.olha.membershipId });
  });

  it("opening a task and saving it unchanged keeps its due time and reminder", async () => {
    const c = await company();
    // Due 9:00 AM Regina on Dec 1 (15:00 UTC), reminder at 8:00 AM.
    const id = await task(c, { title: "Inspect the Hill house", assignedTo: c.olha, dueAt: "2026-12-01T15:00:00Z", remindAt: "2026-12-01T14:00:00Z" });
    // What the edit page puts in the boxes for a browser in Regina.
    const local = (iso: string) =>
      new Date(iso).toLocaleString("sv-SE", { timeZone: "America/Regina", hour12: false }).replace(" ", "T").slice(0, 16);
    expect(local("2026-12-01T15:00:00Z")).toBe("2026-12-01T09:00");
    await as(c.olha, () =>
      tasks.updateTaskAction(
        id,
        {},
        taskForm({ title: "Inspect the Hill house", assigned_to: c.olha.membershipId, due_at: local("2026-12-01T15:00:00Z"), remind_at: local("2026-12-01T14:00:00Z") }),
      ),
    );
    expect(await taskRow(id)).toMatchObject({ due_at: "2026-12-01T15:00Z", remind_at: "2026-12-01T14:00Z" });
  });

  it("editing a task whose reminder already went doesn't send it again", async () => {
    const c = await company();
    const remindAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const id = await task(c, { title: "Restock the van", assignedTo: c.olha, remindAt, remindedAt: new Date(Date.now() - 3_600_000).toISOString() });
    // The same reminder instant goes back (as an exact instant, so the wall-clock fault above doesn't move it).
    await as(c.olha, () => tasks.updateTaskAction(id, {}, taskForm({ title: "Restock the van (both)", assigned_to: c.olha.membershipId, remind_at: remindAt })));
    expect((await taskRow(id)).title).toBe("Restock the van (both)");
    expect((await cron(taskRemindersCron, "/api/cron/task-reminders")).status).toBe(200);
    expect(outbox.push.filter((p) => p.to === c.olha.membershipId && p.title.includes("Restock the van"))).toEqual([]);
  });

  it("a save that changed no task says so", async () => {
    const c = await company();
    const other = await company("Other Co");
    const theirs = await task(other, { title: "Their task" });
    const res = await as(c.owner, () => tasks.updateTaskAction(theirs, {}, taskForm({ title: "Mine now" })));
    expect((await taskRow(theirs)).title).toBe("Their task");
    expect(formErrors(res)?._form).toBeTruthy();
  });

  it("the hourly job reminds the assignee once, or the office when nobody is, and skips done and future tasks", async () => {
    const c = await company();
    const other = await company("Other Co");
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const mine = await task(c, { title: "Ops remind assigned", assignedTo: c.anna, remindAt: ago(10) });
    const nobody = await task(c, { title: "Ops remind unassigned", remindAt: ago(20) });
    const done = await task(c, { title: "Ops remind done", assignedTo: c.bea, remindAt: ago(10), completed: true });
    const later = await task(c, { title: "Ops remind later", assignedTo: c.bea, remindAt: ago(-120) });
    await task(other, { title: "Ops remind theirs", remindAt: ago(5) });

    expect((await cron(taskRemindersCron, "/api/cron/task-reminders", "wrong-secret-wrong-secret")).status).toBe(401);
    expect(outbox.push).toHaveLength(0);

    expect((await cron(taskRemindersCron, "/api/cron/task-reminders")).status).toBe(200);
    const to = (title: string) =>
      outbox.push
        .filter((p) => p.title === `📋 Task reminder: ${title}`)
        .map((p) => p.to)
        .sort();
    expect(to("Ops remind assigned")).toEqual([c.anna.membershipId]);
    expect(to("Ops remind unassigned")).toEqual([c.owner.membershipId, c.olha.membershipId].sort());
    expect(to("Ops remind theirs")).toEqual([other.owner.membershipId, other.olha.membershipId].sort());
    expect(to("Ops remind done")).toEqual([]);
    expect(to("Ops remind later")).toEqual([]);
    expect((await taskRow(mine)).reminded_at).not.toBeNull();
    expect((await taskRow(nobody)).reminded_at).not.toBeNull();
    expect((await taskRow(done)).reminded_at).toBeNull();
    expect((await taskRow(later)).reminded_at).toBeNull();

    outbox.push.length = 0;
    await cron(taskRemindersCron, "/api/cron/task-reminders");
    expect(outbox.push.filter((p) => p.title.startsWith("📋 Task reminder: Ops remind")), "once each").toEqual([]);
  });
});

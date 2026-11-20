/**
 * Each office person chooses which notices alert them (2026-11-19).
 *
 * The office is sent about forty different notices, every one to every
 * owner, admin and manager, as a phone alert. Now each of them can turn a
 * topic down: no phone alert and no email for it, while the bell in the app
 * still lists it. Cleaners have no such choice.
 *
 * The real sender and the real Save, on a real database. The phone and the
 * email are caught; the bell is read from the notifications table.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

const outbox = vi.hoisted(() => ({ push: [] as Array<{ to: string; title: string }>, email: [] as Array<{ to: string; subject: string }> }));
vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));
vi.mock("@/lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/push")>()),
  sendPushToMembership: async (to: string, p: { title: string }) => {
    outbox.push.push({ to, title: p.title });
    return 1;
  },
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  isEmailConfigured: () => true,
  sendOrgEmail: async (_o: string, a: { to: string; subject: string }) => {
    outbox.email.push({ to: a.to, subject: a.subject });
    return true;
  },
}));

let api: Api;
let restoreEnv: () => void;
let sender: typeof import("@/lib/notify");
let choices: typeof import("@/app/app/notifications/choices/actions");

beforeAll(async () => {
  process.env.INTEGRATION_ENCRYPTION_KEY ??= `base64:${randomBytes(32).toString("base64")}`;
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  sender = await import("@/lib/notify");
  choices = await import("@/app/app/notifications/choices/actions");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  outbox.push.length = 0;
  outbox.email.length = 0;
});

type Co = { org: string; owner: Member; admin: Member; manager: Member; anna: Member };
async function company(): Promise<Co> {
  const org = await addOrg(api.sql, "Choices Co");
  const co = {
    org,
    owner: await addMember(api.sql, org, "owner", "Owner"),
    admin: await addMember(api.sql, org, "admin", "Admin"),
    manager: await addMember(api.sql, org, "manager", "Manager"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
  // An address for each, so the email channel has somewhere to go.
  for (const [name, m] of Object.entries({ owner: co.owner, admin: co.admin, manager: co.manager, anna: co.anna })) {
    await api.sql("update public.memberships set contact_email = $2 where id = $1", [m.membershipId, `${name}-${m.membershipId.slice(0, 6)}@example.test`]);
  }
  return co;
}

async function save(who: Member, alert: string[]) {
  request.cookies = api.sessionCookies(who.userId);
  try {
    const f = new FormData();
    for (const a of alert) f.append("alert", a);
    return await choices.saveMyNotificationChoicesAction({}, f);
  } finally {
    await settle();
  }
}

const prefsOf = async (m: Member) =>
  (await api.sql<{ p: { muted_topics?: string[] } }>("select notification_prefs as p from public.memberships where id = $1", [m.membershipId]))[0].p;
const bellFor = async (c: Co, title: string) =>
  (await api.sql<{ to: string }>("select recipient_membership_id as to from public.notifications where organization_id = $1 and title = $2", [c.org, title]))
    .map((r) => r.to)
    .sort();
const pushedTo = (title: string) => outbox.push.filter((p) => p.title === title).map((p) => p.to).sort();
const ids = (...m: Member[]) => m.map((x) => x.membershipId).sort();
const ALL = ["schedule", "clock", "time_off", "clients", "money", "team"];

describe.skipIf(!hasPostgrest)("saving what alerts you", { timeout: 120_000 }, () => {
  it("the office saves its own choices; everyone starts on everything", async () => {
    const c = await company();
    expect(await prefsOf(c.manager)).toEqual({});

    expect(await save(c.manager, ALL.filter((t) => t !== "money" && t !== "clients")), api.log()).toEqual({ ok: true });
    // Stored in the app's own order, whatever order the form sent.
    expect(await prefsOf(c.manager)).toEqual({ muted_topics: ["clients", "money"] });
    // Nobody else's changed.
    expect(await prefsOf(c.owner)).toEqual({});
    expect(await prefsOf(c.admin)).toEqual({});

    // Everything ticked again: nothing muted.
    expect(await save(c.manager, ALL)).toEqual({ ok: true });
    expect(await prefsOf(c.manager)).toEqual({ muted_topics: [] });
    // Nothing ticked: everything a person can mute, muted.
    expect(await save(c.owner, [])).toEqual({ ok: true });
    expect((await prefsOf(c.owner)).muted_topics).toEqual(["schedule", "clock", "time_off", "clients", "money", "team"]);
  });

  it("a cleaner has no choices, and a made-up topic is ignored", async () => {
    const c = await company();
    expect(await save(c.anna, [])).toEqual({ error: "Notification choices are for the office." });
    expect(await prefsOf(c.anna)).toEqual({});

    expect(await save(c.admin, [...ALL, "everything", "<script>"])).toEqual({ ok: true });
    expect(await prefsOf(c.admin)).toEqual({ muted_topics: [] });
  });
});

describe.skipIf(!hasPostgrest)("a notice to the office", { timeout: 120_000 }, () => {
  it("everyone gets the bell; only those who haven't turned the topic down get the phone and the email", async () => {
    const c = await company();
    await save(c.manager, ALL.filter((t) => t !== "money"));

    await sender.notify({
      audience: "org-management",
      organizationId: c.org,
      topic: "money",
      title: "Refund issued",
      body: "A refund went out.",
      href: "/app/invoices",
      channels: { email: true },
    });
    expect(await bellFor(c, "Refund issued")).toEqual(ids(c.owner, c.admin, c.manager));
    expect(pushedTo("Refund issued")).toEqual(ids(c.owner, c.admin));
    expect(outbox.email.map((e) => e.to.split("-")[0]).sort()).toEqual(["admin", "owner"]);

    // A topic the manager kept on reaches the manager as before.
    await sender.notify({
      audience: "org-management",
      organizationId: c.org,
      topic: "schedule",
      title: "Unfilled shift",
      body: "Nobody has taken it.",
      href: "/app/scheduling",
    });
    expect(pushedTo("Unfilled shift")).toEqual(ids(c.owner, c.admin, c.manager));
  });

  it("a notice with no topic always alerts, whatever was turned down", async () => {
    const c = await company();
    await save(c.owner, []);
    await save(c.admin, []);

    await sender.notify({
      audience: "org-admins",
      organizationId: c.org,
      type: "sms_cap",
      title: "SMS paused",
      body: "The monthly limit was reached.",
      href: "/app/settings",
    });
    expect(pushedTo("SMS paused")).toEqual(ids(c.owner, c.admin));
  });

  it("a cleaner is always alerted: choices are the office's, even if a cleaner's row somehow held one", async () => {
    const c = await company();
    await api.sql(`update public.memberships set notification_prefs = '{"muted_topics":["schedule"]}'::jsonb where id = $1`, [c.anna.membershipId]);
    await sender.notify({
      audience: "membership",
      membershipId: c.anna.membershipId,
      organizationId: c.org,
      topic: "schedule",
      title: "You're on a job tomorrow",
      body: "9:00 AM.",
      href: "/field/jobs",
    });
    expect(pushedTo("You're on a job tomorrow")).toEqual(ids(c.anna));

    // The same, sent by name to a manager who turned the topic down: quiet.
    await save(c.manager, ALL.filter((t) => t !== "schedule"));
    await sender.notify({
      audience: "membership",
      membershipId: c.manager.membershipId,
      organizationId: c.org,
      topic: "schedule",
      title: "A shift needs you",
      body: "Tomorrow.",
      href: "/app/scheduling",
    });
    expect(await bellFor(c, "A shift needs you")).toEqual(ids(c.manager));
    expect(pushedTo("A shift needs you")).toEqual([]);
  });

  it("damaged choices silence nobody", async () => {
    const c = await company();
    await api.sql(`update public.memberships set notification_prefs = '{"muted_topics":"money"}'::jsonb where id = $1`, [c.owner.membershipId]);
    await api.sql(`update public.memberships set notification_prefs = '[1,2]'::jsonb where id = $1`, [c.admin.membershipId]);
    await sender.notify({ audience: "org-admins", organizationId: c.org, topic: "money", title: "Payroll ready", body: "Review it.", href: "/app/payroll" });
    expect(pushedTo("Payroll ready")).toEqual(ids(c.owner, c.admin));
  });
});

describe.skipIf(!hasPostgrest)("a real office notice carries its topic", { timeout: 120_000 }, () => {
  it("a cleaner's time-off request: the manager who turned Time off down gets the bell and no phone alert", async () => {
    const c = await company();
    await save(c.manager, ALL.filter((t) => t !== "time_off"));
    const { notifyManagersOfUnavailability } = await import("@/lib/unavailability-notice");
    await notifyManagersOfUnavailability({
      organizationId: c.org,
      membershipId: c.anna.membershipId,
      kind: "time_off_request",
      startDate: "2027-03-01",
      endDate: "2027-03-02",
    });
    expect(await bellFor(c, "Time-off request"), api.log()).toEqual(ids(c.owner, c.admin, c.manager));
    expect(pushedTo("Time-off request")).toEqual(ids(c.owner, c.admin));
  });
});

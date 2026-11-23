/**
 * The client's private link to one visit (2026-11-22): the button in a
 * booking email opens that visit with no sign-in, and from it the client can
 * leave a note, ask to move the visit, or cancel it.
 *
 * Pressed as a stranger holding the link would press it, on a real database.
 * What matters: the link opens its own visit and nothing else, a link that
 * shouldn't work doesn't, and each action tells the right people and changes
 * only what it says.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

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
  sendEmail: async () => true,
  sendOrgEmail: async () => true,
  sendOrgEmailDetailed: async () => ({ ok: true }),
}));
vi.mock("@/lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/push")>()),
  sendPushToMembership: async () => 1,
}));
// One address presses everything here; the per-connection limit is not
// what is being tested.
vi.mock("@/lib/rate-limit-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit-helpers")>()),
  checkIpRateLimit: async () => ({ allowed: true }),
}));

let api: Api;
let restoreEnv: () => void;
let links: typeof import("@/lib/visit-link");
let acts: typeof import("@/app/v/[token]/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  links = await import("@/lib/visit-link");
  acts = await import("@/app/v/[token]/actions");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
/** Signed out, like anyone opening a link from an email. */
async function stranger<T>(press: () => Promise<T>): Promise<T> {
  request.cookies = [];
  try {
    return await press();
  } finally {
    await settle();
  }
}

type Co = { org: string; owner: Member; manager: Member; anna: Member; client: string; clientName: string };
async function company(): Promise<Co> {
  const org = await addOrg(api.sql, "Link Co");
  await api.sql("update public.organizations set timezone = 'America/Regina', automations_enabled = true where id = $1", [org]);
  const client = await addClient(api.sql, org, "Margaret MacLeod");
  const [{ name }] = await api.sql<{ name: string }>("select name from public.clients where id = $1", [client]);
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    manager: await addMember(api.sql, org, "manager", "Office"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    client,
    clientName: name,
  };
}
async function visit(c: Co, daysOut: number, opts: { crew?: boolean; status?: string; client?: string } = {}): Promise<string> {
  const [b] = await api.sql<{ id: string }>(
    `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, assigned_to, address)
     values ($1, $2, now() + make_interval(secs => $3), 120, 'standard', $4::public.booking_status, $5, '12 Elm St') returning id`,
    [c.org, opts.client ?? c.client, Math.round(daysOut * 86_400), opts.status ?? "confirmed", opts.crew === false ? null : c.anna.membershipId],
  );
  if (opts.crew !== false) {
    await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, true)", [c.org, b.id, c.anna.membershipId]);
  }
  return b.id;
}
const tokenOf = (url: string) => /\/v\/([A-Za-z0-9_-]+)$/.exec(url)![1];
const requests = (bookingId: string) =>
  api.sql<{ kind: string; body: string | null; status: string; auto: boolean }>(
    "select kind, body, status, auto_applied as auto from public.client_job_requests where booking_id = $1 order by created_at",
    [bookingId],
  );
const statusOf = async (bookingId: string) =>
  (await api.sql<{ s: string }>("select status::text as s from public.bookings where id = $1", [bookingId]))[0].s;
const toldTo = async (c: Co, title: string) =>
  (await api.sql<{ r: string }>("select recipient_membership_id as r from public.notifications where organization_id = $1 and title = $2", [c.org, title]))
    .map((n) => n.r)
    .sort();

describe.skipIf(!hasPostgrest)("making the link", { timeout: 120_000 }, () => {
  it("a visit gets one link, the same every time it is asked for; another visit gets another", async () => {
    const c = await company();
    const a = await visit(c, 5);
    const b = await visit(c, 6);
    const first = await links.visitLinkFor(a);
    expect(first, api.log()).toMatch(/\/v\/[A-Za-z0-9_-]{20,}$/);
    expect(await links.visitLinkFor(a)).toBe(first);
    const other = await links.visitLinkFor(b);
    expect(other).not.toBe(first);
    // Two messages sent at once end up with one link, not two.
    const fresh = await visit(c, 7);
    const [x, y] = await Promise.all([links.visitLinkFor(fresh), links.visitLinkFor(fresh)]);
    expect(x).toBe(y);
    // A visit that isn't there has no link, and says so with null.
    expect(await links.visitLinkFor("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("the booking emails carry it as a button, and fall back to the old line without it", async () => {
    const { bookingConfirmationEmail, bookingReminderEmail, bookingRescheduledEmail } = await import("@/lib/email-templates");
    const base = { clientName: "Margaret", orgName: "Link Co", serviceName: "Standard clean", dateTime: "Fri, Mar 5, 10:00 AM", address: "12 Elm St" };
    const url = "https://sollos3.com/v/abcdefghijklmnopqrstuvwx";
    for (const mail of [
      bookingConfirmationEmail({ ...base, manageUrl: url }),
      bookingReminderEmail({ ...base, manageUrl: url }),
      bookingRescheduledEmail({ ...base, oldDateTime: "Thu, Mar 4, 10:00 AM", newDateTime: base.dateTime, manageUrl: url }),
    ]) {
      expect(mail.html).toContain(`href="${url}"`);
      expect(mail.html).toContain("See or change this visit");
      expect(mail.text).toContain(url);
      expect(mail.html).not.toMatch(/Reply to this email/);
    }
    const plain = bookingConfirmationEmail(base);
    expect(plain.html).toContain("Need to reschedule? Reply to this email.");
    expect(plain.html).not.toContain("/v/");
    expect(bookingReminderEmail(base).text).toContain("Reply to reschedule.");
  });
});

describe.skipIf(!hasPostgrest)("what a link opens", { timeout: 120_000 }, () => {
  it("its own visit and client; never with a wrong, archived or long-past link", async () => {
    const c = await company();
    const id = await visit(c, 5);
    const token = tokenOf((await links.visitLinkFor(id))!);

    const found = await links.visitByToken(token);
    expect(found).toMatchObject({ id, client_id: c.client, organization_id: c.org, client: { id: c.client } });

    for (const bad of ["", "short", "a".repeat(100), `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`, "../../etc/passwd-0123456789"]) {
      expect(await links.visitByToken(bad), bad.slice(0, 20)).toBeNull();
    }

    // A week after the visit, the link is dead.
    const old = await visit(c, -8, { status: "completed" });
    const oldToken = tokenOf((await links.visitLinkFor(old))!);
    expect(await links.visitByToken(oldToken)).toBeNull();
    const recent = await visit(c, -2, { status: "completed" });
    expect(await links.visitByToken(tokenOf((await links.visitLinkFor(recent))!))).not.toBeNull();

    // An archived client's links stop working, like their sign-in.
    await api.sql("update public.clients set archived_at = now() where id = $1", [c.client]);
    expect(await links.visitByToken(token)).toBeNull();
    expect(await stranger(() => acts.visitNoteAction({}, form({ token, body: "Hello" })))).toEqual({
      error: "This link has stopped working. Call us and we'll help.",
    });
    expect(await requests(id)).toEqual([]);
  });
});

describe.skipIf(!hasPostgrest)("from the link, with no sign-in", { timeout: 120_000 }, () => {
  it("a note reaches the cleaner and the office, and is not a question anyone has to answer", async () => {
    const c = await company();
    const id = await visit(c, 5);
    const token = tokenOf((await links.visitLinkFor(id))!);

    expect(await stranger(() => acts.visitNoteAction({}, form({ token, body: "  The side gate code is 4412.  " }))), api.log()).toEqual({ ok: true });
    expect(await requests(id)).toEqual([{ kind: "job_note", body: "The side gate code is 4412.", status: "resolved", auto: true }]);
    expect(await toldTo(c, `Note from ${c.clientName}`)).toEqual([c.anna.membershipId]);
    expect(await toldTo(c, `New note from ${c.clientName}`)).toEqual([c.owner.membershipId, c.manager.membershipId].sort());

    expect(await stranger(() => acts.visitNoteAction({}, form({ token, body: "   " })))).toEqual({ error: "Write a note first." });
    expect((await stranger(() => acts.visitNoteAction({}, form({ token, body: "My card is 4242 4242 4242 4242" })))).error).toBeTruthy();
    expect(await requests(id)).toHaveLength(1);
  });

  it("asking to move it lands in the office's inbox as an open question; the visit and the crew are untouched", async () => {
    const c = await company();
    const id = await visit(c, 5);
    const token = tokenOf((await links.visitLinkFor(id))!);

    expect(await stranger(() => acts.visitMoveAction({}, form({ token, wish: "Any morning next week" }))), api.log()).toEqual({ ok: true });
    const [asked] = await requests(id);
    expect(asked).toMatchObject({ kind: "job_note", status: "open", auto: false });
    expect(asked.body).toMatch(/^Asked to move their visit on .+\. They said: "Any morning next week"$/);
    expect(await statusOf(id)).toBe("confirmed");
    expect(await toldTo(c, `${c.clientName} asked to move a visit`)).toEqual([c.owner.membershipId, c.manager.membershipId].sort());
    // The cleaner is not told: the visit is still going ahead as booked.
    const [{ n }] = await api.sql<{ n: number }>(
      "select count(*)::int as n from public.notifications where organization_id = $1 and recipient_membership_id = $2",
      [c.org, c.anna.membershipId],
    );
    expect(n).toBe(0);
    // It is what the office's requests page lists: an open note.
    const inbox = await api.sql<{ id: string }>(
      "select id from public.client_job_requests where organization_id = $1 and kind = 'job_note' and status = 'open'",
      [c.org],
    );
    expect(inbox).toHaveLength(1);

    expect(await stranger(() => acts.visitMoveAction({}, form({ token, wish: "" })))).toEqual({ error: "Tell us when would suit you better." });
  });

  it("cancelling well ahead cancels that one visit; close in, it asks the office and the visit stays", async () => {
    const c = await company();
    const far = await visit(c, 5);
    const other = await visit(c, 12);
    const farToken = tokenOf((await links.visitLinkFor(far))!);
    expect(await stranger(() => acts.visitCancelAction({}, form({ token: farToken, reason: "Away that week" }))), api.log()).toEqual({ ok: true });
    expect(await statusOf(far)).toBe("cancelled");
    expect(await statusOf(other), "only the one visit").toBe("confirmed");
    expect(await requests(far)).toEqual([{ kind: "skip_occurrence", body: "Away that week", status: "resolved", auto: true }]);
    expect(await toldTo(c, `${c.clientName} skipped a visit`)).toEqual([c.owner.membershipId, c.manager.membershipId].sort());

    const soon = await visit(c, 1);
    const soonToken = tokenOf((await links.visitLinkFor(soon))!);
    expect(await stranger(() => acts.visitCancelAction({}, form({ token: soonToken, reason: "" })))).toEqual({ ok: true });
    expect(await statusOf(soon), "still booked until the office answers").toBe("confirmed");
    expect(await requests(soon)).toEqual([{ kind: "skip_occurrence", body: null, status: "open", auto: false }]);

    // Already cancelled: nothing more to do, said in words.
    expect(await stranger(() => acts.visitCancelAction({}, form({ token: farToken, reason: "" })))).toEqual({ error: "This visit was cancelled." });
    expect(await stranger(() => acts.visitMoveAction({}, form({ token: farToken, wish: "Friday" })))).toEqual({ error: "This visit was cancelled." });
  });

  it("a made-up link does nothing, for any of the three", async () => {
    const c = await company();
    const id = await visit(c, 5);
    const dead = { error: "This link has stopped working. Call us and we'll help." };
    const token = "this-is-not-a-real-token-000";
    expect(await stranger(() => acts.visitNoteAction({}, form({ token, body: "x" })))).toEqual(dead);
    expect(await stranger(() => acts.visitMoveAction({}, form({ token, wish: "x" })))).toEqual(dead);
    expect(await stranger(() => acts.visitCancelAction({}, form({ token, reason: "x" })))).toEqual(dead);
    expect(await statusOf(id)).toBe("confirmed");
    expect(await requests(id)).toEqual([]);
  });
});

describe.skipIf(!hasPostgrest)("the same, signed in to the client area", { timeout: 120_000 }, () => {
  it("a signed-in client asks to move their own visit, and can't ask about someone else's", async () => {
    const portal = await import("@/app/client/(portal)/jobs/[id]/actions");
    const c = await company();
    const [user] = await api.sql<{ id: string }>("insert into auth.users (email, raw_user_meta_data) values ($1, '{}'::jsonb) returning id", [
      `margaret.${Date.now()}@example.test`,
    ]);
    await api.sql("update public.clients set profile_id = $2 where id = $1", [c.client, user.id]);
    const mine = await visit(c, 5);
    const stranger2 = await addClient(api.sql, c.org, "Ken Hicks");
    const theirs = await visit(c, 5, { client: stranger2, crew: false });

    request.cookies = api.sessionCookies(user.id);
    try {
      expect(await portal.askToMoveAction({}, form({ booking_id: mine, wish: "Friday afternoon" })), api.log()).toEqual({ ok: true });
      expect(await portal.askToMoveAction({}, form({ booking_id: theirs, wish: "Friday afternoon" }))).toEqual({ error: "Job not found." });
    } finally {
      await settle();
    }
    expect(await requests(mine)).toHaveLength(1);
    expect(await requests(theirs)).toEqual([]);
  });
});

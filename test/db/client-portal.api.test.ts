/**
 * The client portal, pressed as the people who press it, against a real
 * database behind the real PostgREST (and the stack's stand-ins for the
 * sign-in service's user list and create). Outbound email is caught.
 *
 *   the office invites a client      a link, emailed, good for 14 days
 *   (getting in from that link, or by email, is client-sign-in.api.test.ts)
 *   the client leaves a note         on their own visit; the crew is told
 *   the client asks for a booking    the office is told, and answers it
 *
 * A client writes only through these actions, never as themselves, so the
 * checks that matter are the ones the actions make: their own visit and
 * nobody else's, no card numbers stored, one login per link, and an
 * archived client locked out.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  sendEmail: async (a: Sent) => {
    outbox.email.push(a);
    return true;
  },
  sendOrgEmail: async (_o: string, a: Sent) => {
    outbox.email.push(a);
    return true;
  },
}));

let api: Api;
let restoreEnv: () => void;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
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

/** Signed in as this auth user (a client or a member); a redirect is an answer too. */
async function asUser<T>(userId: string | null, press: () => Promise<T>): Promise<T | { redirected: string }> {
  request.cookies = userId ? api.sessionCookies(userId) : [];
  try {
    return await press();
  } catch (err) {
    const m = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
    if (m) return { redirected: m[1] };
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

type Company = { org: string; owner: Member; manager: Member; anna: Member };
async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Portal Co");
  await api.sql("update public.organizations set timezone = 'America/Regina', automations_enabled = true where id = $1", [org]);
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    manager: await addMember(api.sql, org, "manager", "Office"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
}

/** A client with a portal login already linked. */
async function portalClient(org: string, name: string): Promise<{ client: string; userId: string }> {
  const client = await addClient(api.sql, org, name);
  const email = `${name.toLowerCase().replace(/\W+/g, ".")}.${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`;
  const [user] = await api.sql<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, '{}'::jsonb) returning id",
    [email],
  );
  await api.sql("update public.clients set profile_id = $2, email = $3 where id = $1", [client, user.id, email]);
  return { client, userId: user.id };
}

async function visit(org: string, client: string, daysOut: number, opts: { crew?: Member; status?: string } = {}): Promise<string> {
  const [b] = await api.sql<{ id: string }>(
    `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, assigned_to)
     values ($1, $2, now() + make_interval(days => $3), 120, 'standard', $4::public.booking_status, $5) returning id`,
    [org, client, daysOut, opts.status ?? "confirmed", opts.crew?.membershipId ?? null],
  );
  if (opts.crew) {
    await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id) values ($1, $2, $3)", [org, b.id, opts.crew.membershipId]);
  }
  return b.id;
}

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("portal invite", { timeout: 120_000 }, () => {
  it("the office invites: a link by email, good for 14 days, with no password to set up; only its hash is kept", async () => {
    const { invitePortalAction } = await import("@/app/app/clients/portal-actions");
    const c = await company();
    const client = await addClient(api.sql, c.org, "Patricia Poohkay");
    const email = `patricia.${Date.now()}@example.test`;
    await api.sql("update public.clients set email = $2 where id = $1", [client, email]);
    const noEmail = await addClient(api.sql, c.org, "No Email");

    expect(await asUser(c.manager.userId, () => invitePortalAction(form({ client_id: client })))).toEqual({
      ok: false,
      error: "Only owners and admins can invite clients.",
    });
    expect(await asUser(c.owner.userId, () => invitePortalAction(form({ client_id: noEmail })))).toEqual({
      ok: false,
      error: "This client has no email on file. Add one first and try again.",
    });

    const invited = (await asUser(c.owner.userId, () => invitePortalAction(form({ client_id: client })))) as { ok: boolean; claimUrl?: string };
    expect(invited.ok, api.log().slice(-300)).toBe(true);
    const mail = outbox.email.find((e) => e.to === email);
    expect(mail).toBeDefined();
    const token = /\/client\/claim\/([A-Za-z0-9_-]+)/.exec(mail!.text ?? "")![1];
    // The office is handed the same link the email carries, to copy.
    expect(invited.claimUrl?.endsWith(`/client/claim/${token}`)).toBe(true);
    const [stored] = await api.sql<{ token: string; days: number }>(
      "select portal_invite_token as token, round(extract(epoch from portal_invite_expires_at - now()) / 86400)::int as days from public.clients where id = $1",
      [client],
    );
    expect(stored.token).not.toBe(token); // only its hash is kept
    expect(stored.days).toBe(14);

    expect(mail!.subject).toMatch(/^See your cleans with Portal Co \d+$/);
    expect(mail!.text).toContain("no password to set up");
    expect(mail!.text).not.toMatch(/set up your account|pick a password/i);
  });
});

describe.skipIf(!hasPostgrest)("a note on a visit, from the client", { timeout: 120_000 }, () => {
  it("lands on their own upcoming visit and the crew and office are told; never on someone else's, a finished one, or with a card number", async () => {
    const { leaveJobNoteAction } = await import("@/app/client/(portal)/jobs/[id]/actions");
    const c = await company();
    const me = await portalClient(c.org, "Margaret Ann MacLeod");
    const someoneElse = await addClient(api.sql, c.org, "Ken Hicks");
    const mine = await visit(c.org, me.client, 3, { crew: c.anna });
    const theirs = await visit(c.org, someoneElse, 3);
    const finished = await visit(c.org, me.client, -3, { status: "completed" });

    const res = await asUser(me.userId, () => leaveJobNoteAction({}, form({ booking_id: mine, body: "The side gate code is 4412." })));
    expect((res as { error?: string }).error, JSON.stringify(res)).toBeUndefined();
    const [note] = await api.sql<{ kind: string; body: string; status: string }>(
      "select kind, body, status from public.client_job_requests where booking_id = $1",
      [mine],
    );
    expect(note).toEqual({ kind: "job_note", body: "The side gate code is 4412.", status: "resolved" });
    const told = await api.sql<{ r: string }>(
      "select recipient_membership_id as r from public.notifications where organization_id = $1 and title ilike '%note from%'",
      [c.org],
    );
    expect(told.map((t) => t.r)).toContain(c.anna.membershipId);
    expect(told.map((t) => t.r)).toContain(c.owner.membershipId);

    expect(await asUser(me.userId, () => leaveJobNoteAction({}, form({ booking_id: theirs, body: "hi" })))).toEqual({ error: "Job not found." });
    expect(await asUser(me.userId, () => leaveJobNoteAction({}, form({ booking_id: finished, body: "Thanks!" })))).toEqual({ error: "This visit is finished." });
    const card = (await asUser(me.userId, () => leaveJobNoteAction({}, form({ booking_id: mine, body: "Charge 4111 1111 1111 1111 please" })))) as { error?: string };
    expect(card.error).toBeTruthy();
    expect(await api.sql("select 1 from public.client_job_requests where organization_id = $1", [c.org])).toHaveLength(1);

    // Archived: the portal is locked.
    await api.sql("update public.clients set archived_at = now() where id = $1", [me.client]);
    expect(await asUser(me.userId, () => leaveJobNoteAction({}, form({ booking_id: mine, body: "Still here?" })))).toEqual({ redirected: "/client/login" });
  });
});

describe.skipIf(!hasPostgrest)("a booking request, from the client", { timeout: 120_000 }, () => {
  it("is saved and the office told; the office schedules or declines it, and a decline tells the client", async () => {
    const { submitBookingRequestAction } = await import("@/app/client/(portal)/request/actions");
    const { updateRequestStatusAction } = await import("@/app/app/bookings/requests/actions");
    const c = await company();
    const me = await portalClient(c.org, "Hilda Daubner");

    const ok = await asUser(me.userId, () =>
      submitBookingRequestAction({}, form({ service_type: "Deep clean before guests arrive", preferred_date: "2026-12-18", preferred_time_window: "morning", notes: "Two bathrooms" })),
    );
    expect((ok as { error?: string }).error, JSON.stringify(ok)).toBeUndefined();
    const [req] = await api.sql<{ id: string; status: string; window: string }>(
      "select id, status, preferred_time_window as window from public.booking_requests where client_id = $1",
      [me.client],
    );
    expect(req).toMatchObject({ status: "pending", window: "morning" });
    expect(await api.sql("select 1 from public.notifications where organization_id = $1 and title = 'New booking request'", [c.org])).not.toHaveLength(0);

    expect(await asUser(me.userId, () => submitBookingRequestAction({}, form({ service_type: "" })))).toEqual({ error: "Please describe what you need cleaned." });
    expect(((await asUser(me.userId, () => submitBookingRequestAction({}, form({ service_type: "Clean", notes: "card 4111 1111 1111 1111" })))) as { error?: string }).error).toContain("(in notes)");
    expect(await asUser(me.userId, () => submitBookingRequestAction({}, form({ service_type: "Clean", preferred_time_window: "midnight" })))).toEqual({
      error: "Pick a preferred time window or leave it flexible.",
    });
    expect(await api.sql("select 1 from public.booking_requests where client_id = $1", [me.client])).toHaveLength(1);

    outbox.email.length = 0;
    await asUser(c.anna.userId, () => updateRequestStatusAction(form({ id: req.id, status: "declined" })));
    expect((await api.sql<{ s: string }>("select status as s from public.booking_requests where id = $1", [req.id]))[0].s).toBe("pending");
    await asUser(c.manager.userId, () => updateRequestStatusAction(form({ id: req.id, status: "declined" })));
    const [after] = await api.sql<{ s: string; by: string | null }>("select status as s, responded_by as by from public.booking_requests where id = $1", [req.id]);
    expect(after).toEqual({ s: "declined", by: c.manager.membershipId });
    const clientEmail = (await api.sql<{ e: string }>("select email as e from public.clients where id = $1", [me.client]))[0].e;
    expect(outbox.email.map((e) => e.to)).toContain(clientEmail);
  });
});

/**
 * The team-facing buttons and the jobs that run at night, against a real
 * database behind the real PostgREST. Push, text and email are caught.
 *
 *   the feed          a manager posts (with a photo); pins
 *   chat photos       the upload slot and the links to see them
 *   announce          one message: #general, the bell, every inbox
 *   the bell          marking read, one notice or all of them
 *   series drift      "Restore" and "Keep" on the dashboard
 *   day glance        what else is on the day being booked
 *   series stop       a cleaner asking off a recurring client
 *   complete-bookings the nightly close of finished visits
 *   morning-check     the 8 AM report, which must change nothing
 *
 * The stack's stand-in storage keeps files, removals and single signed
 * links. Chat photos also need a signed UPLOAD slot, a batch of signed
 * links and a folder listing; those three answers are stood in below, in
 * this file, on the same file map (api.storage).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addCrew, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

type Mail = { to: string; subject: string; text?: string; html?: string };
const outbox = vi.hoisted(() => ({
  email: [] as Array<{ to: string; subject: string; text?: string; html?: string }>,
  push: [] as Array<{ to: string; title: string; body?: string }>,
  orgPush: [] as Array<{ org: string; title: string }>,
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
  sendOrgSms: async () => ({ ok: true, sid: null, status: "skipped_disabled", segments: 0 }),
}));

const feed = await import("@/lib/feed-actions");
const chat = await import("@/lib/chat-actions");
const { sendAnnouncementAction } = await import("@/lib/announce-actions");
const bell = await import("@/app/app/notifications/actions");
const needsYou = await import("@/app/app/needs-you-actions");
const { getDayGlanceAction } = await import("@/app/app/bookings/day-glance");
const { requestSeriesStopAction } = await import("@/app/field/jobs/actions");
const { CARD_DETECTED_MESSAGE } = await import("@/lib/card-detection");
const { GET: completeBookingsCron } = await import("@/app/api/cron/complete-bookings/route");
const { GET: morningCheckCron } = await import("@/app/api/cron/morning-check/route");

let api: Api;
let restoreEnv: () => void;
const realFetch = globalThis.fetch;
const CRON_SECRET = "ops-team-jobs-test-cron-secret";
let uploadSlots = 0;

/** The three storage answers chat photos need that the stack doesn't give. */
const storageStandIns: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (api && method === "POST" && url.startsWith(`${api.url}/storage/v1/object/`)) {
    const rest = decodeURIComponent(new URL(url).pathname.slice("/storage/v1/object/".length));
    const body = () => JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
    if (rest.startsWith("upload/sign/chat-media/")) {
      return Response.json({ url: `/object/upload/sign/${rest.slice("upload/sign/".length)}?token=slot-${++uploadSlots}` });
    }
    if (rest === "sign/chat-media") {
      const paths = (body().paths as string[]) ?? [];
      return Response.json(
        paths.map((p) =>
          api.storage.has(`chat-media/${p}`)
            ? { path: p, signedURL: `/object/sign/chat-media/${p}?token=seen`, error: null }
            : { path: p, signedURL: null, error: "Object not found" },
        ),
      );
    }
    if (rest === "list/chat-media") {
      const { prefix = "", search = "" } = body() as { prefix?: string; search?: string };
      const inFolder = [...api.storage.entries()]
        .filter(([k]) => k.startsWith(`chat-media/${prefix}/`))
        .map(([k, size]) => ({ name: k.slice(`chat-media/${prefix}/`.length), id: k, metadata: { size } }))
        .filter((o) => !o.name.includes("/") && o.name.includes(String(search)));
      return Response.json(inFolder);
    }
  }
  return realFetch(input, init);
};

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  process.env.CRON_SECRET = CRON_SECRET;
  globalThis.fetch = storageStandIns;
}, 240_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  outbox.email.length = 0;
  outbox.push.length = 0;
  outbox.orgPush.length = 0;
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
const nameOf = async (m: Member) =>
  (await api.sql<{ full_name: string }>("select full_name from public.profiles where id = $1", [m.userId]))[0].full_name;

async function as<T>(m: Member, press: () => Promise<T>): Promise<T> {
  request.cookies = api.sessionCookies(m.userId, await emailOf(m));
  try {
    return await press();
  } finally {
    await settle();
  }
}

const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

async function company(label = "Team Co", settings: Record<string, unknown> = {}, autoCompleteHours: number | null = null) {
  const org = await addOrg(api.sql, label);
  await api.sql(
    `update public.organizations
        set timezone = 'America/Regina', automations_enabled = true, automation_settings = $2::jsonb,
            booking_auto_complete_hours = $3
      where id = $1`,
    [org, JSON.stringify(settings), autoCompleteHours],
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

const DAY = 86_400_000;
/** A calendar day in Regina, `days` from today. */
const reginaYmd = (days: number) => new Date(Date.now() + days * DAY).toLocaleDateString("en-CA", { timeZone: "America/Regina" });
/** That day at a Regina wall-clock time (Regina is UTC-6 all year). */
const at = (days: number, hhmm: string) => new Date(`${reginaYmd(days)}T${hhmm}:00-06:00`).toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function cron(get: (r: NextRequest) => Promise<Response>, path: string, secret = CRON_SECRET) {
  const res = await get(new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${secret}` } }));
  await settle();
  return res;
}

async function thread(org: string, name: string, members: Member[]) {
  const [t] = await api.sql<{ id: string }>("insert into public.chat_threads (organization_id, kind, name) values ($1, 'group', $2) returning id", [org, name]);
  for (const m of members) {
    await api.sql("insert into public.chat_thread_members (organization_id, thread_id, membership_id) values ($1, $2, $3)", [org, t.id, m.membershipId]);
  }
  return t.id;
}

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("the team feed", () => {
  const png = () =>
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1])], "team.png", { type: "image/png" });
  const feedFiles = (org: string) => [...api.storage.keys()].filter((k) => k.startsWith(`org-assets/${org}/feed/`));
  async function post(c: Co, by: Member, body: string) {
    const [p] = await api.sql<{ id: string }>("insert into public.feed_posts (organization_id, author_id, body) values ($1, $2, $3) returning id", [
      c.org,
      by.membershipId,
      body,
    ]);
    return p.id;
  }
  const pinned = async (id: string) => (await api.sql<{ pinned: boolean }>("select pinned from public.feed_posts where id = $1", [id]))[0].pinned;

  it("a manager posts with a photo; a cleaner can't post; a card number or a picture that isn't one is refused", async () => {
    const c = await company();
    expect(await as(c.olha, () => feed.createFeedPostAction(form({ body: "Great work on the Hill house!", image: png() }))), api.log()).toEqual({ ok: true });
    // Every new member gets a "just joined the team" post from the database; leave those out.
    const posts = () =>
      api.sql<{ author_id: string; body: string; image_url: string }>(
        "select author_id, body, image_url from public.feed_posts where organization_id = $1 and body not like '%just joined the team%'",
        [c.org],
      );
    const rows = await posts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ author_id: c.olha.membershipId, body: "Great work on the Hill house!" });
    expect(rows[0].image_url).toContain(`/org-assets/${c.org}/feed/`);
    expect(feedFiles(c.org)).toHaveLength(1);

    expect(await as(c.anna, () => feed.createFeedPostAction(form({ body: "Anna's post" })))).toEqual({ ok: false, error: "Only managers can post to the feed." });
    expect(await as(c.owner, () => feed.createFeedPostAction(form({ body: "Pay with 4242 4242 4242 4242" })))).toEqual({ ok: false, error: CARD_DETECTED_MESSAGE });
    const fake = new File([new TextEncoder().encode("MZ not a picture at all, sorry")], "x.png", { type: "image/png" });
    expect(await as(c.owner, () => feed.createFeedPostAction(form({ body: "Look", image: fake })))).toEqual({
      ok: false,
      error: "That file isn't the image it claims to be.",
    });
    expect(await posts()).toHaveLength(1);
    expect(feedFiles(c.org), "nothing stored for the refused picture").toHaveLength(1);
  });

  it("the owner pins and unpins any post, the author her own; a cleaner or another company changes nothing", async () => {
    const c = await company();
    const other = await company("Other Co");
    const byOlha = await post(c, c.olha, "Supplies are in the van");
    const byOwner = await post(c, c.owner, "Holiday hours");

    expect(await as(c.owner, () => feed.togglePinPostAction(form({ post_id: byOlha, pinned: "true" })))).toEqual({ ok: true });
    expect(await pinned(byOlha)).toBe(true);
    expect(await as(c.olha, () => feed.togglePinPostAction(form({ post_id: byOlha, pinned: "false" })))).toEqual({ ok: true });
    expect(await pinned(byOlha)).toBe(false);

    await as(c.anna, () => feed.togglePinPostAction(form({ post_id: byOwner, pinned: "true" })));
    await as(other.owner, () => feed.togglePinPostAction(form({ post_id: byOwner, pinned: "true" })));
    expect(await pinned(byOwner), "a cleaner, or another company, can't pin it").toBe(false);
  });

  // FIX-LATER: managers see "Pin to top" on every post, but feed_posts' update policy only admits the author or an owner/admin; togglePinPostAction answers ok without asking what changed
  it.fails("a manager pinning someone else's post either pins it or is told she can't", async () => {
    const c = await company();
    const byOwner = await post(c, c.owner, "Holiday hours");
    const res = await as(c.olha, () => feed.togglePinPostAction(form({ post_id: byOwner, pinned: "true" })));
    expect(await pinned(byOwner), `she was told ${JSON.stringify(res)}`).toBe(res.ok);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("chat photos", () => {
  async function setup() {
    const c = await company();
    const other = await company("Other Co");
    const cleo = await addMember(api.sql, c.org, "employee", "Cleo");
    const crew = await thread(c.org, "Crew", [c.anna, c.bea]);
    const office = await thread(c.org, "Office", [c.owner, c.bea]);
    const theirs = await thread(other.org, "Theirs", [other.anna]);
    return { c, other, cleo, crew, office, theirs };
  }

  it("a cleaner in the conversation gets an upload slot; outside it, or for a file that isn't a photo, she doesn't", async () => {
    const s = await setup();
    const slot = await as(s.c.anna, () => chat.prepareChatPhotoUploadAction({ threadId: s.crew, fileName: "kitchen.jpg", mimeType: "image/jpeg", size: 2048 }));
    expect(slot, api.log().slice(-400)).toMatchObject({ ok: true, mimeType: "image/jpeg", token: expect.stringMatching(/^slot-/) });
    expect((slot as { path: string }).path).toMatch(new RegExp(`^${s.c.org}/${s.crew}/[0-9a-f-]{36}\\.jpg$`));

    // A phone that sends no type: the extension decides.
    expect(await as(s.c.anna, () => chat.prepareChatPhotoUploadAction({ threadId: s.crew, fileName: "IMG_0042.HEIC", mimeType: "", size: 4096 }))).toMatchObject({
      ok: true,
      mimeType: "image/heic",
    });
    const notIn = { ok: false, error: "You're not in this conversation." };
    expect(await as(s.c.anna, () => chat.prepareChatPhotoUploadAction({ threadId: s.office, fileName: "a.jpg", mimeType: "image/jpeg", size: 10 }))).toEqual(notIn);
    expect(await as(s.c.anna, () => chat.prepareChatPhotoUploadAction({ threadId: s.theirs, fileName: "a.jpg", mimeType: "image/jpeg", size: 10 }))).toEqual(notIn);
    expect(await as(s.c.anna, () => chat.prepareChatPhotoUploadAction({ threadId: s.crew, fileName: "invoice.pdf", mimeType: "application/pdf", size: 10 }))).toEqual({
      ok: false,
      error: "Only photos (JPG, PNG, HEIC, WebP) can be sent here.",
    });
    expect(await as(s.c.anna, () => chat.prepareChatPhotoUploadAction({ threadId: s.crew, fileName: "a.jpg", mimeType: "image/jpeg", size: 0 }))).toEqual({
      ok: false,
      error: "That file is empty.",
    });
    expect(await as(s.c.anna, () => chat.prepareChatPhotoUploadAction({ threadId: s.crew, fileName: "a.jpg", mimeType: "image/jpeg", size: 21 * 1024 * 1024 }))).toEqual({
      ok: false,
      error: "Photos must be under 20 MB.",
    });
  });

  it("a cleaner's photo goes through: slot, upload, message, and a link for the teammate in the conversation only", async () => {
    const s = await setup();
    const slot = (await as(s.c.anna, () =>
      chat.prepareChatPhotoUploadAction({ threadId: s.crew, fileName: "bath.jpg", mimeType: "image/jpeg", size: 2048 }),
    )) as { ok: true; path: string };
    api.storage.set(`chat-media/${slot.path}`, 2048); // the phone uploads to the slot

    const sent = await as(s.c.anna, () => chat.sendChatMessageAction(s.crew, "Bathroom done", [{ path: slot.path, mime: "image/jpeg", size: 2048 }]));
    expect(sent, JSON.stringify(sent)).toMatchObject({ ok: true });
    expect(
      await api.sql("select sender_id, body, attachments from public.chat_messages where thread_id = $1", [s.crew]),
    ).toEqual([{ sender_id: s.c.anna.membershipId, body: "Bathroom done", attachments: [{ path: slot.path, mime: "image/jpeg", size: 2048 }] }]);

    const seen = await as(s.c.bea, () => chat.signChatPhotosAction(s.crew, [slot.path]));
    expect(seen).toMatchObject({ ok: true });
    expect(Object.keys((seen as { urls: Record<string, string> }).urls)).toEqual([slot.path]);

    // Paths from somewhere else are dropped before anything is signed.
    const elsewhere = [`${s.c.org}/${s.office}/${crypto.randomUUID()}.jpg`, `${s.other.org}/${s.theirs}/${crypto.randomUUID()}.jpg`, `${s.c.org}/${s.crew}/../${s.office}/x.jpg`];
    for (const p of elsewhere) api.storage.set(`chat-media/${p}`, 10);
    expect(await as(s.c.bea, () => chat.signChatPhotosAction(s.crew, elsewhere))).toEqual({ ok: true, urls: {} });
    expect(await as(s.cleo, () => chat.signChatPhotosAction(s.crew, [slot.path]))).toEqual({ ok: false, error: "You're not in this conversation." });
    expect(await as(s.other.anna, () => chat.signChatPhotosAction(s.crew, [slot.path]))).toEqual({ ok: true, urls: {} });
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("announce to team", () => {
  /** Every company gets a #general the moment its first member is added, and every member is put in it. */
  const generalOf = async (org: string) =>
    (
      await api.sql<{ id: string }>(
        "select t.id from public.chat_threads t where t.organization_id = $1 and t.name = 'general' order by (select count(*) from public.chat_thread_members m where m.thread_id = t.id) desc limit 1",
        [org],
      )
    )[0].id;
  const messagesIn = (org: string) =>
    api.sql<{ thread_id: string; sender_id: string; body: string }>("select thread_id, sender_id, body from public.chat_messages where organization_id = $1", [org]);

  it("is for the office: a cleaner can't, and it needs a subject and words", async () => {
    const c = await company();
    expect(await as(c.anna, () => sendAnnouncementAction({}, form({ title: "Party", body: "Friday" })))).toMatchObject({
      error: "Only owners, admins and managers can announce to the team.",
    });
    expect(await as(c.owner, () => sendAnnouncementAction({}, form({ title: " ", body: "Friday" })))).toMatchObject({ error: "Give the announcement a subject." });
    expect(await as(c.owner, () => sendAnnouncementAction({}, form({ title: "Party", body: "" })))).toMatchObject({ error: "Write the announcement." });
    expect(await messagesIn(c.org)).toHaveLength(0);
    expect(await api.sql("select 1 from public.notifications where organization_id = $1", [c.org])).toHaveLength(0);
    expect(outbox.email).toHaveLength(0);
  });

  it("lands in the team's #general (not a stray duplicate), the bell and every active person's inbox, and nowhere else", async () => {
    const c = await company();
    const other = await company("Other Co");
    const dina = await addMember(api.sql, c.org, "employee", "Dina", "disabled");
    const ivy = await addMember(api.sql, c.org, "employee", "Ivy", "invited");
    const general = await generalOf(c.org);
    const stray = await thread(c.org, "general", [c.owner]);

    const res = await as(c.owner, () => sendAnnouncementAction({}, form({ title: "Holiday hours", body: "Closed Dec 25 and 26.", email: "on" })));
    expect(res, api.log().slice(-600)).toMatchObject({ sent: { chat: true, email: true, emailed: 4 } });

    expect(await messagesIn(c.org)).toEqual([{ thread_id: general, sender_id: c.owner.membershipId, body: "Holiday hours\n\nClosed Dec 25 and 26." }]);
    expect(general).not.toBe(stray);
    expect(await messagesIn(other.org)).toHaveLength(0);

    expect(
      await api.sql("select recipient_membership_id, type::text as type, min_role::text as min_role, href from public.notifications where organization_id = $1", [c.org]),
    ).toEqual([{ recipient_membership_id: null, type: "announcement", min_role: "employee", href: `/app/chat?thread=${general}` }]);
    expect(await api.sql("select 1 from public.notifications where organization_id = $1", [other.org])).toHaveLength(0);

    // The chat post buzzes the thread; the bell doesn't buzz everyone again.
    const buzzed = outbox.push.map((p) => p.to);
    expect(buzzed).toEqual(expect.arrayContaining([c.olha.membershipId, c.anna.membershipId, c.bea.membershipId]));
    for (const nobody of [c.owner, other.owner, other.anna]) expect(buzzed, "not the sender, not another company").not.toContain(nobody.membershipId);
    expect(outbox.orgPush).toEqual([]);

    const active = await Promise.all([c.owner, c.olha, c.anna, c.bea].map(emailOf));
    expect(outbox.email.map((m) => m.to).sort()).toEqual(active.sort());
    for (const nobody of [dina, ivy, other.owner, other.anna]) expect(outbox.email.map((m) => m.to)).not.toContain(await emailOf(nobody));
  });

  it("doesn't buzz the phone of a cleaner who has been deactivated", async () => {
    const c = await company();
    const dina = await addMember(api.sql, c.org, "employee", "Dina");
    await api.sql(
      "insert into public.push_subscriptions (organization_id, membership_id, endpoint, keys_p256dh, keys_auth) values ($1, $2, 'https://push.example.com/dina', 'p256dh-test', 'auth-test')",
      [c.org, dina.membershipId],
    );
    await api.sql("update public.memberships set status = 'disabled' where id = $1", [dina.membershipId]);
    await as(c.owner, () => sendAnnouncementAction({}, form({ title: "Holiday hours", body: "Closed Dec 25 and 26." })));
    expect(outbox.push.map((p) => p.to)).toContain(c.anna.membershipId);
    expect(outbox.push.map((p) => p.to)).not.toContain(dina.membershipId);
  });

  it("with no #general to post in, the bell carries it with one push to the company, and no email unless asked", async () => {
    const c = await company();
    await api.sql("delete from public.chat_threads where organization_id = $1 and name = 'general'", [c.org]);
    const res = await as(c.olha, () => sendAnnouncementAction({}, form({ title: "Van keys", body: "On the hook by the door." })));
    expect(res).toMatchObject({ sent: { chat: false, email: false, emailed: 0 } });
    expect(await api.sql("select href from public.notifications where organization_id = $1 and type = 'announcement'", [c.org])).toEqual([
      { href: "/app/notifications" },
    ]);
    expect(outbox.orgPush).toEqual([{ org: c.org, title: "Van keys" }]);
    expect(outbox.email).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("the bell", () => {
  async function notice(org: string, to: Member | null, title: string, minRole = "employee") {
    const [n] = await api.sql<{ id: string }>(
      `insert into public.notifications (organization_id, recipient_membership_id, type, title, min_role)
       values ($1, $2, 'general', $3, $4::public.membership_role) returning id`,
      [org, to?.membershipId ?? null, title, minRole],
    );
    return n.id;
  }
  const isRead = async (id: string) => (await api.sql<{ r: boolean }>("select read_at is not null as r from public.notifications where id = $1", [id]))[0].r;

  async function setup() {
    const c = await company();
    const other = await company("Other Co");
    return {
      c,
      other,
      annas: await notice(c.org, c.anna, "Your shift moved"),
      annas2: await notice(c.org, c.anna, "New job Friday"),
      beas: await notice(c.org, c.bea, "Bea's shift moved"),
      office: await notice(c.org, null, "Stale estimate", "manager"),
      money: await notice(c.org, null, "Invoice paid", "admin"),
      everyone: await notice(c.org, null, "Holiday hours", "employee"),
      theirs: await notice(other.org, other.anna, "Their shift"),
    };
  }

  it("each person marks only their own notices read; a teammate's, the office's and another company's stay unread", async () => {
    const s = await setup();
    await as(s.c.anna, () => bell.markNotificationReadAction(s.annas));
    expect(await isRead(s.annas)).toBe(true);
    for (const id of [s.beas, s.office, s.money, s.theirs]) await as(s.c.anna, () => bell.markNotificationReadAction(id));
    await as(s.c.olha, () => bell.markNotificationReadAction(s.money));
    for (const id of [s.beas, s.office, s.money, s.theirs]) expect(await isRead(id), id).toBe(false);
  });

  it("mark all read covers what she can see, and nothing of a teammate's, the office's or another company's", async () => {
    const s = await setup();
    await as(s.c.anna, () => bell.markAllNotificationsReadAction());
    expect(await isRead(s.annas)).toBe(true);
    expect(await isRead(s.annas2)).toBe(true);
    for (const id of [s.beas, s.office, s.money, s.theirs]) expect(await isRead(id), id).toBe(false);
  });

  // FIX-LATER: an org-wide notice is ONE row with one read_at (notify.ts), so "mark all read" stomps everyone's unread state for it, against the action's own comment
  it.fails("the owner marking everything read leaves the team announcement unread for the manager", async () => {
    const s = await setup();
    await as(s.c.owner, () => bell.markAllNotificationsReadAction());
    expect(await isRead(s.everyone)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("series drift: Restore and Keep", () => {
  async function series(c: { org: string }, client: string, start: string) {
    const [s] = await api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes, service_type, total_cents)
       values ($1, $2, 'weekly', $3, $4, 120, 'standard', 15000) returning id`,
      [c.org, client, start, reginaYmd(-30)],
    );
    return s.id;
  }
  async function visit(c: { org: string }, client: string, seriesId: string, iso: string, opts: { status?: string; byHand?: boolean; crew?: Member } = {}) {
    const [b] = await api.sql<{ id: string }>(
      `insert into public.bookings (organization_id, client_id, series_id, scheduled_at, duration_minutes, service_type, status, total_cents, time_set_by_hand_at, client_reminder_sent_at)
       values ($1, $2, $3, $4::timestamptz, 120, 'standard', $5::public.booking_status, 15000, ${opts.byHand ? "now() - interval '1 day'" : "null"}, now()) returning id`,
      [c.org, client, seriesId, iso, opts.status ?? "confirmed"],
    );
    if (opts.crew) await addCrew(api.sql, c.org, b.id, opts.crew.membershipId);
    return b.id;
  }
  const when = async (id: string) =>
    (
      await api.sql<{ at: string; by_hand: boolean; reminded: boolean }>(
        "select scheduled_at as at, time_set_by_hand_at is not null as by_hand, client_reminder_sent_at is not null as reminded from public.bookings where id = $1",
        [id],
      )
    )[0];
  const iso = (v: { at: string }) => new Date(v.at).toISOString();
  const startOf = async (id: string) => (await api.sql<{ t: string }>("select start_time::text as t from public.booking_series where id = $1", [id]))[0].t;

  async function setup() {
    const c = await company();
    const other = await company("Other Co");
    const client = await addClient(api.sql, c.org, "Hilda Daubner");
    const client2 = await addClient(api.sql, c.org, "Joan Ferris");
    const theirClient = await addClient(api.sql, other.org, "Their Client");
    const s = await series(c, client, "09:00");
    const s2 = await series(c, client2, "13:00");
    const theirS = await series(other, theirClient, "09:00");
    return {
      c,
      other,
      s,
      s2,
      theirS,
      v1: await visit(c, client, s, at(3, "10:00")),
      v2: await visit(c, client, s, at(10, "10:00")),
      onTime: await visit(c, client, s, at(17, "09:00")),
      byHand: await visit(c, client, s, at(24, "10:00"), { byHand: true }),
      past: await visit(c, client, s, at(-4, "10:00")),
      cancelled: await visit(c, client, s, at(31, "10:00"), { status: "cancelled" }),
      w1: await visit(c, client2, s2, at(5, "14:00")),
      t1: await visit(other, theirClient, theirS, at(3, "10:00")),
      client,
    };
  }

  it("Restore puts the drifted visits back at the series' time and touches nothing else; a cleaner can't, another company can't", async () => {
    const x = await setup();
    const before = new Map<string, Awaited<ReturnType<typeof when>>>();
    for (const id of [x.v1, x.v2, x.onTime, x.byHand, x.past, x.cancelled, x.w1, x.t1]) before.set(id, await when(id));

    expect(await as(x.c.anna, () => needsYou.restoreSeriesTimesAction(x.s))).toEqual({ ok: false, error: "Only owners, admins, or managers can do that." });
    await as(x.other.owner, () => needsYou.restoreSeriesTimesAction(x.s));
    expect(await when(x.v1), "nobody else moved it").toEqual(before.get(x.v1));

    expect(await as(x.c.olha, () => needsYou.restoreSeriesTimesAction(x.s)), api.log().slice(-600)).toEqual({ ok: true });
    expect(iso(await when(x.v1))).toBe(at(3, "09:00"));
    expect(iso(await when(x.v2))).toBe(at(10, "09:00"));
    expect((await when(x.v1)).reminded, "the client's reminder is due again at the right time").toBe(false);
    for (const id of [x.onTime, x.byHand, x.past, x.cancelled, x.w1, x.t1]) expect(await when(id), id).toEqual(before.get(id));
    const audit = await api.sql<{ entity_id: string }>(
      "select entity_id from public.audit_log where organization_id = $1 and after ->> 'via' = 'series_drift_restore'",
      [x.c.org],
    );
    expect(audit.map((a) => a.entity_id).sort()).toEqual([x.v1, x.v2].sort());
    expect(await as(x.c.olha, () => needsYou.restoreSeriesTimesAction(x.s)), "nothing left to restore").toEqual({ ok: true });
  });

  it("Restore leaves, and names, a visit the cleaner is already booked against; the rest go back", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Stacie Moore");
    const s = await series(c, client, "09:00");
    const v1 = await visit(c, client, s, at(3, "10:00"), { crew: c.anna });
    const v2 = await visit(c, client, s, at(10, "10:00"), { crew: c.anna });
    const blocker = await addBooking(api.sql, c.org, await addClient(api.sql, c.org, "Other Job"), { scheduledAt: at(3, "08:00"), durationMinutes: 90 });
    await addCrew(api.sql, c.org, blocker, c.anna.membershipId);

    const res = await as(c.olha, () => needsYou.restoreSeriesTimesAction(s));
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/^1 visit restored\. 1 left as they were because the cleaner already has another booking then: .+\. Move that booking or pick Keep\.$/) });
    expect(iso(await when(v1))).toBe(at(3, "10:00"));
    expect(iso(await when(v2))).toBe(at(10, "09:00"));
  });

  it("Keep, when the visits agree, makes their time the series' time and moves no visit", async () => {
    const x = await setup();
    const before = new Map<string, Awaited<ReturnType<typeof when>>>();
    for (const id of [x.v1, x.v2, x.onTime, x.byHand, x.past, x.w1, x.t1]) before.set(id, await when(id));

    expect(await as(x.c.anna, () => needsYou.keepSeriesTimesAction(x.s))).toEqual({ ok: false, error: "Only owners, admins, or managers can do that." });
    expect(await startOf(x.s)).toBe("09:00:00");
    expect(await as(x.c.olha, () => needsYou.keepSeriesTimesAction(x.s))).toEqual({ ok: true });
    expect(await startOf(x.s)).toBe("10:00:00");
    for (const id of [x.v1, x.v2, x.onTime, x.byHand, x.past, x.w1, x.t1]) expect(await when(id), id).toEqual(before.get(id));
    expect(await startOf(x.s2)).toBe("13:00:00");
    expect(await startOf(x.theirS)).toBe("09:00:00");
  });

  it("Keep, when the visits disagree, marks just those visits as set by hand and stops asking", async () => {
    const x = await setup();
    const halfPast = await visit(x.c, x.client, x.s, at(12, "09:30"));
    expect(await as(x.c.olha, () => needsYou.keepSeriesTimesAction(x.s))).toEqual({ ok: true });
    expect(await startOf(x.s), "mixed times can't be one series time").toBe("09:00:00");
    for (const id of [x.v1, x.v2, halfPast]) expect((await when(id)).by_hand, id).toBe(true);
    for (const id of [x.onTime, x.past, x.cancelled, x.w1, x.t1]) expect((await when(id)).by_hand, id).toBe(false);
    // Nothing left for Restore to move.
    expect(await as(x.c.olha, () => needsYou.restoreSeriesTimesAction(x.s))).toEqual({ ok: true });
    expect(iso(await when(x.v1))).toBe(at(3, "10:00"));
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("the day glance on the booking form", () => {
  it("lists the visits on that day in the company's own time, with who is on them, and nothing from either side of it", async () => {
    const c = await company();
    const other = await company("Other Co");
    const client = await addClient(api.sql, c.org, "Margaret Ann MacLeod");
    const job = (iso: string, status = "confirmed", org = c.org, who: Member | null = null) =>
      addBooking(api.sql, org, org === c.org ? client : theirClient, { scheduledAt: iso, durationMinutes: 120, status }).then(async (id) => {
        if (who) await api.sql("update public.bookings set assigned_to = $2 where id = $1", [id, who.membershipId]);
        return id;
      });
    const theirClient = await addClient(api.sql, other.org, "Their Client");
    const morning = await job(at(5, "08:00"), "confirmed", c.org, c.anna);
    const evening = await job(at(5, "20:00")); // 02:00 UTC the next day
    await job(at(4, "23:30")); // the same UTC date, the day before in Regina
    await job(at(5, "12:00"), "cancelled");
    await job(at(6, "00:30"));
    await job(at(5, "10:00"), "confirmed", other.org);

    const res = await as(c.olha, () => getDayGlanceAction(reginaYmd(5)));
    expect(res, api.log().slice(-400)).toEqual({
      ok: true,
      jobs: [
        { id: morning, startMinutes: 480, durationMinutes: 120, clientName: expect.stringContaining("Margaret Ann MacLeod"), who: await nameOf(c.anna), status: "confirmed" },
        { id: evening, startMinutes: 1200, durationMinutes: 120, clientName: expect.stringContaining("Margaret Ann MacLeod"), who: null, status: "confirmed" },
      ],
    });
    expect(await as(c.olha, () => getDayGlanceAction("16/11/2026"))).toEqual({ ok: false, error: "Pick a date first." });
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("asking off a recurring client", () => {
  async function setup() {
    const c = await company();
    const other = await company("Other Co");
    const client = await addClient(api.sql, c.org, "Nancy Ellestad");
    const [s] = await api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes, service_type, total_cents, assigned_to)
       values ($1, $2, 'weekly', '09:00', $3, 120, 'standard', 15000, $4) returning id`,
      [c.org, client, reginaYmd(-7), c.anna.membershipId],
    );
    const visit = async (days: number) => {
      const [b] = await api.sql<{ id: string }>(
        `insert into public.bookings (organization_id, client_id, series_id, scheduled_at, duration_minutes, service_type, status, total_cents, assigned_to, address)
         values ($1, $2, $3, $4::timestamptz, 120, 'standard', 'confirmed', 15000, $5, '9 Oak Ave') returning id`,
        [c.org, client, s.id, at(days, "09:00"), c.anna.membershipId],
      );
      await api.sql(
        "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status) values ($1, $2, $3, true, 'accepted')",
        [c.org, b.id, c.anna.membershipId],
      );
      return b.id;
    };
    return { c, other, series: s.id, v1: await visit(3), v2: await visit(10) };
  }
  const crewOf = async (id: string) =>
    (await api.sql<{ m: string }>("select membership_id as m from public.booking_assignees where booking_id = $1", [id])).map((r) => r.m);
  const assignedTo = async (id: string) => (await api.sql<{ a: string | null }>("select assigned_to as a from public.bookings where id = $1", [id]))[0].a;
  const requests = (org: string) =>
    api.sql<Record<string, unknown>>(
      "select membership_id, booking_id, series_id, kind, status, reason from public.shift_change_requests where organization_id = $1",
      [org],
    );

  it("takes her off this visit only, files the request for the office, and tells the office", async () => {
    const x = await setup();
    const res = await as(x.c.anna, () => requestSeriesStopAction(x.v1, "Moving to Calgary in December"));
    expect(res, api.log().slice(-400)).toEqual({ ok: true });
    expect(await crewOf(x.v1)).toEqual([]);
    expect(await assignedTo(x.v1), "shows as unfilled").toBeNull();
    expect(await crewOf(x.v2), "the later visits wait for the office").toEqual([x.c.anna.membershipId]);
    expect(await assignedTo(x.v2)).toBe(x.c.anna.membershipId);
    expect(await requests(x.c.org)).toEqual([
      { membership_id: x.c.anna.membershipId, booking_id: x.v1, series_id: x.series, kind: "series_stop", status: "open", reason: "Moving to Calgary in December" },
    ]);
    const told = await api.sql<{ r: string }>(
      "select recipient_membership_id as r from public.notifications where organization_id = $1 and title = 'Shift cancelled + recurring change request'",
      [x.c.org],
    );
    expect(told.map((t) => t.r).sort()).toEqual([x.c.owner.membershipId, x.c.olha.membershipId].sort());
    const office = await Promise.all([x.c.owner, x.c.olha].map(emailOf));
    expect(outbox.email.map((m) => m.to).sort()).toEqual(office.sort());
  });

  it("is refused without a reason, to someone not on the visit, from another company, or once she has clocked in; nothing is filed", async () => {
    const x = await setup();
    expect(await as(x.c.anna, () => requestSeriesStopAction(x.v2, "no"))).toEqual({ ok: false, error: "Please add a short reason." });
    expect(await as(x.c.bea, () => requestSeriesStopAction(x.v2, "Not my client"))).toEqual({ ok: false, error: "This shift isn't assigned to you." });
    expect(await as(x.other.anna, () => requestSeriesStopAction(x.v2, "Not my company"))).toEqual({ ok: false, error: "This shift isn't assigned to you." });
    await api.sql("insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at) values ($1, $2, $3, now() - interval '5 minutes')", [
      x.c.org,
      x.c.anna.membershipId,
      x.v1,
    ]);
    expect(await as(x.c.anna, () => requestSeriesStopAction(x.v1, "Feeling unwell"))).toMatchObject({ ok: false, error: expect.stringContaining("already clocked in") });
    expect(await requests(x.c.org)).toEqual([]);
    expect(await requests(x.other.org)).toEqual([]);
    expect(await crewOf(x.v1)).toEqual([x.c.anna.membershipId]);
    expect(await crewOf(x.v2)).toEqual([x.c.anna.membershipId]);
    expect(outbox.email).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("the nightly close of finished visits", () => {
  it("closes, once, only the staffed visits that ended more than the company's grace ago", async () => {
    const c = await company("Close Co", { auto_complete_past_bookings: { enabled: true } }, 2);
    const off = await company("Off Co");
    const cleo = await addMember(api.sql, c.org, "employee", "Cleo");
    const dana = await addMember(api.sql, c.org, "employee", "Dana");
    const job = async (co: { org: string }, startedAgo: number, minutes: number, status: string, crew: Member | null) => {
      const id = await addBooking(api.sql, co.org, await addClient(api.sql, co.org, "Close Client"), { scheduledAt: minutesAgo(startedAgo), durationMinutes: minutes, status });
      await api.sql("update public.bookings set total_cents = 20000 where id = $1", [id]);
      if (crew) await addCrew(api.sql, co.org, id, crew.membershipId);
      return id;
    };
    const due = await job(c, 600, 120, "confirmed", c.anna);
    const inGrace = await job(c, 180, 120, "confirmed", c.bea);
    const onClock = await job(c, 600, 120, "confirmed", cleo);
    await api.sql("insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at) values ($1, $2, $3, $4)", [c.org, cleo.membershipId, onClock, minutesAgo(590)]);
    const unstaffed = await job(c, 600, 120, "confirmed", null);
    const pending = await job(c, 600, 120, "pending", dana);
    const cancelled = await job(c, 600, 120, "cancelled", null);
    const future = await job(c, -2 * 24 * 60, 120, "confirmed", c.anna);
    const switchedOff = await job(off, 600, 120, "confirmed", off.anna);
    const statusOf = async (id: string) => (await api.sql<{ s: string }>("select status::text as s from public.bookings where id = $1", [id]))[0].s;
    const closes = async (id: string) =>
      (await api.sql("select 1 from public.audit_log where entity_id = $1 and action = 'status_change' and after ->> 'status' = 'completed'", [id])).length;
    const toldOwner = (title: string) =>
      api.sql("select 1 from public.notifications where recipient_membership_id = $1 and title = $2", [c.owner.membershipId, title]);

    expect((await cron(completeBookingsCron, "/api/cron/complete-bookings", "wrong-secret-wrong-secret")).status).toBe(401);
    expect(await statusOf(due)).toBe("confirmed");

    const res = await cron(completeBookingsCron, "/api/cron/complete-bookings");
    expect(res.status, api.log().slice(-600)).toBe(200);
    expect(await statusOf(due)).toBe("completed");
    for (const [id, s] of [
      [inGrace, "confirmed"],
      [onClock, "confirmed"],
      [unstaffed, "confirmed"],
      [pending, "pending"],
      [cancelled, "cancelled"],
      [future, "confirmed"],
      [switchedOff, "confirmed"],
    ] as const) {
      expect(await statusOf(id), id).toBe(s);
    }
    expect(await toldOwner("A past job was never staffed")).toHaveLength(1);
    expect(await toldOwner("A past job still has someone on the clock")).toHaveLength(1);
    expect(await toldOwner("A pending job's date has passed")).toHaveLength(1);

    await cron(completeBookingsCron, "/api/cron/complete-bookings");
    expect(await statusOf(due)).toBe("completed");
    expect(await closes(due), "closed once").toBe(1);
    expect(await toldOwner("A past job was never staffed"), "told once a night").toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("the morning check", () => {
  it("emails what needs a look, trims month-old records, and changes nothing else", async () => {
    const c = await company("Morning Co", { auto_complete_past_bookings: { enabled: true } }, 2);
    const prev = { org: process.env.MORNING_CHECK_ORG_ID, to: process.env.MORNING_CHECK_EMAIL };
    process.env.MORNING_CHECK_ORG_ID = c.org;
    process.env.MORNING_CHECK_EMAIL = "office@example.com";
    try {
      const client = await addClient(api.sql, c.org, "Long Day");
      const long = await addBooking(api.sql, c.org, client, { scheduledAt: minutesAgo(13 * 60), durationMinutes: 240 });
      await addCrew(api.sql, c.org, long, c.anna.membershipId);
      await api.sql("insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at) values ($1, $2, $3, $4)", [
        c.org,
        c.anna.membershipId,
        long,
        minutesAgo(13 * 60),
      ]);
      const stale = await addBooking(api.sql, c.org, client, { scheduledAt: minutesAgo(20 * 60), durationMinutes: 120, status: "pending" });
      await api.sql(
        "insert into public.refusal_log (organization_id, path, kind, message, created_at) values ($1, '/app', 'toast', 'Old refusal', now() - interval '40 days'), ($1, '/app', 'toast', 'Fresh refusal', now() - interval '1 hour')",
        [c.org],
      );

      const snapshot = async () => ({
        bookings: await api.sql("select id, status::text as status, assigned_to, closed_at from public.bookings where organization_id = $1 order by id", [c.org]),
        crew: await api.sql("select booking_id, membership_id, acceptance_status from public.booking_assignees where organization_id = $1 order by booking_id", [c.org]),
        shifts: await api.sql("select id, clock_out_at from public.time_entries where organization_id = $1 order by id", [c.org]),
        notices: await api.sql("select id, read_at from public.notifications where organization_id = $1 order by id", [c.org]),
      });
      const before = await snapshot();
      expect(before.bookings.map((b) => b.id)).toEqual([long, stale].sort());

      expect((await cron(morningCheckCron, "/api/cron/morning-check", "wrong-secret-wrong-secret")).status).toBe(401);

      const dry = await cron(morningCheckCron, "/api/cron/morning-check?dry_run=1");
      const report = (await dry.json()) as { ok: boolean; flags: string[] };
      expect(report.ok, JSON.stringify(report).slice(0, 600)).toBe(true);
      expect(report.flags).toContain("1 cleaner(s) on the clock 12+ hours (section 5)");
      expect(outbox.email, "a dry run sends nothing").toHaveLength(0);
      expect(await api.sql("select 1 from public.refusal_log where organization_id = $1", [c.org]), "and trims nothing").toHaveLength(2);

      const res = await cron(morningCheckCron, "/api/cron/morning-check");
      expect(res.status).toBe(200);
      expect(outbox.email).toHaveLength(1);
      expect(outbox.email[0].to).toBe("office@example.com");
      expect(outbox.email[0].subject).toMatch(new RegExp(`^Morning check: \\d+ to look at — ${c.name}$`));
      expect(outbox.email[0].text).toContain("on the clock 12+ hours");

      expect(await snapshot(), "a report, not a repair").toEqual(before);
      expect(
        (await api.sql<{ message: string }>("select message from public.refusal_log where organization_id = $1", [c.org])).map((r) => r.message),
      ).toEqual(["Fresh refusal"]);
    } finally {
      if (prev.org === undefined) delete process.env.MORNING_CHECK_ORG_ID;
      else process.env.MORNING_CHECK_ORG_ID = prev.org;
      if (prev.to === undefined) delete process.env.MORNING_CHECK_EMAIL;
      else process.env.MORNING_CHECK_EMAIL = prev.to;
    }
  });
});

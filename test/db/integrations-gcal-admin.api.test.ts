/**
 * The Google Calendar repair tools under /api/admin, run through their real
 * routes against a real database behind the real PostgREST, with Google
 * stood in for (test/db/fake-google-calendar.ts).
 *
 *   gcal-backfill                  create events for jobs that have none
 *   gcal-force-resync              wipe the company calendar's Sollos events, push again
 *   gcal-force-resync-members      re-push every connected cleaner's calendar
 *   gcal-prune-member-orphans      delete Sollos events on cleaners' calendars no job points at
 *   gcal-prune-orphans             the same on the company calendar
 *   gcal-reconcile                 clear event ids whose event is gone
 *
 * Who may run them: whoever holds CRON_SECRET, in the Authorization header
 * (the query-string `secret` their comments still mention was removed).
 * What they owe a calendar people read to know where to be: touch only the
 * calendar and the company named, never a personal event, never another
 * company's live event.
 */
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { installFakeGoogleCalendar, type FakeGoogle } from "./fake-google-calendar";

const SECRET = "integrations-gcal-admin-cron-secret";
const ENV: Record<string, string> = {
  INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  GOOGLE_CALENDAR_CLIENT_ID: "test-client",
  GOOGLE_CALENDAR_CLIENT_SECRET: "test-secret",
  CRON_SECRET: SECRET,
};
const saved: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries(ENV)) {
  saved[k] = process.env[k];
  process.env[k] = v;
}

type Handler = (req: NextRequest) => Promise<Response>;
const routes: Record<string, Handler> = {
  "gcal-backfill": (await import("@/app/api/admin/gcal-backfill/route")).GET,
  "gcal-force-resync": (await import("@/app/api/admin/gcal-force-resync/route")).GET,
  "gcal-force-resync-members": (await import("@/app/api/admin/gcal-force-resync-members/route")).GET,
  "gcal-prune-member-orphans": (await import("@/app/api/admin/gcal-prune-member-orphans/route")).GET,
  "gcal-prune-orphans": (await import("@/app/api/admin/gcal-prune-orphans/route")).GET,
  "gcal-reconcile": (await import("@/app/api/admin/gcal-reconcile/route")).GET,
};
const { encryptSecret } = await import("@/lib/crypto");

let api: Api;
let restoreEnv: () => void;
let google: FakeGoogle;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  google = installFakeGoogleCalendar();
});
afterEach(() => {
  google?.restore();
});

async function run(tool: string, query: string, auth: string | null = `Bearer ${SECRET}`) {
  const res = await routes[tool](
    new NextRequest(`https://sollos3.com/api/admin/${tool}${query ? `?${query}` : ""}`, auth ? { headers: { authorization: auth } } : {}),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (days: number, hourUtc = 15) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
};
const plus = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
const ghostId = () => "00000000-0000-4000-8000-" + randomBytes(6).toString("hex");
const tok = (p: string) => `${p}-${randomBytes(4).toString("hex")}`;

async function company(name = "Calendar Co") {
  const org = await addOrg(api.sql, name);
  await api.sql("update public.organizations set timezone = 'America/Regina' where id = $1", [org]);
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    bea: await addMember(api.sql, org, "employee", "Bea"),
    client: await addClient(api.sql, org, "Ken Hicks"),
  };
}
type Co = Awaited<ReturnType<typeof company>>;

async function connect(org: string, member: Member | null, token: string): Promise<void> {
  await api.sql(
    `insert into public.integration_connections
       (organization_id, membership_id, provider, status, scope, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, metadata)
     values ($1, $2, 'google_calendar', 'active', 'https://www.googleapis.com/auth/calendar.events openid', $3, $4, now() + interval '1 hour', '{"calendar_id":"primary"}'::jsonb)`,
    [org, member?.membershipId ?? null, encryptSecret(token), encryptSecret(`refresh-${token}`)],
  );
}

async function job(c: Co, scheduledAt: string, opts: { crew?: Member[]; status?: string; eventId?: string | null; client?: string } = {}) {
  const [b] = await api.sql<{ id: string }>(
    `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, google_calendar_event_id)
     values ($1, $2, $3::timestamptz, 120, 'standard', $4::public.booking_status, $5) returning id`,
    [c.org, opts.client ?? c.client, scheduledAt, opts.status ?? "confirmed", opts.eventId ?? null],
  );
  for (const m of opts.crew ?? []) {
    await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id, acceptance_status) values ($1, $2, $3, 'accepted')", [
      c.org,
      b.id,
      m.membershipId,
    ]);
  }
  return b.id;
}

/** A company-calendar event for a job, linked from the booking. */
async function orgEvent(token: string, booking: string, start: string) {
  const e = google.put(token, { summary: "Standard clean", description: `Managed by Sollos — /app/bookings/${booking}`, start: { dateTime: start }, end: { dateTime: plus(start, 120) } });
  await api.sql("update public.bookings set google_calendar_event_id = $2 where id = $1", [booking, e.id]);
  return e;
}
/** A cleaner's own-calendar event for a job, with its mapping row. */
async function memberEvent(token: string, m: Member, booking: string, start: string, mapped = true) {
  const e = google.put(token, { summary: "standard clean", description: `\nManaged by Sollos — /field/jobs/${booking}`, start: { dateTime: start }, end: { dateTime: plus(start, 120) } });
  if (mapped) {
    await api.sql("insert into public.booking_member_calendar_events (booking_id, membership_id, google_calendar_event_id) values ($1, $2, $3)", [
      booking,
      m.membershipId,
      e.id,
    ]);
  }
  return e;
}
const personal = (token: string, days: number) => google.put(token, { summary: "Dentist", description: "Bring the card", start: { dateTime: at(days, 20) }, end: { dateTime: at(days, 21) } });
const sollos = (token: string) => [...google.calendar(token).values()].filter((e) => (e.description ?? "").includes("Managed by Sollos"));
const eventIdOf = async (booking: string) =>
  (await api.sql<{ e: string | null }>("select google_calendar_event_id as e from public.bookings where id = $1", [booking]))[0].e;

// ===========================================================================

describe.skipIf(!hasPostgrest)("who may run the calendar repair tools", { timeout: 120_000 }, () => {
  it("each refuses without the secret in the header (the old ?secret= no longer works), and asks for a company", async () => {
    const c = await company();
    for (const tool of Object.keys(routes)) {
      expect((await run(tool, `org_id=${c.org}`, null)).status, tool).toBe(401);
      expect((await run(tool, `org_id=${c.org}&secret=${SECRET}`, null)).status, `${tool} with ?secret=`).toBe(401);
      expect((await run(tool, `org_id=${c.org}`, "Bearer not-the-secret-at-all")).status, tool).toBe(401);
      expect((await run(tool, "")).status, `${tool} without org_id`).toBe(400);
    }
    expect(google.calls, "nothing reached Google").toEqual([]);
  });
});

describe.skipIf(!hasPostgrest)("gcal-backfill", { timeout: 120_000 }, () => {
  it("counts on a dry run; then creates events for jobs that have none, adopts ones already on the calendar, and leaves the rest", async () => {
    const c = await company();
    const token = tok("tok-office");
    await connect(c.org, null, token);
    const bare = await job(c, at(2));
    const adoptable = await job(c, at(3));
    const already = google.put(token, { summary: "Standard clean", description: `Managed by Sollos — /app/bookings/${adoptable}`, start: { dateTime: at(3) }, end: { dateTime: plus(at(3), 120) } });
    const linked = await job(c, at(4));
    const linkedEvent = await orgEvent(token, linked, at(4));
    const cancelled = await job(c, at(5), { status: "cancelled" });

    const dry = await run("gcal-backfill", `org_id=${c.org}&dry_run=1`);
    expect(dry.body, api.log().slice(-500)).toMatchObject({ ok: true, dry_run: true, found: 2 });
    expect(sollos(token)).toHaveLength(2);

    const done = await run("gcal-backfill", `org_id=${c.org}`);
    expect(done.body).toMatchObject({ ok: true, found: 2, created: 1, relinked: 1, remaining_null: 0 });
    expect(await eventIdOf(adoptable), "adopted, not duplicated").toBe(already.id);
    expect(await eventIdOf(linked)).toBe(linkedEvent.id);
    expect(await eventIdOf(cancelled)).toBeNull();
    const created = await eventIdOf(bare);
    expect(google.calendar(token).get(created!)?.description).toContain(bare);
    expect(sollos(token)).toHaveLength(3);
  });

  it("scoped to some clients, it fills only theirs", async () => {
    const c = await company();
    const token = tok("tok-office");
    await connect(c.org, null, token);
    const otherClient = await addClient(api.sql, c.org, "Oliver Little");
    const mine = await job(c, at(2));
    const theirs = await job(c, at(2, 20), { client: otherClient });
    const res = await run("gcal-backfill", `org_id=${c.org}&client_ids=${otherClient}`);
    expect(res.body).toMatchObject({ ok: true, found: 1, created: 1, remaining_null: 0 });
    expect(await eventIdOf(theirs)).not.toBeNull();
    expect(await eventIdOf(mine)).toBeNull();
  });
});

describe.skipIf(!hasPostgrest)("gcal-force-resync", { timeout: 120_000 }, () => {
  it("wipes the company calendar's Sollos events, keeps personal ones, and pushes the upcoming jobs again", async () => {
    const c = await company();
    const token = tok("tok-office");
    await connect(c.org, null, token);
    const b = await job(c, at(2));
    const old = await orgEvent(token, b, at(2));
    const ghost = google.put(token, { summary: "Standard clean", description: `Managed by Sollos — /app/bookings/${ghostId()}`, start: { dateTime: at(3) }, end: { dateTime: plus(at(3), 120) } });
    const dentist = personal(token, 2);

    const res = await run("gcal-force-resync", `org_id=${c.org}`);
    expect(res.body, api.log().slice(-500)).toMatchObject({ ok: true, sollos_events_found: 2, deleted_from_gcal: 2, synced: true, errors: [] });
    const cal = google.calendar(token);
    expect(cal.has(old.id)).toBe(false);
    expect(cal.has(ghost.id)).toBe(false);
    expect(cal.has(dentist.id)).toBe(true);
    const fresh = await eventIdOf(b);
    expect(fresh).not.toBeNull();
    expect(cal.get(fresh!)?.description).toContain(b);
    expect(sollos(token)).toHaveLength(1);
  });

  it("a company with no Google Calendar is told so", async () => {
    const c = await company();
    const res = await run("gcal-force-resync", `org_id=${c.org}`);
    expect(res).toEqual({ status: 404, body: { error: "No active Google Calendar connection for this org" } });
  });

  it("with more than 40 jobs, running it again as its hint says clears a doubled event late in the calendar", { timeout: 120_000 }, async () => {
    const c = await company();
    const token = tok("tok-office");
    await connect(c.org, null, token);
    google.pageSize = 2500;
    const jobs: string[] = [];
    for (let i = 1; i <= 45; i++) {
      const b = await job(c, at(i));
      await orgEvent(token, b, at(i));
      jobs.push(b);
    }
    const last = jobs[jobs.length - 1];
    // The historic bug: a second event for the same job.
    google.put(token, { summary: "Standard clean", description: `Managed by Sollos — /app/bookings/${last}`, start: { dateTime: at(45) }, end: { dateTime: plus(at(45), 120) } });

    for (let pass = 0; pass < 3; pass++) {
      const res = await run("gcal-force-resync", `org_id=${c.org}`);
      expect(res.body.ok, JSON.stringify(res.body)).toBe(true);
      if (!res.body.hint) break;
    }
    const forLast = sollos(token).filter((e) => e.description?.includes(last));
    expect(forLast, "one event for the last job").toHaveLength(1);
  });

  it("still repairs the company calendar when a cleaner has connected her own", async () => {
    const c = await company();
    const token = tok("tok-office");
    await connect(c.org, null, token);
    await connect(c.org, c.anna, tok("tok-anna"));
    const b = await job(c, at(2));
    await orgEvent(token, b, at(2));
    const res = await run("gcal-force-resync", `org_id=${c.org}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ok: true, sollos_events_found: 1 });
  });

  it("with only a cleaner's own calendar connected, it leaves her calendar alone", async () => {
    const c = await company();
    const annaToken = tok("tok-anna");
    await connect(c.org, c.anna, annaToken);
    const b = await job(c, at(2), { crew: [c.anna] });
    const hers = await memberEvent(annaToken, c.anna, b, at(2));
    const res = await run("gcal-force-resync", `org_id=${c.org}`);
    expect(google.calendar(annaToken).has(hers.id), "her job is still on her calendar").toBe(true);
    expect(res.status).toBe(404);
  });

  it("on a calendar shared with another company, the other company's live events stay", async () => {
    const c = await company();
    const other = await company("Other Co");
    const shared = tok("tok-shared");
    await connect(c.org, null, shared);
    await connect(other.org, null, shared);
    const mine = await job(c, at(2));
    await orgEvent(shared, mine, at(2));
    const theirs = await job(other, at(3));
    const theirEvent = await orgEvent(shared, theirs, at(3));

    const res = await run("gcal-force-resync", `org_id=${c.org}`);
    expect(res.status).toBe(200);
    expect(google.calendar(shared).has(theirEvent.id), "the other company's job is still on the calendar").toBe(true);
    expect(await eventIdOf(theirs)).toBe(theirEvent.id);
  });
});

describe.skipIf(!hasPostgrest)("gcal-force-resync-members", { timeout: 120_000 }, () => {
  it("re-pushes the jobs missing from each connected cleaner's calendar in this company, and no one else's", async () => {
    const c = await company();
    const other = await company("Other Co");
    const annaToken = tok("tok-anna");
    const beaToken = tok("tok-bea");
    const theirToken = tok("tok-their");
    await connect(c.org, c.anna, annaToken);
    await connect(c.org, c.bea, beaToken);
    await connect(c.org, null, tok("tok-office"));
    await connect(other.org, other.anna, theirToken);
    const annas = await job(c, at(2), { crew: [c.anna] });
    const beas = await job(c, at(2, 20), { crew: [c.bea] });
    const beaHad = await memberEvent(beaToken, c.bea, beas, at(2, 20));
    await job(other, at(2), { crew: [other.anna] });

    const res = await run("gcal-force-resync-members", `org_id=${c.org}`);
    expect(res.body, api.log().slice(-500)).toMatchObject({ ok: true, member_count: 2, synced: 2, failed: 0 });
    const details = res.body.details as Array<{ membership_id: string; member_name: string; ok: boolean }>;
    expect(details.map((d) => d.membership_id).sort()).toEqual([c.anna.membershipId, c.bea.membershipId].sort());
    expect(details.find((d) => d.membership_id === c.anna.membershipId)?.member_name).toMatch(/^Anna/);
    expect(sollos(annaToken).map((e) => e.description?.includes(annas))).toEqual([true]);
    expect(sollos(beaToken).map((e) => e.id), "not doubled").toEqual([beaHad.id]);
    expect(sollos(theirToken), "another company's cleaner untouched").toEqual([]);
  });
});

describe.skipIf(!hasPostgrest)("gcal-prune-member-orphans", { timeout: 120_000 }, () => {
  it("finds Sollos events on cleaners' calendars that no job points at; deletes them, one cleaner or all, never a live or personal event", async () => {
    const c = await company();
    const other = await company("Other Co");
    const annaToken = tok("tok-anna");
    const beaToken = tok("tok-bea");
    await connect(c.org, c.anna, annaToken);
    await connect(c.org, c.bea, beaToken);
    await connect(other.org, other.anna, tok("tok-their"));
    const b = await job(c, at(2), { crew: [c.anna] });
    const live = await memberEvent(annaToken, c.anna, b, at(2));
    const annaGhost = await memberEvent(annaToken, c.anna, ghostId(), at(3), false);
    const pilates = personal(annaToken, 3);
    const beaGhost = await memberEvent(beaToken, c.bea, ghostId(), at(4), false);

    const dry = await run("gcal-prune-member-orphans", `org_id=${c.org}&dry_run=1`);
    expect(dry.body, api.log().slice(-500)).toMatchObject({ ok: true, dry_run: true, members_scanned: 2, total_orphans_found: 2, total_deleted: 0 });
    expect(google.calendar(annaToken).has(annaGhost.id)).toBe(true);

    const one = await run("gcal-prune-member-orphans", `org_id=${c.org}&membership_id=${c.anna.membershipId}`);
    expect(one.body).toMatchObject({ ok: true, members_scanned: 1, total_orphans_found: 1, total_deleted: 1 });
    expect(google.calendar(annaToken).has(annaGhost.id)).toBe(false);
    expect(google.calendar(annaToken).has(live.id)).toBe(true);
    expect(google.calendar(annaToken).has(pilates.id)).toBe(true);
    expect(google.calendar(beaToken).has(beaGhost.id)).toBe(true);

    // Another company's cleaner, named under this company's id: out of reach.
    const cross = await run("gcal-prune-member-orphans", `org_id=${c.org}&membership_id=${other.anna.membershipId}`);
    expect(cross.body).toMatchObject({ members_scanned: 0, total_deleted: 0 });

    const all = await run("gcal-prune-member-orphans", `org_id=${c.org}`);
    expect(all.body).toMatchObject({ ok: true, total_deleted: 1 });
    expect(google.calendar(beaToken).has(beaGhost.id)).toBe(false);
  });
});

describe.skipIf(!hasPostgrest)("gcal-prune-orphans", { timeout: 120_000 }, () => {
  it("deletes company-calendar Sollos events no job points at; keeps live, personal, and a sharing company's events", async () => {
    const c = await company();
    const other = await company("Other Co");
    const shared = tok("tok-shared");
    await connect(c.org, null, shared);
    const b = await job(c, at(2));
    const live = await orgEvent(shared, b, at(2));
    const ghost = google.put(shared, { summary: "Standard clean", description: `Managed by Sollos — /app/bookings/${ghostId()}`, start: { dateTime: at(3) }, end: { dateTime: plus(at(3), 120) } });
    const dentist = personal(shared, 3);
    const theirs = await job(other, at(4));
    const theirEvent = await orgEvent(shared, theirs, at(4));

    const dry = await run("gcal-prune-orphans", `org_id=${c.org}&dry_run=1`);
    expect(dry.body, api.log().slice(-500)).toMatchObject({ ok: true, dry_run: true, managed_events: 3, valid_events: 1, orphans_found: 1 });
    const res = await run("gcal-prune-orphans", `org_id=${c.org}`);
    expect(res.body).toMatchObject({ ok: true, orphans_found: 1, deleted: 1, remaining: 0 });
    const cal = google.calendar(shared);
    expect([live.id, dentist.id, theirEvent.id].every((id) => cal.has(id))).toBe(true);
    expect(cal.has(ghost.id)).toBe(false);
  });
});

describe.skipIf(!hasPostgrest)("gcal-reconcile", { timeout: 120_000 }, () => {
  it("clears the event id of a job whose event is gone, keeps the live ones, and reports first on a dry run", async () => {
    const c = await company();
    const token = tok("tok-office");
    await connect(c.org, null, token);
    const live = await job(c, at(2));
    const liveEvent = await orgEvent(token, live, at(2));
    const stale = await job(c, at(3), { eventId: "deleted-by-hand" });

    const dry = await run("gcal-reconcile", `org_id=${c.org}&dry_run=1`);
    expect(dry.body, api.log().slice(-500)).toMatchObject({ ok: true, dry_run: true, checked: 2, live_events: 1, stale_found: 1 });
    expect(await eventIdOf(stale)).toBe("deleted-by-hand");

    const res = await run("gcal-reconcile", `org_id=${c.org}`);
    expect(res.body).toMatchObject({ ok: true, checked: 2, stale_found: 1, nulled: 1 });
    expect(await eventIdOf(stale)).toBeNull();
    expect(await eventIdOf(live)).toBe(liveEvent.id);
  });

  it("refuses to clear anything when the calendar comes back empty while jobs still point at events", async () => {
    const c = await company();
    await connect(c.org, null, tok("tok-empty"));
    const b = await job(c, at(2), { eventId: "evt-somewhere" });
    const res = await run("gcal-reconcile", `org_id=${c.org}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, stale_found: 1 });
    expect(await eventIdOf(b)).toBe("evt-somewhere");
  });
});

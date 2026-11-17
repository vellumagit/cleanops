/**
 * The two scheduled jobs that write to Google Calendar, run through their
 * real routes against a real database behind the real PostgREST, with
 * Google stood in for (test/db/fake-google-calendar.ts).
 *
 *   gcal-prune (Monday 5:15 UTC): deletes Sollos events on a company's
 *     calendar that no booking points at. On 2026-11-09 it deleted 39.
 *   member-calendar-reconcile (4:30 UTC): makes each connected cleaner's
 *     own calendar match the jobs she is on. On 2026-11-16 it did 8 people
 *     and re-pushed 50 events.
 *
 * What each owes a calendar that people read to know where to be: never
 * delete a live job's event or an event someone made themselves; take away
 * what has gone (a deleted or cancelled job, one she was taken off); put
 * back what is missing; show the time and length she will actually work.
 */
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { installFakeGoogleCalendar, type FakeGoogle } from "./fake-google-calendar";

const SECRET = "calendar-jobs-test-cron-secret";
const ENV: Record<string, string> = {
  INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  GOOGLE_CALENDAR_CLIENT_ID: "test-client",
  GOOGLE_CALENDAR_CLIENT_SECRET: "test-secret",
  CRON_SECRET: SECRET,
};
let api: Api;
let restoreEnv: () => void;
const saved: Record<string, string | undefined> = {};
let google: FakeGoogle;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
}, 240_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  google = installFakeGoogleCalendar();
});
afterEach(() => {
  google?.restore();
});

type Handler = (req: NextRequest) => Promise<Response>;
async function runCron(GET: Handler, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await GET(new NextRequest(`https://sollos3.com${path}`, { headers: { authorization: `Bearer ${SECRET}` } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 15:00 UTC (9:00 in Regina), `days` from today. */
const at = (days: number, hourUtc = 15) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
};
const plus = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

async function connect(org: string, member: Member | null, token: string): Promise<void> {
  const { encryptSecret } = await import("@/lib/crypto");
  await api.sql(
    `insert into public.integration_connections
       (organization_id, membership_id, provider, status, scope, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, metadata)
     values ($1, $2, 'google_calendar', 'active', 'https://www.googleapis.com/auth/calendar.events openid', $3, $4, now() + interval '1 hour', '{}'::jsonb)`,
    [org, member?.membershipId ?? null, encryptSecret(token), encryptSecret(`refresh-${token}`)],
  );
}

async function job(
  org: string,
  client: string,
  scheduledAt: string,
  opts: { crew?: Member[]; lead?: Member | null; minutes?: number; status?: string; eventId?: string | null } = {},
): Promise<string> {
  const [b] = await api.sql<{ id: string }>(
    `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, assigned_to, google_calendar_event_id)
     values ($1, $2, $3::timestamptz, $4, 'standard', $5::public.booking_status, $6, $7) returning id`,
    [org, client, scheduledAt, opts.minutes ?? 120, opts.status ?? "confirmed", opts.lead?.membershipId ?? null, opts.eventId ?? null],
  );
  for (const m of opts.crew ?? []) {
    await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id, acceptance_status) values ($1, $2, $3, 'accepted')", [
      org,
      b.id,
      m.membershipId,
    ]);
  }
  return b.id;
}

const sollosOrgEvent = (bookingId: string, start: string) => ({
  summary: "Standard clean",
  description: `Managed by Sollos — /app/bookings/${bookingId}`,
  start: { dateTime: start },
  end: { dateTime: plus(start, 120) },
});
const sollosMemberEvent = (bookingId: string, start: string, minutes = 120) => ({
  summary: "standard clean — someone",
  description: `\nManaged by Sollos — /field/jobs/${bookingId}`,
  start: { dateTime: start },
  end: { dateTime: plus(start, minutes) },
});
const ghostId = () => "00000000-0000-4000-8000-" + randomBytes(6).toString("hex");

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("gcal-prune: strays off a company's calendar", { timeout: 120_000 }, () => {
  it("deletes events no booking points at; keeps live jobs, personal events, and another company's events on a shared calendar", async () => {
    const { GET } = await import("@/app/api/cron/gcal-prune/route");
    const org = await addOrg(api.sql, "Prune Co");
    await addMember(api.sql, org, "owner");
    const client = await addClient(api.sql, org, "Hilda Daubner");
    // The other company shares this Google calendar (one owner, two accounts).
    const other = await addOrg(api.sql, "Other Co");
    const otherClient = await addClient(api.sql, other, "Ken Hicks");
    await connect(org, null, "tok-company");
    google.pageSize = 2; // the list comes back over several pages

    const live1 = google.put("tok-company", sollosOrgEvent("pending", at(3)));
    const live2 = google.put("tok-company", sollosOrgEvent("pending", at(4)));
    const b1 = await job(org, client, at(3), { eventId: live1.id });
    await job(org, client, at(4), { eventId: live2.id });
    live1.description = `Managed by Sollos — /app/bookings/${b1}`;
    const deletedJob = google.put("tok-company", sollosOrgEvent(ghostId(), at(5)));
    const duplicate = google.put("tok-company", sollosOrgEvent(b1, at(6)));
    const personal = google.put("tok-company", { summary: "Dentist", description: "Bring the insurance card", start: { dateTime: at(5, 18) }, end: { dateTime: at(5, 19) } });
    const othersJob = await job(other, otherClient, at(7));
    const theirs = google.put("tok-company", sollosOrgEvent(othersJob, at(7)));
    await api.sql("update public.bookings set google_calendar_event_id = $2 where id = $1", [othersJob, theirs.id]);

    const dry = await runCron(GET, `/api/cron/gcal-prune?org_id=${org}&dry_run=1`);
    expect(dry.body, api.log()).toMatchObject({ ok: true, dry_run: true, orphans_found: 2, deleted: 0 });
    expect(google.calendar("tok-company").size).toBe(6);

    const run = await runCron(GET, `/api/cron/gcal-prune?org_id=${org}`);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ ok: true, orphans_found: 2, deleted: 2 });
    expect([...google.calendar("tok-company").keys()].sort()).toEqual([live1.id, live2.id, personal.id, theirs.id].sort());
    expect(google.calendar("tok-company").has(deletedJob.id)).toBe(false);
    expect(google.calendar("tok-company").has(duplicate.id)).toBe(false);
  });

  it("a company with no events of its own on the calendar is left alone", async () => {
    const { GET } = await import("@/app/api/cron/gcal-prune/route");
    const org = await addOrg(api.sql, "Empty Co");
    await addMember(api.sql, org, "owner");
    await connect(org, null, "tok-empty");
    const someoneElses = google.put("tok-empty", sollosOrgEvent(ghostId(), at(2)));

    const run = await runCron(GET, `/api/cron/gcal-prune?org_id=${org}`);
    expect(run.body).toMatchObject({ ok: true, skipped_no_bookings: 1, deleted: 0 });
    expect(google.calendar("tok-empty").has(someoneElses.id)).toBe(true);
  });
});

describe.skipIf(!hasPostgrest)("member-calendar-reconcile: each cleaner's own calendar", { timeout: 180_000 }, () => {
  it("adds what's missing, fixes what drifted, removes cancelled, deleted and taken-off jobs, and leaves her own events alone", async () => {
    const { GET } = await import("@/app/api/cron/member-calendar-reconcile/route");
    const org = await addOrg(api.sql, "Reconcile Co");
    await api.sql(
      "update public.organizations set timezone = 'America/Regina', automations_enabled = true, automation_settings = '{\"divide_crew_hours\":{\"enabled\":true}}'::jsonb where id = $1",
      [org],
    );
    await addMember(api.sql, org, "owner");
    const anna = await addMember(api.sql, org, "employee", "Anna");
    const bea = await addMember(api.sql, org, "employee", "Bea");
    const client = await addClient(api.sql, org, "Margaret Ann MacLeod");
    await connect(org, anna, "tok-anna");
    google.pageSize = 3;
    const cal = google.calendar("tok-anna");
    const mapping = async (booking: string, eventId: string) =>
      api.sql("insert into public.booking_member_calendar_events (booking_id, membership_id, google_calendar_event_id) values ($1, $2, $3)", [
        booking,
        anna.membershipId,
        eventId,
      ]);

    const missing = await job(org, client, at(1), { crew: [anna] });
    const driftedAt = at(2);
    const drifted = await job(org, client, driftedAt, { crew: [anna] });
    const driftedEvent = google.put("tok-anna", sollosMemberEvent(drifted, plus(driftedAt, 60)));
    await mapping(drifted, driftedEvent.id);
    // She was taken off this one; the change-time push never reached Google.
    const takenOff = await job(org, client, at(3), { crew: [bea], lead: bea });
    const takenOffEvent = google.put("tok-anna", sollosMemberEvent(takenOff, at(3)));
    await mapping(takenOff, takenOffEvent.id);
    const cancelled = await job(org, client, at(4), { crew: [anna], status: "cancelled" });
    const cancelledEvent = google.put("tok-anna", sollosMemberEvent(cancelled, at(4)));
    await mapping(cancelled, cancelledEvent.id);
    const ghost = google.put("tok-anna", sollosMemberEvent(ghostId(), at(5)));
    // Four hours for two, shared: two hours each.
    const team = await job(org, client, at(6), { crew: [anna, bea], minutes: 240 });
    // Named first cleaner, no crew row (an old booking).
    const leading = await job(org, client, at(7), { lead: anna });
    const pilates = google.put("tok-anna", { summary: "Pilates", start: { dateTime: at(5, 1) }, end: { dateTime: at(5, 2) } });

    const run = await runCron(GET, "/api/cron/member-calendar-reconcile");
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ failed: 0 });

    const byBooking = new Map<string, { start: string; end: string; id: string }>();
    for (const e of cal.values()) {
      const m = /\/field\/jobs\/([0-9a-f-]{36})/.exec(e.description ?? "");
      if (m) byBooking.set(m[1], { start: e.start.dateTime, end: e.end.dateTime, id: e.id });
    }
    expect([...byBooking.keys()].sort(), api.log().slice(-500)).toEqual([missing, drifted, team, leading].sort());
    expect(cal.has(pilates.id)).toBe(true);
    expect(cal.has(ghost.id)).toBe(false);
    expect(cal.has(takenOffEvent.id)).toBe(false);
    expect(cal.has(cancelledEvent.id)).toBe(false);
    expect(new Date(byBooking.get(drifted)!.start).toISOString()).toBe(driftedAt);
    const t = byBooking.get(team)!;
    expect(new Date(t.end).getTime() - new Date(t.start).getTime()).toBe(2 * HOUR);

    const maps = await api.sql<{ booking_id: string }>(
      "select booking_id from public.booking_member_calendar_events where membership_id = $1",
      [anna.membershipId],
    );
    expect(maps.map((r) => r.booking_id).sort()).toEqual([missing, drifted, team, leading].sort());

    // Tomorrow night: nothing doubled, nothing lost.
    await runCron(GET, "/api/cron/member-calendar-reconcile");
    expect([...cal.values()].filter((e) => (e.description ?? "").includes("Managed by Sollos")).length).toBe(4);
    expect(cal.has(pilates.id)).toBe(true);
  });
});

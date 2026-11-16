/**
 * The emails that tell people where to be, run through their real routes
 * against a real database behind the real PostgREST. Only the outbound
 * email and text are caught instead of sent.
 *
 *   employee-daily-schedule (12:00 UTC, 6 AM in Alberta): each cleaner's
 *     jobs today. Sent 10 on 2026-11-16.
 *   employee-weekly-schedule (Sunday 18:00 UTC): each cleaner's next seven
 *     days. Sent 13 on 2026-11-15.
 *   booking-reminders-client (18:00 UTC): "your clean is tomorrow" to the
 *     client, where the company messages clients. Svit's house setting is
 *     not to, unless a client is set otherwise, so on 2026-11-16 all 13 were
 *     skipped, as they should be.
 *
 * Svit shares a team job's hours across the crew: a 4-hour job for two is
 * two hours each, which is what the field app shows each of them. The email
 * has to say the same.
 *
 * The company keeps time in America/Regina (UTC-6 all year, Alberta's clock
 * from November 2026).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";

type Sent = { to: string; subject: string; html: string };
const outbox = vi.hoisted(() => ({ email: [] as Sent[], orgEmail: [] as Sent[], sms: [] as Array<{ to: string; body: string }> }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: async (args: Sent) => {
    outbox.email.push({ to: args.to, subject: args.subject, html: args.html });
    return true;
  },
  sendOrgEmail: async (_org: string, args: Sent) => {
    outbox.orgEmail.push({ to: args.to, subject: args.subject, html: args.html });
    return true;
  },
}));
vi.mock("@/lib/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms")>()),
  sendOrgSms: async (_org: string, args: { to: string; body: string }) => {
    outbox.sms.push({ to: args.to, body: args.body });
    return { ok: true, status: "sent" };
  },
}));

const SECRET = "schedule-emails-test-cron-secret";
let api: Api;
let restoreEnv: () => void;
let previousSecret: string | undefined;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
}, 240_000);

afterAll(async () => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  outbox.email.length = 0;
  outbox.orgEmail.length = 0;
  outbox.sms.length = 0;
});

type Handler = (req: Request) => Promise<Response>;
async function runCron(GET: Handler, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await GET(new Request(`https://sollos3.com${path}`, { headers: { authorization: `Bearer ${SECRET}` } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const TZ = "America/Regina";
const DAY = 86_400_000;
const HOUR = 3_600_000;
const localToday = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
/** `hhmm` local, `days` after today in Regina, as an ISO instant. */
const localAt = (days: number, hhmm: string) =>
  new Date(Date.parse(`${localToday()}T${hhmm}:00-06:00`) + days * DAY).toISOString();

type Company = { org: string; owner: Member; anna: Member; bea: Member; gone: Member };

async function company(settings: Record<string, { enabled: boolean }>, houseDefault = "email"): Promise<Company> {
  const org = await addOrg(api.sql, "Schedule Co");
  await api.sql(
    `update public.organizations
        set timezone = $2, automations_enabled = true, automation_settings = $3::jsonb, default_contact_preference = $4
      where id = $1`,
    [org, TZ, JSON.stringify(settings), houseDefault],
  );
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    bea: await addMember(api.sql, org, "employee", "Bea"),
    gone: await addMember(api.sql, org, "employee", "Olga", "disabled"),
  };
}

async function job(
  org: string,
  clientName: string,
  at: string,
  minutes: number,
  crew: Array<{ m: Member; offset?: number; length?: number }>,
  opts: { status?: string; clientEmail?: string | null; clientPref?: string } = {},
): Promise<string> {
  const client = await addClient(api.sql, org, clientName);
  if (opts.clientEmail !== undefined || opts.clientPref) {
    // A client set to email for bookings: "custom", with the booking
    // category on email.
    await api.sql(
      `update public.clients
          set email = $2,
              contact_preference = case when $3::text is null then contact_preference else 'custom' end,
              contact_overrides = case when $3::text is null then contact_overrides else jsonb_build_object('booking', $3::text) end
        where id = $1`,
      [client, opts.clientEmail ?? null, opts.clientPref ?? null],
    );
  }
  const [b] = await api.sql<{ id: string }>(
    `insert into public.bookings
       (organization_id, client_id, scheduled_at, duration_minutes, service_type, service_type_label, address, status)
     values ($1, $2, $3::timestamptz, $4, 'standard', 'Standard clean', '6315 135 Avenue', $5::public.booking_status) returning id`,
    [org, client, at, minutes, opts.status ?? "confirmed"],
  );
  for (const [i, c] of crew.entries()) {
    await api.sql(
      `insert into public.booking_assignees
         (organization_id, booking_id, membership_id, split_index, split_start_offset_minutes, split_duration_minutes)
       values ($1, $2, $3, $4, $5, $6)`,
      [org, b.id, c.m.membershipId, c.offset != null ? i : null, c.offset ?? null, c.length ?? null],
    );
  }
  return b.id;
}

const emailOf = async (m: Member) =>
  (await api.sql<{ email: string }>("select email from auth.users where id = $1", [m.userId]))[0].email;
const mailTo = async (m: Member, box: Sent[] = outbox.email) => {
  const to = await emailOf(m);
  return box.filter((e) => e.to === to);
};
/** The text of an email with the markup taken out, so "2h" is not found inside a style. */
const words = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("employee-daily-schedule: each cleaner's jobs today", { timeout: 120_000 }, () => {
  it("gives each person their own hours: half of a shared team job, their own part of a hand-off, the whole of a solo job", async () => {
    const { GET } = await import("@/app/api/cron/employee-daily-schedule/route");
    const c = await company({ employee_daily_schedule: { enabled: true }, divide_crew_hours: { enabled: true } });
    // 8:00, four hours for two, shared: two hours each.
    await job(c.org, "Margaret Ann MacLeod", localAt(0, "08:00"), 240, [{ m: c.anna }, { m: c.bea }]);
    // 11:00, a hand-off: Anna 11 to 1, Bea 1 to 3.
    await job(c.org, "Patricia Poohkay", localAt(0, "11:00"), 240, [
      { m: c.anna, offset: 0, length: 120 },
      { m: c.bea, offset: 120, length: 120 },
    ]);
    // 4:00 PM, Bea alone for three hours.
    await job(c.org, "Lori Moeller", localAt(0, "16:00"), 180, [{ m: c.bea }]);
    // A deactivated cleaner still on a job today gets nothing.
    await job(c.org, "Nancy Ellestad", localAt(0, "09:00"), 180, [{ m: c.gone }]);
    // Tomorrow is not today.
    await job(c.org, "Hilda Daubner", localAt(1, "09:00"), 180, [{ m: c.anna }]);
    const off = await company({ employee_daily_schedule: { enabled: false } });
    await job(off.org, "Ken Hicks", localAt(0, "09:00"), 120, [{ m: off.anna }]);

    const run = await runCron(GET, "/api/cron/employee-daily-schedule");
    expect(run.status, JSON.stringify(run.body)).toBe(200);

    const [anna] = await mailTo(c.anna);
    const [bea] = await mailTo(c.bea);
    expect(anna, api.log()).toBeDefined();
    expect(bea).toBeDefined();
    expect(await mailTo(c.gone)).toHaveLength(0);
    expect(await mailTo(off.anna)).toHaveLength(0);

    const a = words(anna.html);
    expect(a).toContain("Margaret Ann MacLeod");
    expect(a).toContain("Patricia Poohkay");
    expect(a).not.toContain("Hilda Daubner");
    expect(a).not.toContain("Lori Moeller");
    expect(a).toContain("8:00 AM");
    expect(a).toContain("11:00 AM");
    // Two hours on the shared job and two on her part of the hand-off;
    // never the four the job was booked for.
    expect(a).not.toMatch(/\b4h\b/);
    expect(a).toMatch(/\b2h\b/);
    expect(a).toContain("takes over at 1:00 PM");

    const b = words(bea.html);
    expect(b).toContain("8:00 AM");
    expect(b).toContain("1:00 PM");
    expect(b).toContain("4:00 PM");
    expect(b).not.toMatch(/\b4h\b/);
    expect(b).toMatch(/\b3h\b/);
    expect(b).toContain("You take over from");
  });
});

describe.skipIf(!hasPostgrest)("employee-weekly-schedule: each cleaner's next seven days", { timeout: 120_000 }, () => {
  it("covers tomorrow through the evening of the seventh day, in local time, and nothing after", async () => {
    const { GET } = await import("@/app/api/cron/employee-weekly-schedule/route");
    const c = await company({ employee_weekly_schedule: { enabled: true } });
    await job(c.org, "Margaret Ann MacLeod", localAt(1, "09:30"), 120, [{ m: c.anna }]);
    // 9 PM on the seventh day is 3 AM UTC the day after: still this week.
    await job(c.org, "Patricia Poohkay", localAt(7, "21:00"), 120, [{ m: c.anna }]);
    await job(c.org, "Lori Moeller", localAt(8, "09:00"), 120, [{ m: c.anna }]);
    await job(c.org, "Emma Drebit", localAt(0, "23:00"), 60, [{ m: c.anna }]);
    await job(c.org, "Nancy Ellestad", localAt(2, "09:00"), 120, [{ m: c.gone }]);

    const run = await runCron(GET, "/api/cron/employee-weekly-schedule");
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    const [anna] = await mailTo(c.anna);
    expect(anna, api.log()).toBeDefined();
    const a = words(anna.html);
    expect(a).toContain("Margaret Ann MacLeod");
    expect(a).toContain("9:30 AM");
    expect(a).toContain("Patricia Poohkay");
    expect(a).toContain("9:00 PM");
    expect(a).not.toContain("Lori Moeller");
    expect(a).not.toContain("Emma Drebit");
    expect(await mailTo(c.gone)).toHaveLength(0);
  });
});

describe.skipIf(!hasPostgrest)("booking-reminders-client: 'your clean is tomorrow'", { timeout: 120_000 }, () => {
  it("reminds once, in local time with the crew's finish, only where the company messages clients", async () => {
    const { GET } = await import("@/app/api/cron/booking-reminders-client/route");
    const on = await company({ booking_reminder_client_email: { enabled: true }, divide_crew_hours: { enabled: true } });
    const at = new Date(Date.now() + 20 * HOUR).toISOString();
    await job(on.org, "Margaret Ann MacLeod", at, 240, [{ m: on.anna }, { m: on.bea }], { clientEmail: "margaret@example.test" });
    await job(on.org, "Pending Client", at, 120, [], { clientEmail: "pending@example.test", status: "pending" });
    await job(on.org, "Too Soon", new Date(Date.now() + 3 * HOUR).toISOString(), 60, [{ m: on.bea }], { clientEmail: "soon@example.test" });
    await job(on.org, "No Email", new Date(Date.now() + 21 * HOUR).toISOString(), 60, [], { clientEmail: null });
    // Svit's way: the house says nothing to clients who are not set otherwise.
    const quiet = await company({ booking_reminder_client_email: { enabled: true } }, "none");
    await job(quiet.org, "Inherits Silence", at, 120, [{ m: quiet.anna }], { clientEmail: "silent@example.test" });
    await job(quiet.org, "Asked For Email", new Date(Date.now() + 22 * HOUR).toISOString(), 120, [{ m: quiet.bea }], {
      clientEmail: "asked@example.test",
      clientPref: "email",
    });

    const run = await runCron(GET, "/api/cron/booking-reminders-client");
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(outbox.orgEmail.map((e) => e.to).sort()).toEqual(["asked@example.test", "margaret@example.test"]);
    const margaret = words(outbox.orgEmail.find((e) => e.to === "margaret@example.test")!.html);
    expect(margaret).toContain(new Date(at).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }));
    // Two cleaners sharing four hours finish two hours after the start.
    const finish = new Date(new Date(at).getTime() + 2 * HOUR).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: TZ,
    });
    expect(margaret).toContain(finish);

    // Tomorrow's run does not remind them again.
    outbox.orgEmail.length = 0;
    await runCron(GET, "/api/cron/booking-reminders-client");
    expect(outbox.orgEmail).toHaveLength(0);
  });
});

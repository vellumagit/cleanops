/**
 * The jobs that tell people a visit needs them, run through their real
 * routes against a real database behind the real PostgREST. Only the
 * outbound email is caught instead of sent.
 *
 *   unassigned-bookings (22:00 UTC, 4 PM in Alberta): emails the owner the
 *     visits in the next 24 hours that nobody is coming to.
 *   unfilled-shifts (8:00 UTC): the same condition as an in-app alert to
 *     whoever staffs shifts.
 *   upcoming-jobs (hourly): "Job starting soon" to everyone on a visit in
 *     the next hour, where the company turned it on (Svit has not).
 *
 * "Nobody is coming" means nobody active: a visit still carrying someone who
 * has been deactivated is as empty as one with no name on it. Svit has 51
 * upcoming visits for one client still naming a deactivated cleaner.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";

type Sent = { to: string; subject: string; html: string };
const outbox = vi.hoisted(() => ({ email: [] as Sent[] }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: async (args: Sent) => {
    outbox.email.push({ to: args.to, subject: args.subject, html: args.html });
    return true;
  },
}));

const SECRET = "alert-jobs-test-cron-secret";
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
});

type Handler = (req: Request) => Promise<Response>;
async function runCron(GET: Handler, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await GET(new Request(`https://sollos3.com${path}`, { headers: { authorization: `Bearer ${SECRET}` } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const HOUR = 3_600_000;
const TZ = "America/Regina";
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const local = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { ...opts, timeZone: TZ });

type Company = { org: string; owner: Member; manager: Member; anna: Member; bea: Member; gone: Member };

async function company(settings: Record<string, { enabled: boolean }>): Promise<Company> {
  const org = await addOrg(api.sql, "Alert Co");
  await api.sql(
    "update public.organizations set timezone = $2, automations_enabled = true, automation_settings = $3::jsonb where id = $1",
    [org, TZ, JSON.stringify(settings)],
  );
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    manager: await addMember(api.sql, org, "manager", "Office"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    bea: await addMember(api.sql, org, "employee", "Bea"),
    gone: await addMember(api.sql, org, "employee", "Olga", "disabled"),
  };
}

async function visit(
  org: string,
  clientName: string,
  at: string,
  opts: { crew?: Member[]; lead?: Member | null; status?: string } = {},
): Promise<string> {
  const client = await addClient(api.sql, org, clientName);
  const [b] = await api.sql<{ id: string }>(
    `insert into public.bookings
       (organization_id, client_id, scheduled_at, duration_minutes, service_type, service_type_label, address, status, assigned_to)
     values ($1, $2, $3::timestamptz, 120, 'standard', 'Deep clean', '12 Elm Street', $4::public.booking_status, $5) returning id`,
    [org, client, at, opts.status ?? "confirmed", opts.lead?.membershipId ?? null],
  );
  for (const m of opts.crew ?? []) {
    await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id) values ($1, $2, $3)", [
      org,
      b.id,
      m.membershipId,
    ]);
  }
  return b.id;
}

/** These jobs scan every company: keep the other tests' visits out of the count. */
async function onlyVisitsOf(...orgs: string[]): Promise<void> {
  await api.sql(
    "update public.bookings set status = 'cancelled' where not (organization_id = any($1::uuid[])) and scheduled_at > now() and status in ('pending', 'confirmed')",
    [orgs],
  );
}

const emailOf = async (m: Member) =>
  (await api.sql<{ email: string }>("select email from auth.users where id = $1", [m.userId]))[0].email;

const alertsFor = (org: string, type: string) =>
  api.sql<{ recipient_membership_id: string; title: string; body: string; href: string }>(
    "select recipient_membership_id, title, body, href from public.notifications where organization_id = $1 and type::text = $2 order by created_at",
    [org, type],
  );

/** One company with the five kinds of visit these alerts tell apart. */
async function fiveVisits(c: Company) {
  return {
    empty: await visit(c.org, "Hilda Daubner", inHours(5)),
    crewOnly: await visit(c.org, "Ken Hicks", inHours(6), { crew: [c.anna] }),
    leftTeam: await visit(c.org, "Nancy Ellestad", inHours(7), { lead: c.gone, crew: [c.gone] }),
    tooFar: await visit(c.org, "Lori Moeller", inHours(30)),
    cancelled: await visit(c.org, "Emma Drebit", inHours(8), { status: "cancelled" }),
  };
}

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("unassigned-bookings: the owner's 4 PM email about tomorrow's empty visits", { timeout: 120_000 }, () => {
  it("names the visits nobody active is coming to, once, in the company's own time", async () => {
    const { GET } = await import("@/app/api/cron/unassigned-bookings/route");
    const c = await company({ unassigned_booking_alert: { enabled: true } });
    const v = await fiveVisits(c);
    const off = await company({ unassigned_booking_alert: { enabled: false } });
    await visit(off.org, "Patricia Poohkay", inHours(5));
    await onlyVisitsOf(c.org, off.org);

    const run = await runCron(GET, "/api/cron/unassigned-bookings");
    expect(run, api.log()).toEqual({ status: 200, body: { orgsAlerted: 1, bookingsFlagged: 2 } });

    // To the owner only (owners and admins; the manager is told in the app).
    expect(outbox.email.map((e) => e.to)).toEqual([await emailOf(c.owner)]);
    const [mail] = outbox.email;
    expect(mail.html).toContain("Hilda Daubner");
    expect(mail.html).toContain("Nancy Ellestad");
    for (const quiet of ["Ken Hicks", "Lori Moeller", "Emma Drebit", "Patricia Poohkay"]) expect(mail.html).not.toContain(quiet);
    const at = (await api.sql<{ t: string }>("select scheduled_at::text as t from public.bookings where id = $1", [v.empty]))[0].t;
    expect(mail.html).toContain(local(new Date(at).toISOString(), { hour: "numeric", minute: "2-digit" }));

    // Tomorrow afternoon it does not say it again.
    outbox.email.length = 0;
    expect((await runCron(GET, "/api/cron/unassigned-bookings")).body).toEqual({ orgsAlerted: 0, bookingsFlagged: 0 });
    expect(outbox.email).toHaveLength(0);
  });
});

describe.skipIf(!hasPostgrest)("unfilled-shifts: the in-app alert to whoever staffs shifts", { timeout: 120_000 }, () => {
  it("alerts the owner and the manager about the same visits, in local time, once", async () => {
    const { GET } = await import("@/app/api/cron/unfilled-shifts/route");
    const c = await company({ unassigned_booking_alert: { enabled: true } });
    const v = await fiveVisits(c);
    const off = await company({ unassigned_booking_alert: { enabled: false } });
    await visit(off.org, "Patricia Poohkay", inHours(5));
    await onlyVisitsOf(c.org, off.org);

    const run = await runCron(GET, "/api/cron/unfilled-shifts");
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body.created).toBe(2);

    const alerts = await alertsFor(c.org, "unfilled_shift");
    expect(alerts.map((a) => a.href).sort()).toEqual(
      [`/app/bookings/${v.empty}`, `/app/bookings/${v.empty}`, `/app/bookings/${v.leftTeam}`, `/app/bookings/${v.leftTeam}`].sort(),
    );
    expect(new Set(alerts.map((a) => a.recipient_membership_id))).toEqual(new Set([c.owner.membershipId, c.manager.membershipId]));
    const hilda = alerts.find((a) => a.body.includes("Hilda Daubner"))!;
    const at = (await api.sql<{ t: string }>("select scheduled_at::text as t from public.bookings where id = $1", [v.empty]))[0].t;
    expect(hilda.body).toContain(local(new Date(at).toISOString(), { hour: "numeric", minute: "2-digit" }));
    expect(await alertsFor(off.org, "unfilled_shift")).toHaveLength(0);

    expect((await runCron(GET, "/api/cron/unfilled-shifts")).body.created ?? 0).toBe(0);
    expect(await alertsFor(c.org, "unfilled_shift")).toHaveLength(4);
  });
});

describe.skipIf(!hasPostgrest)("weekly-ops-digest: the owner's Monday count of visits with nobody on them", { timeout: 120_000 }, () => {
  it("counts the visit whose only cleaner left, not the ones somebody active is on", async () => {
    const { GET } = await import("@/app/api/cron/weekly-ops-digest/route");
    const c = await company({ weekly_ops_digest: { enabled: true } });
    await visit(c.org, "Hilda Daubner", inHours(30));
    await visit(c.org, "Nancy Ellestad", inHours(50), { lead: c.gone, crew: [c.gone] });
    await visit(c.org, "Ken Hicks", inHours(70), { crew: [c.anna] });
    await visit(c.org, "Lori Moeller", inHours(90), { lead: c.bea, crew: [c.bea] });
    // Someone deactivated is named first, but someone active is on it too.
    await visit(c.org, "Emma Drebit", inHours(110), { lead: c.gone, crew: [c.gone, c.anna] });

    const run = await runCron(GET, "/api/cron/weekly-ops-digest");
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    const owner = await emailOf(c.owner);
    const digest = outbox.email.find((e) => e.to === owner);
    expect(digest, api.log()).toBeDefined();
    expect(digest!.html).toMatch(/<strong>2<\/strong> upcoming bookings still have no cleaner assigned/);
  });
});

describe.skipIf(!hasPostgrest)("upcoming-jobs: 'Job starting soon' to the crew", { timeout: 120_000 }, () => {
  it("tells everyone on a visit in the next hour, with its local time and address, once; not where it is off", async () => {
    const { GET } = await import("@/app/api/cron/upcoming-jobs/route");
    const c = await company({ job_starting_soon_push: { enabled: true } });
    const soonAt = inHours(0.6);
    const soon = await visit(c.org, "Margaret Ann MacLeod", soonAt, { crew: [c.anna, c.bea] });
    await visit(c.org, "Patricia Poohkay", inHours(3), { crew: [c.anna] });
    const off = await company({ job_starting_soon_push: { enabled: false } });
    await visit(off.org, "Hilda Daubner", inHours(0.5), { crew: [off.anna] });
    await onlyVisitsOf(c.org, off.org);

    const run = await runCron(GET, "/api/cron/upcoming-jobs");
    expect(run, api.log()).toEqual({ status: 200, body: { created: 2 } });

    const told = await api.sql<{ recipient_membership_id: string; title: string; body: string; href: string }>(
      "select recipient_membership_id, title, body, href from public.notifications where organization_id = $1 and title = 'Job starting soon'",
      [c.org],
    );
    expect(told.map((t) => t.recipient_membership_id).sort()).toEqual([c.anna.membershipId, c.bea.membershipId].sort());
    for (const t of told) {
      expect(t.href).toBe(`/field/jobs/${soon}`);
      expect(t.body).toBe(
        `Deep clean for ${(await api.sql<{ name: string }>("select c.name from public.bookings b join public.clients c on c.id = b.client_id where b.id = $1", [soon]))[0].name} at ${local(soonAt, { hour: "numeric", minute: "2-digit" })} — 12 Elm Street`,
      );
    }
    expect(
      await api.sql("select 1 from public.notifications where organization_id = $1 and title = 'Job starting soon'", [off.org]),
    ).toHaveLength(0);

    // The next hourly run does not repeat it.
    await runCron(GET, "/api/cron/upcoming-jobs");
    expect(
      await api.sql("select 1 from public.notifications where organization_id = $1 and title = 'Job starting soon'", [c.org]),
    ).toHaveLength(2);
  });
});

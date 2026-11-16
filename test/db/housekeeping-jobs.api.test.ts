/**
 * Two scheduled jobs that act on a company's people and records without
 * anyone pressing a button, run through their real routes against a real
 * database behind the real PostgREST. Only the outbound email is caught.
 *
 *   overtime-warnings (Friday 15:00 UTC): tells an employee who is near or
 *     past the company's weekly overtime line. Never a subcontractor: from
 *     the company to someone it calls self-employed, that email is evidence
 *     of control. Never someone deactivated.
 *   archive-records (4:30 UTC): files away finished visits and settled
 *     invoices older than the company's archive age (Svit has it on). It must
 *     never file away anything still live.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const SECRET = "housekeeping-test-cron-secret";
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
afterEach(() => {
  vi.useRealTimers();
});

type Handler = (req: Request) => Promise<Response>;
async function runCron(GET: Handler, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await GET(new Request(`https://sollos3.com${path}`, { headers: { authorization: `Bearer ${SECRET}` } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const emailOf = async (m: Member) =>
  (await api.sql<{ email: string }>("select email from auth.users where id = $1", [m.userId]))[0].email;

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("overtime-warnings: Friday's note to employees near the line", { timeout: 120_000 }, () => {
  it("warns the employee near it and the one past it; not the one under, a subcontractor, or someone deactivated", async () => {
    const { GET } = await import("@/app/api/cron/overtime-warnings/route");
    // The real run's moment: Friday 2026-11-13 at 15:00 UTC. Only the clock
    // the app reads is moved; the database keeps its own.
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));

    const org = await addOrg(api.sql, "Overtime Co");
    await api.sql(
      `update public.organizations set automations_enabled = true, overtime_threshold_hours = 20,
              automation_settings = '{"overtime_warning":{"enabled":true}}'::jsonb where id = $1`,
      [org],
    );
    const near = await addMember(api.sql, org, "employee", "Anna");
    const over = await addMember(api.sql, org, "employee", "Bea");
    const under = await addMember(api.sql, org, "employee", "Cleo");
    const sub = await addMember(api.sql, org, "employee", "Dana");
    await api.sql("update public.memberships set engagement = 'subcontractor' where id = $1", [sub.membershipId]);
    const gone = await addMember(api.sql, org, "employee", "Olga", "disabled");
    const off = await addOrg(api.sql, "Overtime Off Co");
    await api.sql(
      `update public.organizations set automations_enabled = true, overtime_threshold_hours = 20,
              automation_settings = '{"overtime_warning":{"enabled":false}}'::jsonb where id = $1`,
      [off],
    );
    const elsewhere = await addMember(api.sql, off, "employee", "Eve");

    /** `hours` of finished shifts this week (Mon Nov 9 to Thu Nov 12), in 6-hour pieces. */
    async function worked(o: string, m: Member, hours: number) {
      for (let day = 0, left = hours; left > 0; day++, left -= 6) {
        const start = Date.parse("2026-11-09T15:00:00Z") + day * DAY;
        await api.sql(
          "insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at) values ($1, $2, $3, $4)",
          [o, m.membershipId, new Date(start).toISOString(), new Date(start + Math.min(6, left) * HOUR).toISOString()],
        );
      }
    }
    await worked(org, near, 17); // 85% of 20
    await worked(org, over, 22);
    await worked(org, under, 12);
    await worked(org, sub, 24);
    await worked(org, gone, 24);
    await worked(off, elsewhere, 24);
    // Last week's hours are last week's.
    await api.sql(
      "insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at) values ($1, $2, $3, $4)",
      [org, under.membershipId, "2026-11-05T15:00:00Z", "2026-11-05T23:00:00Z"],
    );

    const run = await runCron(GET, "/api/cron/overtime-warnings");
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    const nearEmail = await emailOf(near);
    const overEmail = await emailOf(over);
    expect(outbox.email.map((e) => e.to).sort(), api.log()).toEqual([nearEmail, overEmail].sort());
    const nearMail = outbox.email.find((e) => e.to === nearEmail)!;
    const overMail = outbox.email.find((e) => e.to === overEmail)!;
    expect(nearMail.html).toContain("17.0");
    expect(overMail.html).toContain("22.0");
    expect(nearMail.subject).not.toBe(overMail.subject);
    expect(run.body).toEqual({ emailsSent: 2 });
  });
});

describe.skipIf(!hasPostgrest)("archive-records: files away what is finished and old", { timeout: 120_000 }, () => {
  it("archives finished visits and settled invoices past the company's age, and never anything live", async () => {
    const { GET } = await import("@/app/api/cron/archive-records/route");
    const org = await addOrg(api.sql, "Archive Co");
    await api.sql(
      `update public.organizations set automations_enabled = true, archive_after_days = 365,
              automation_settings = '{"auto_archive_old_records":{"enabled":true}}'::jsonb where id = $1`,
      [org],
    );
    const client = await addClient(api.sql, org, "Hilda Daubner");
    const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
    async function visit(o: string, c: string, daysAgo: number, status: string): Promise<string> {
      const [b] = await api.sql<{ id: string }>(
        `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status)
         values ($1, $2, $3::timestamptz, 120, 'standard', $4::public.booking_status) returning id`,
        [o, c, ago(daysAgo), status],
      );
      return b.id;
    }
    async function invoice(o: string, c: string, daysAgo: number, status: string): Promise<string> {
      const [i] = await api.sql<{ id: string }>(
        `insert into public.invoices (organization_id, client_id, status, amount_cents, created_at, voided_at)
         values ($1, $2, $3::public.invoice_status, 10000, $4::timestamptz, case when $3 = 'void' then now() end) returning id`,
        [o, c, status, ago(daysAgo)],
      );
      return i.id;
    }
    const oldDone = await visit(org, client, 400, "completed");
    const oldCancelled = await visit(org, client, 400, "cancelled");
    const recentDone = await visit(org, client, 300, "completed");
    const oldStillOpen = await visit(org, client, 400, "confirmed");
    const oldVoid = await invoice(org, client, 400, "void");
    const oldUnpaid = await invoice(org, client, 400, "sent");
    const recentVoid = await invoice(org, client, 300, "void");

    // A company that switched it off, and one that left the age blank.
    const off = await addOrg(api.sql, "Archive Off Co");
    await api.sql(
      `update public.organizations set automations_enabled = true, archive_after_days = 365,
              automation_settings = '{"auto_archive_old_records":{"enabled":false}}'::jsonb where id = $1`,
      [off],
    );
    const offVisit = await visit(off, await addClient(api.sql, off), 400, "completed");
    const blank = await addOrg(api.sql, "Archive Blank Co");
    await api.sql(
      `update public.organizations set automations_enabled = true, archive_after_days = null,
              automation_settings = '{"auto_archive_old_records":{"enabled":true}}'::jsonb where id = $1`,
      [blank],
    );
    const blankVisit = await visit(blank, await addClient(api.sql, blank), 900, "completed");

    const run = await runCron(GET, "/api/cron/archive-records");
    expect(run.status, JSON.stringify(run.body)).toBe(200);

    const archived = async (table: "bookings" | "invoices", id: string) =>
      (await api.sql<{ a: boolean }>(`select archived_at is not null as a from public.${table} where id = $1`, [id]))[0].a;
    expect(await archived("bookings", oldDone)).toBe(true);
    expect(await archived("bookings", oldCancelled)).toBe(true);
    expect(await archived("invoices", oldVoid)).toBe(true);
    for (const id of [recentDone, oldStillOpen, offVisit, blankVisit]) expect(await archived("bookings", id)).toBe(false);
    for (const id of [oldUnpaid, recentVoid]) expect(await archived("invoices", id)).toBe(false);
  });
});

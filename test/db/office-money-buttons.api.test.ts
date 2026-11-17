/**
 * Office buttons that move or remove money and records, run as the person
 * who presses them against a real database behind the real PostgREST.
 * Svit's use, 90 days to 2026-11-16:
 *
 *   prepayment            14 recorded (money paid before a job is invoiced)
 *   delete a pay period   7
 *   delete a client       4
 *   delete a feed post    on 6 posts
 *
 * What each owes: money paid ahead lands on the job's invoice and is never
 * counted twice; a pay period that is paid can't be deleted (its hours would
 * be paid again); a client with history can't be deleted, and says why; a
 * delete the database refuses is never reported as done.
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
  sendEmail: async () => true,
  sendOrgEmail: async () => true,
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
});

async function as<T>(who: Member, press: () => Promise<T>): Promise<T | { redirected: string }> {
  request.cookies = api.sessionCookies(who.userId);
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

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ymd = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

type Company = { org: string; client: string; owner: Member; manager: Member; anna: Member };
async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Money Co");
  await api.sql(
    "update public.organizations set timezone = 'America/Regina', automations_enabled = true, automation_settings = '{\"auto_invoice_on_job_complete\":{\"enabled\":true}}'::jsonb where id = $1",
    [org],
  );
  return {
    org,
    client: await addClient(api.sql, org, "Hilda Daubner"),
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    manager: await addMember(api.sql, org, "manager", "Office"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
}

async function job(c: Company, hoursFromNow: number, status = "confirmed", cents = 20000): Promise<string> {
  const [b] = await api.sql<{ id: string }>(
    `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, total_cents)
     values ($1, $2, $3::timestamptz, 120, 'standard', $4::public.booking_status, $5) returning id`,
    [c.org, c.client, new Date(Date.now() + hoursFromNow * HOUR).toISOString(), status, cents],
  );
  return b.id;
}

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("prepayment: money paid before the job is invoiced", { timeout: 120_000 }, () => {
  const payment = (dollars: string) => {
    const f = new FormData();
    f.set("amount_dollars", dollars);
    f.set("method", "cash");
    f.set("reference", "");
    f.set("received_at", ymd(0));
    f.set("notes", "Deposit");
    return f;
  };

  it("waits on the job, lands on its invoice when the job is billed, and is counted once", async () => {
    const { recordBookingPrepaymentAction } = await import("@/app/app/bookings/prepayment-actions");
    const { markBookingCompleteAction } = await import("@/app/app/bookings/actions");
    const c = await company();
    const visit = await job(c, -3);

    expect(await as(c.owner, () => recordBookingPrepaymentAction(visit, {}, payment("50.00"))), api.log()).toEqual({ ok: true, appliedTo: null });
    const [waiting] = await api.sql<{ amount_cents: number; applied: boolean }>(
      "select amount_cents, applied_at is not null as applied from public.booking_prepayments where booking_id = $1",
      [visit],
    );
    expect(waiting).toEqual({ amount_cents: 5000, applied: false });

    // The job is finished and billed: the deposit becomes a payment on the invoice.
    await as(c.owner, () => markBookingCompleteAction(visit));
    const [inv] = await api.sql<{ id: string; status: string; paid: number }>(
      `select i.id, i.status::text as status,
              (select coalesce(sum(p.amount_cents), 0)::int from public.invoice_payments p where p.invoice_id = i.id) as paid
         from public.invoices i where i.booking_id = $1`,
      [visit],
    );
    expect(inv).toMatchObject({ status: "partially_paid", paid: 5000 });
    expect((await api.sql<{ applied: boolean }>("select applied_at is not null as applied from public.booking_prepayments where booking_id = $1", [visit]))[0].applied).toBe(true);

    // On a job already invoiced it goes straight on; more than is owed is refused.
    const more = await as(c.owner, () => recordBookingPrepaymentAction(visit, {}, payment("100.00")));
    expect(more).toEqual({ ok: true, appliedTo: inv.id });
    const tooMuch = (await as(c.owner, () => recordBookingPrepaymentAction(visit, {}, payment("100.00")))) as { errors?: Record<string, string> };
    expect(tooMuch.errors?._form).toBeTruthy();
    const [paidNow] = await api.sql<{ paid: number }>(
      "select coalesce(sum(amount_cents), 0)::int as paid from public.invoice_payments where invoice_id = $1",
      [inv.id],
    );
    expect(paidNow.paid).toBe(15000);
  });

  it("removes one recorded by mistake only while it waits; managers and cancelled jobs are refused", async () => {
    const { recordBookingPrepaymentAction, removeBookingPrepaymentAction } = await import("@/app/app/bookings/prepayment-actions");
    const c = await company();
    const visit = await job(c, 48);
    await as(c.owner, () => recordBookingPrepaymentAction(visit, {}, payment("40.00")));
    const [pp] = await api.sql<{ id: string }>("select id from public.booking_prepayments where booking_id = $1", [visit]);

    const byManager = (await as(c.manager, () => recordBookingPrepaymentAction(visit, {}, payment("10.00")))) as { errors?: Record<string, string> };
    expect(byManager.errors?._form).toBe("Only owners and admins can record payments.");
    const cancelled = await job(c, 72, "cancelled");
    const onCancelled = (await as(c.owner, () => recordBookingPrepaymentAction(cancelled, {}, payment("10.00")))) as { errors?: Record<string, string> };
    expect(onCancelled.errors?._form).toContain("This job is cancelled");

    const f = new FormData();
    f.set("id", pp.id);
    f.set("booking_id", visit);
    await as(c.owner, () => removeBookingPrepaymentAction(f));
    expect(await api.sql("select 1 from public.booking_prepayments where id = $1", [pp.id])).toHaveLength(0);
  });
});

describe.skipIf(!hasPostgrest)("delete a pay period", { timeout: 120_000 }, () => {
  async function run(c: Company, status: string): Promise<{ run: string; shift: string }> {
    const [r] = await api.sql<{ id: string }>(
      `insert into public.payroll_runs (organization_id, period_start, period_end, status, total_cents, created_by)
       values ($1, current_date - 14, current_date, $2, 6600, $3) returning id`,
      [c.org, status, c.owner.membershipId],
    );
    const [s] = await api.sql<{ id: string }>(
      `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at, payroll_run_id)
       values ($1, $2, now() - interval '5 days', now() - interval '5 days' + interval '4 hours', $3) returning id`,
      [c.org, c.anna.membershipId, r.id],
    );
    return { run: r.id, shift: s.id };
  }
  const form = (id: string, confirm = "") => {
    const f = new FormData();
    f.set("id", id);
    f.set("confirm", confirm);
    return f;
  };
  const exists = async (id: string) => (await api.sql("select 1 from public.payroll_runs where id = $1", [id])).length === 1;
  const shiftRun = async (id: string) =>
    (await api.sql<{ r: string | null }>("select payroll_run_id as r from public.time_entries where id = $1", [id]))[0].r;

  it("a draft goes and its hours are free to pay again; a finalized one needs DELETE typed; a paid one never goes", async () => {
    const { deletePayrollRunAction } = await import("@/app/app/payroll/actions");
    const c = await company();
    const draft = await run(c, "draft");
    const finalized = await run(c, "finalized");
    const paid = await run(c, "paid");

    expect(await as(c.owner, () => deletePayrollRunAction(form(draft.run))), api.log()).toEqual({ redirected: "/app/payroll" });
    expect(await exists(draft.run)).toBe(false);
    expect(await shiftRun(draft.shift)).toBeNull();

    await as(c.owner, () => deletePayrollRunAction(form(finalized.run, "delete")));
    expect(await exists(finalized.run)).toBe(true);
    expect(await as(c.owner, () => deletePayrollRunAction(form(finalized.run, "DELETE")))).toEqual({ redirected: "/app/payroll" });
    expect(await exists(finalized.run)).toBe(false);

    await as(c.owner, () => deletePayrollRunAction(form(paid.run, "DELETE")));
    expect(await exists(paid.run)).toBe(true);
    expect(await shiftRun(paid.shift)).toBe(paid.run);

    const other = await run(c, "draft");
    await as(c.manager, () => deletePayrollRunAction(form(other.run)));
    expect(await exists(other.run)).toBe(true);
  });
});

describe.skipIf(!hasPostgrest)("delete a client", { timeout: 120_000 }, () => {
  it("one with history is refused in words on her page; a junk entry goes, with everything kept in the audit log", async () => {
    const { deleteClientAction } = await import("@/app/app/clients/actions");
    const c = await company();
    await job(c, -50, "completed");
    const junk = await addClient(api.sql, c.org, "Test Test");
    await api.sql("update public.clients set email = 'test@example.test', phone = '+15875550000' where id = $1", [junk]);
    const form = (id: string) => {
      const f = new FormData();
      f.set("id", id);
      return f;
    };

    const refused = (await as(c.owner, () => deleteClientAction(form(c.client)))) as { redirected: string };
    expect(refused.redirected.startsWith(`/app/clients/${c.client}/edit?delete_error=`)).toBe(true);
    expect(decodeURIComponent(refused.redirected)).toContain("1 booking");
    expect(await api.sql("select 1 from public.clients where id = $1", [c.client])).toHaveLength(1);

    expect(await as(c.owner, () => deleteClientAction(form(junk)))).toEqual({ redirected: "/app/clients" });
    expect(await api.sql("select 1 from public.clients where id = $1", [junk])).toHaveLength(0);
    const [audit] = await api.sql<{ phone: string; email: string }>(
      "select before->>'phone' as phone, before->>'email' as email from public.audit_log where entity = 'client' and action = 'delete' and entity_id = $1",
      [junk],
    );
    expect(audit).toEqual({ phone: "+15875550000", email: "test@example.test" });
  });
});

describe.skipIf(!hasPostgrest)("delete a feed post", { timeout: 120_000 }, () => {
  it("a cleaner can't delete the office's post, and its picture stays; the office can, and the picture goes with it", async () => {
    const { deleteFeedPostAction } = await import("@/lib/feed-actions");
    const c = await company();
    const key = `${c.org}/feed/holiday-party.jpg`;
    api.storage.set(`org-assets/${key}`, 1024);
    const [post] = await api.sql<{ id: string }>(
      "insert into public.feed_posts (organization_id, author_id, body, image_url) values ($1, $2, 'Holiday party Friday!', $3) returning id",
      [c.org, c.manager.membershipId, `${api.url}/storage/v1/object/public/org-assets/${key}`],
    );
    const form = () => {
      const f = new FormData();
      f.set("post_id", post.id);
      return f;
    };

    expect(await as(c.anna, () => deleteFeedPostAction(form()))).toEqual({
      ok: false,
      error: "Only the person who posted this, or a manager, can delete it.",
    });
    expect(await api.sql("select 1 from public.feed_posts where id = $1", [post.id])).toHaveLength(1);
    expect(api.storage.has(`org-assets/${key}`), "the picture is still there for the post").toBe(true);

    expect(await as(c.manager, () => deleteFeedPostAction(form()))).toMatchObject({ ok: true });
    expect(await api.sql("select 1 from public.feed_posts where id = $1", [post.id])).toHaveLength(0);
    expect(api.storage.has(`org-assets/${key}`)).toBe(false);
  });
});

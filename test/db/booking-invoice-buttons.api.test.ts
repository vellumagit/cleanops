/**
 * The office's booking and invoice buttons that no test had named, run as
 * the person who presses them against a real database behind the real
 * PostgREST. Only the framework (cookies, revalidatePath, redirect, after)
 * and outbound email are stood in for.
 *
 *   Mark complete               on a booking's page
 *   Generate invoice            on a finished booking's page
 *   This and all later visits   the status dropdown on a series visit
 *   Edit invoice                ten saves in the month to 2026-11-16
 *
 * A refusal has to come back in words. Two of these used to refuse in
 * silence: Mark complete on a visit that had not started, and the series
 * change past its 60th visit.
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
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

type Company = { org: string; client: string; owner: Member; anna: Member };
async function company(autoInvoice = true): Promise<Company> {
  const org = await addOrg(api.sql, "Office Co");
  await api.sql(
    "update public.organizations set timezone = 'America/Regina', automations_enabled = true, automation_settings = $2::jsonb where id = $1",
    [org, JSON.stringify({ auto_invoice_on_job_complete: { enabled: autoInvoice } })],
  );
  return {
    org,
    client: await addClient(api.sql, org, "Hilda Daubner"),
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
}

async function visit(c: Company, scheduledAt: string, opts: { status?: string; series?: string; cents?: number; crew?: Member } = {}) {
  const [b] = await api.sql<{ id: string }>(
    `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, total_cents, series_id, assigned_to)
     values ($1, $2, $3::timestamptz, 120, 'standard', $4::public.booking_status, $5, $6, $7) returning id`,
    [c.org, c.client, scheduledAt, opts.status ?? "confirmed", opts.cents ?? 15000, opts.series ?? null, opts.crew?.membershipId ?? null],
  );
  if (opts.crew) {
    await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id, acceptance_status) values ($1, $2, $3, 'accepted')", [
      c.org,
      b.id,
      opts.crew.membershipId,
    ]);
  }
  return b.id;
}

const statusOf = async (id: string) =>
  (await api.sql<{ s: string }>("select status::text as s from public.bookings where id = $1", [id]))[0].s;

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("Mark complete", { timeout: 120_000 }, () => {
  it("completes a visit under way and drafts its invoice; refuses one not yet started, and says why", async () => {
    const { markBookingCompleteAction } = await import("@/app/app/bookings/actions");
    const c = await company();
    const underWay = await visit(c, inHours(-3), { crew: c.anna });
    const nextWeek = await visit(c, inHours(7 * 24), { crew: c.anna });

    expect(await as(c.owner, () => markBookingCompleteAction(underWay)), api.log()).toEqual({ redirected: `/app/bookings/${underWay}` });
    expect(await statusOf(underWay)).toBe("completed");
    const drafts = await api.sql<{ amount_cents: number; status: string }>(
      "select amount_cents, status::text from public.invoices where booking_id = $1",
      [underWay],
    );
    expect(drafts).toEqual([{ amount_cents: 15000, status: "draft" }]);

    const early = (await as(c.owner, () => markBookingCompleteAction(nextWeek))) as { redirected: string };
    expect(early.redirected.startsWith(`/app/bookings/${nextWeek}?close_error=`)).toBe(true);
    expect(decodeURIComponent(early.redirected.split("close_error=")[1])).toContain("too far in the future to be marked completed");
    expect(await statusOf(nextWeek)).toBe("confirmed");
  });
});

describe.skipIf(!hasPostgrest)("Generate invoice from a finished booking", { timeout: 120_000 }, () => {
  it("makes one invoice for the job at its price; a second press opens the same one; a cleaner can't", async () => {
    const { generateInvoiceFromBookingAction } = await import("@/app/app/bookings/actions");
    const c = await company(false);
    const job = await visit(c, inHours(-30), { status: "completed", cents: 18500 });
    const form = () => {
      const f = new FormData();
      f.set("booking_id", job);
      return f;
    };

    const made = (await as(c.owner, () => generateInvoiceFromBookingAction({}, form()))) as { ok?: boolean; invoiceId?: string; error?: string };
    expect(made, api.log()).toMatchObject({ ok: true });
    const [inv] = await api.sql<{ id: string; amount_cents: number; stamped: boolean }>(
      `select i.id, i.amount_cents, b.billing_invoice_id = i.id as stamped
         from public.invoices i join public.bookings b on b.id = $1 where i.booking_id = $1`,
      [job],
    );
    expect(inv).toMatchObject({ id: made.invoiceId, amount_cents: 18500, stamped: true });

    // A second press hands back the invoice already there; it never makes another.
    const again = (await as(c.owner, () => generateInvoiceFromBookingAction({}, form()))) as { ok?: boolean; invoiceId?: string };
    expect(again).toMatchObject({ ok: true, invoiceId: made.invoiceId });
    expect(await api.sql("select 1 from public.invoices where booking_id = $1 and status <> 'void'", [job])).toHaveLength(1);

    const cleaner = (await as(c.anna, () => generateInvoiceFromBookingAction({}, form()))) as { error?: string };
    expect(cleaner.error).toBe("Only owners, admins, or managers can generate invoices.");
  });
});

describe.skipIf(!hasPostgrest)("This and all later visits (series status)", { timeout: 300_000 }, () => {
  it("changes up to 60 at once, leaves a visit cancelled on its own alone, and says how many later visits it did not reach", async () => {
    const { setSeriesStatusAction } = await import("@/app/app/bookings/actions");
    const c = await company(false);
    const [s] = await api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, generate_ahead, duration_minutes, service_type, total_cents, active)
       values ($1, $2, 'weekly', '10:00', current_date, 4, 120, 'standard', 15000, true) returning id`,
      [c.org, c.client],
    );
    // 65 weekly visits, all pending; the tenth was cancelled, which can't become confirmed.
    const ids: string[] = [];
    for (let w = 0; w < 65; w++) ids.push(await visit(c, inHours(48 + w * 7 * 24), { status: w === 9 ? "cancelled" : "pending", series: s.id }));

    const f = new FormData();
    f.set("id", ids[0]);
    f.set("status", "confirmed");
    const res = (await as(c.owner, () => setSeriesStatusAction(f))) as {
      ok: boolean;
      changed: number;
      skipped: Array<{ scheduled_at: string; reason: string }>;
      notReached: number;
      nextFrom: string | null;
    };
    expect(res.ok, api.log()).toBe(true);
    // The cancelled tenth stays cancelled: a series change never brings back
    // a visit cancelled on its own (a client's skipped week).
    expect(res.changed).toBe(59);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0].reason).toContain("cancelled on its own");
    expect(res.notReached).toBe(5);
    const [sixtyFirst] = await api.sql<{ t: string }>("select scheduled_at::text as t from public.bookings where id = $1", [ids[60]]);
    expect(new Date(res.nextFrom!).toISOString()).toBe(new Date(sixtyFirst.t).toISOString());
    expect((res as { nextFromLabel?: string }).nextFromLabel).toBe(
      new Date(sixtyFirst.t).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Regina" }),
    );
    expect(await statusOf(ids[59])).toBe("confirmed");
    expect(await statusOf(ids[60])).toBe("pending");
    expect(await statusOf(ids[9])).toBe("cancelled");
  });
});

describe.skipIf(!hasPostgrest)("Edit invoice", { timeout: 120_000 }, () => {
  type Line = { db_id: string | null; booking_id: string | null; label: string; quantity: string; unit_price_dollars: string };
  function invoiceForm(c: Company, lines: Line[], status = "draft"): FormData {
    const f = new FormData();
    f.set("client_id", c.client);
    f.set("booking_id", "");
    f.set("status", status);
    f.set("subtotal_cents", "0");
    f.set("due_date", "");
    f.set("tax_rate_bps", "");
    f.set("tax_label", "");
    f.set("totals_managed_elsewhere", "1");
    f.set("line_items_json", JSON.stringify(lines.map((l, i) => ({ ...l, sort_order: i }))));
    f.set("items_tax_rate_percent", "");
    f.set("items_tax_label", "");
    return f;
  }
  async function invoiceWithJobs(c: Company, jobs: string[], status = "draft"): Promise<{ id: string; lineIds: string[] }> {
    const [inv] = await api.sql<{ id: string }>(
      "insert into public.invoices (organization_id, client_id, status, amount_cents) values ($1, $2, $3::public.invoice_status, $4) returning id",
      [c.org, c.client, status, 15000 * jobs.length],
    );
    const lineIds: string[] = [];
    for (const [i, job] of jobs.entries()) {
      const [l] = await api.sql<{ id: string }>(
        `insert into public.invoice_line_items (organization_id, invoice_id, label, quantity, unit_price_cents, booking_id, sort_order)
         values ($1, $2, $3, 1, 15000, $4, $5) returning id`,
        [c.org, inv.id, `Clean ${i + 1}`, job, i],
      );
      lineIds.push(l.id);
      await api.sql("update public.bookings set billing_invoice_id = $2 where id = $1", [job, inv.id]);
    }
    return { id: inv.id, lineIds };
  }

  it("re-prices a line, takes a job off and frees it to be billed again, and lands back on the invoice", async () => {
    const { updateInvoiceAction } = await import("@/app/app/invoices/actions");
    const c = await company(false);
    const kept = await visit(c, inHours(-50), { status: "completed" });
    const takenOff = await visit(c, inHours(-26), { status: "completed" });
    const inv = await invoiceWithJobs(c, [kept, takenOff]);

    const res = await as(c.owner, () =>
      updateInvoiceAction(
        inv.id,
        {},
        invoiceForm(c, [{ db_id: inv.lineIds[0], booking_id: kept, label: "Clean 1", quantity: "1", unit_price_dollars: "175.00" }]),
      ),
    );
    expect(res, api.log()).toEqual({ redirected: `/app/invoices/${inv.id}` });
    const [row] = await api.sql<{ amount_cents: number; lines: number }>(
      "select amount_cents, (select count(*)::int from public.invoice_line_items where invoice_id = $1) as lines from public.invoices where id = $1",
      [inv.id],
    );
    expect(row).toEqual({ amount_cents: 17500, lines: 1 });
    const stamp = async (id: string) =>
      (await api.sql<{ s: string | null }>("select billing_invoice_id as s from public.bookings where id = $1", [id]))[0].s;
    expect(await stamp(kept)).toBe(inv.id);
    expect(await stamp(takenOff)).toBeNull();
  });

  it("an edit never undoes money received: raising a paid invoice leaves it part-paid", async () => {
    const { updateInvoiceAction } = await import("@/app/app/invoices/actions");
    const c = await company(false);
    const job = await visit(c, inHours(-50), { status: "completed" });
    const inv = await invoiceWithJobs(c, [job], "sent");
    await api.sql("insert into public.invoice_payments (organization_id, invoice_id, amount_cents, method) values ($1, $2, 15000, 'cash')", [
      c.org,
      inv.id,
    ]);
    expect((await api.sql<{ s: string }>("select status::text as s from public.invoices where id = $1", [inv.id]))[0].s).toBe("paid");

    await as(c.owner, () =>
      updateInvoiceAction(
        inv.id,
        {},
        invoiceForm(c, [{ db_id: inv.lineIds[0], booking_id: job, label: "Clean 1", quantity: "1", unit_price_dollars: "200.00" }], "paid"),
      ),
    );
    const [row] = await api.sql<{ status: string; amount_cents: number; paid: boolean }>(
      "select status::text as status, amount_cents, paid_at is not null as paid from public.invoices where id = $1",
      [inv.id],
    );
    expect(row).toEqual({ status: "partially_paid", amount_cents: 20000, paid: false });
  });

  it("a void invoice is a closed record: the edit is refused in words and nothing changes", async () => {
    const { updateInvoiceAction } = await import("@/app/app/invoices/actions");
    const c = await company(false);
    const job = await visit(c, inHours(-50), { status: "completed" });
    const inv = await invoiceWithJobs(c, [job], "void");
    const res = (await as(c.owner, () =>
      updateInvoiceAction(
        inv.id,
        {},
        invoiceForm(c, [{ db_id: inv.lineIds[0], booking_id: job, label: "Clean 1", quantity: "1", unit_price_dollars: "1.00" }]),
      ),
    )) as { errors?: Record<string, string> };
    expect(res.errors?._form).toContain("This invoice is void");
    expect((await api.sql<{ a: number }>("select amount_cents as a from public.invoices where id = $1", [inv.id]))[0].a).toBe(15000);
  });
});

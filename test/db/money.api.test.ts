/**
 * The September sweep's Tier 1 money list, on a real database.
 *
 * Nine confirmed money bugs were listed on 2026-09-02. Re-checked against the
 * code on 2026-11-10: two had been fixed, one had been closed by the
 * fail-closed scope, five were still open and one waits on a decision
 * (docs/september-tier1-2026-11-10.md has the verdict for each). These are
 * the fixes for the open ones, run through the app's own functions against
 * the real stack (test/db/api.ts), because each is a rule about what the
 * database ends up saying about money.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addMember, addOrg, type Member } from "./harness";

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

const daysAgo = (d: number, hour = 15) => {
  const t = new Date(Date.now() - d * 86_400_000);
  t.setUTCHours(hour, 0, 0, 0);
  return t.toISOString();
};
const ymd = (iso: string) => iso.slice(0, 10);

async function company(): Promise<{ org: string; client: string; owner: Member }> {
  const org = await addOrg(api.sql, "Company");
  await api.sql("update public.organizations set timezone = 'UTC', automations_enabled = true where id = $1", [org]);
  return { org, client: await addClient(api.sql, org), owner: await addMember(api.sql, org, "owner", "Owner") };
}

async function shift(org: string, who: Member, startIso: string, minutes: number, snapshot: number | null = null) {
  const [row] = await api.sql<{ id: string }>(
    `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot)
     values ($1, $2, $3, $4, $5) returning id`,
    [org, who.membershipId, startIso, new Date(new Date(startIso).getTime() + minutes * 60_000).toISOString(), snapshot],
  );
  return row.id;
}

describe.skipIf(!hasPostgrest)("#2 a pay run does not pay unset rates at zero", { timeout: 90_000 }, () => {
  it("leaves out time that has no rate, leaves it unstamped, and says so on the run", async () => {
    const { createPayrollRunForOrg } = await import("@/lib/payroll-run-create");
    const c = await company();
    const anna = await addMember(api.sql, c.org, "employee", "Anna Paid");
    const svit = await addMember(api.sql, c.org, "employee", "No Rate Yet");
    await api.sql("update public.memberships set pay_rate_cents = 2000, display_name = 'Anna Paid' where id = $1", [
      anna.membershipId,
    ]);
    await api.sql("update public.memberships set display_name = 'No Rate Yet' where id = $1", [svit.membershipId]);
    const paid = await shift(c.org, anna, daysAgo(3), 120);
    const unpaid = await shift(c.org, svit, daysAgo(3), 120);

    const res = await createPayrollRunForOrg({
      organizationId: c.org,
      createdByMembershipId: c.owner.membershipId,
      periodStart: ymd(daysAgo(6)),
      periodEnd: ymd(daysAgo(1)),
    });
    expect(res, api.log()).toMatchObject({ ok: true, totalCents: 4000 });
    if (!res.ok) return;

    const items = await api.sql<{ employee_id: string; total_cents: number }>(
      "select employee_id, total_cents from public.payroll_items where payroll_run_id = $1",
      [res.id],
    );
    expect(items).toEqual([{ employee_id: anna.membershipId, total_cents: 4000 }]);

    const stamps = await api.sql<{ id: string; run: string | null }>(
      "select id, payroll_run_id as run from public.time_entries where id = any($1::uuid[])",
      [[paid, unpaid]],
    );
    expect(stamps.find((s) => s.id === paid)?.run).toBe(res.id);
    // Still payable: once she has a rate, the next run picks it up.
    expect(stamps.find((s) => s.id === unpaid)?.run).toBeNull();

    const [run] = await api.sql<{ notes: string | null }>("select notes from public.payroll_runs where id = $1", [
      res.id,
    ]);
    expect(run.notes).toContain("No Rate Yet (2h 00m)");
    expect(run.notes).toContain("no pay rate");
  });

  it("when nobody in the period has a rate, it refuses and stamps nothing", async () => {
    const { createPayrollRunForOrg } = await import("@/lib/payroll-run-create");
    const c = await company();
    const svit = await addMember(api.sql, c.org, "employee", "No Rate Yet");
    await api.sql("update public.memberships set display_name = 'No Rate Yet' where id = $1", [svit.membershipId]);
    const unpaid = await shift(c.org, svit, daysAgo(3), 90);

    const res = await createPayrollRunForOrg({
      organizationId: c.org,
      createdByMembershipId: c.owner.membershipId,
      periodStart: ymd(daysAgo(6)),
      periodEnd: ymd(daysAgo(1)),
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("No Rate Yet (1h 30m)");
    expect(await api.sql("select id from public.payroll_runs where organization_id = $1", [c.org])).toEqual([]);
    const [s] = await api.sql<{ run: string | null }>(
      "select payroll_run_id as run from public.time_entries where id = $1",
      [unpaid],
    );
    expect(s.run).toBeNull();
  });

  it("a rate frozen on the shift still pays it, whatever the person's rate is now", async () => {
    const { createPayrollRunForOrg } = await import("@/lib/payroll-run-create");
    const c = await company();
    const left = await addMember(api.sql, c.org, "employee", "Rate Cleared Since");
    await shift(c.org, left, daysAgo(3), 60, 2500);
    const res = await createPayrollRunForOrg({
      organizationId: c.org,
      createdByMembershipId: c.owner.membershipId,
      periodStart: ymd(daysAgo(6)),
      periodEnd: ymd(daysAgo(1)),
    });
    expect(res).toMatchObject({ ok: true, totalCents: 2500 });
  });
});

describe.skipIf(!hasPostgrest)("#3 #4 a job taken off an invoice stops being stamped as billed by it", { timeout: 90_000 }, () => {
  type Bill = { c: Awaited<ReturnType<typeof company>>; invoice: string; jobA: string; jobB: string; lineA: string; lineB: string };

  async function invoiceWithTwoJobs(status: "draft" | "sent"): Promise<Bill> {
    const c = await company();
    const jobA = await addBooking(api.sql, c.org, c.client, { scheduledAt: daysAgo(5), status: "completed" });
    const jobB = await addBooking(api.sql, c.org, c.client, { scheduledAt: daysAgo(4), status: "completed" });
    const [inv] = await api.sql<{ id: string }>(
      "insert into public.invoices (organization_id, client_id, status, amount_cents) values ($1, $2, $3::public.invoice_status, 28000) returning id",
      [c.org, c.client, status],
    );
    const line = async (job: string, label: string) =>
      (
        await api.sql<{ id: string }>(
          `insert into public.invoice_line_items (organization_id, invoice_id, label, quantity, unit_price_cents, booking_id)
           values ($1, $2, $3, 1, 14000, $4) returning id`,
          [c.org, inv.id, label, job],
        )
      )[0].id;
    const lineA = await line(jobA, "Visit A");
    const lineB = await line(jobB, "Visit B");
    await api.sql("update public.bookings set billing_invoice_id = $2 where id = any($1::uuid[])", [[jobA, jobB], inv.id]);
    return { c, invoice: inv.id, jobA, jobB, lineA, lineB };
  }

  /** Save the invoice's lines the way the edit form does, keeping only line A. */
  async function saveKeepingOnlyA(b: Bill, status: string) {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const { reconcileInvoiceLineItems } = await import("@/lib/invoice-line-items");
    const { releaseJobsRemovedFromInvoice } = await import("@/lib/billed-bookings");
    const supabase = createSupabaseAdminClient();
    const form = new FormData();
    form.set(
      "line_items_json",
      JSON.stringify([
        { db_id: b.lineA, label: "Visit A", quantity: "1", unit_price_dollars: "140.00", sort_order: 0, booking_id: b.jobA },
      ]),
    );
    const result = await reconcileInvoiceLineItems(
      supabase as never,
      { id: b.invoice, organization_id: b.c.org, tax_rate_bps: null, tax_label: null },
      form,
    );
    expect(result, api.log()).toMatchObject({ ok: true, itemCount: 1 });
    if (!result.ok) return;
    expect(result.removedJobIds).toEqual([b.jobB]);
    await releaseJobsRemovedFromInvoice(supabase as never, b.c.org, b.invoice, result.removedJobIds, status, new Date().toISOString());
  }

  const stampOf = async (job: string) =>
    (
      await api.sql<{ stamp: string | null; released: boolean }>(
        "select billing_invoice_id as stamp, billing_released_at is not null as released from public.bookings where id = $1",
        [job],
      )
    )[0];

  it("off a draft: the job is free again, and the one still on it keeps its stamp", async () => {
    const b = await invoiceWithTwoJobs("draft");
    await saveKeepingOnlyA(b, "draft");
    expect(await stampOf(b.jobB)).toEqual({ stamp: null, released: false });
    expect(await stampOf(b.jobA)).toEqual({ stamp: b.invoice, released: false });
  });

  it("off an invoice the client has: the job is released, so only a person bills it again", async () => {
    const b = await invoiceWithTwoJobs("sent");
    await saveKeepingOnlyA(b, "sent");
    expect(await stampOf(b.jobB)).toEqual({ stamp: null, released: true });
    expect(await stampOf(b.jobA)).toEqual({ stamp: b.invoice, released: false });
  });

  /**
   * Older invoices list their jobs as typed text with no link, and the stamp
   * is then the only record that the job is billed. Nothing may clear a stamp
   * just because no line points at the job.
   */
  it("never frees a job it was not asked about, or one the invoice still names", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const { releaseJobsRemovedFromInvoice } = await import("@/lib/billed-bookings");
    const supabase = createSupabaseAdminClient();
    const b = await invoiceWithTwoJobs("sent");
    const textOnly = await addBooking(api.sql, b.c.org, b.c.client, { scheduledAt: daysAgo(6), status: "completed" });
    await api.sql("update public.bookings set billing_invoice_id = $2 where id = $1", [textOnly, b.invoice]);

    await releaseJobsRemovedFromInvoice(supabase as never, b.c.org, b.invoice, [], "sent", new Date().toISOString());
    // Named by a line still: asking to free it changes nothing.
    await releaseJobsRemovedFromInvoice(supabase as never, b.c.org, b.invoice, [b.jobA], "sent", new Date().toISOString());
    expect(await stampOf(textOnly)).toEqual({ stamp: b.invoice, released: false });
    expect(await stampOf(b.jobA)).toEqual({ stamp: b.invoice, released: false });
  });

  it("leaves alone a job that a different invoice stamps", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const { releaseJobsRemovedFromInvoice } = await import("@/lib/billed-bookings");
    const supabase = createSupabaseAdminClient();
    const b = await invoiceWithTwoJobs("sent");
    const other = await invoiceWithTwoJobs("sent");
    await releaseJobsRemovedFromInvoice(supabase as never, b.c.org, b.invoice, [other.jobA], "sent", new Date().toISOString());
    expect(await stampOf(other.jobA)).toEqual({ stamp: other.invoice, released: false });
  });
});

describe.skipIf(!hasPostgrest)("#1 a Stripe payment is written to the ledger once", { timeout: 90_000 }, () => {
  it("records the payment, marks the invoice paid, and a second delivery adds nothing", async () => {
    const { recordStripeInvoicePayment } = await import("@/lib/stripe-invoice-payment");
    const c = await company();
    const [inv] = await api.sql<{ id: string }>(
      "insert into public.invoices (organization_id, client_id, status, amount_cents) values ($1, $2, 'sent', 14000) returning id",
      [c.org, c.client],
    );
    const args = { invoiceId: inv.id, amountCents: 14000, piId: "pi_test_money_1", feeCents: 436, expectedOrgId: c.org };
    await recordStripeInvoicePayment(args);
    // checkout.session.completed and payment_intent.succeeded both arrive for one payment.
    await recordStripeInvoicePayment(args);

    const payments = await api.sql<{ amount_cents: number; provider_payment_id: string }>(
      "select amount_cents, provider_payment_id from public.invoice_payments where invoice_id = $1",
      [inv.id],
    );
    expect(payments, api.log()).toEqual([{ amount_cents: 14000, provider_payment_id: "pi_test_money_1" }]);
    const [after] = await api.sql<{ status: string }>("select status::text from public.invoices where id = $1", [inv.id]);
    expect(after.status).toBe("paid");
  });
});

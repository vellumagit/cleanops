/**
 * Part-paid invoices are chased for the balance (money list #8, decided
 * 2026-11-11).
 *
 * A payment moves an invoice to `partially_paid`, and only `sent` invoices
 * ever become `overdue`, so a client who paid part of an invoice was never
 * reminded about the rest. sendOverdueReminders now takes part-paid invoices
 * that were sent and are past due, and names the balance, not the total.
 * Their status is left alone: auto-void writes off `overdue` invoices by age
 * without looking at payments.
 *
 * Runs the real cron function against the real stack (test/db/api.ts); only
 * the outbound email and text are caught instead of sent.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addOrg } from "./harness";

type Sent = { to: string; subject: string; html: string; text: string };
const outbox = vi.hoisted(() => ({ email: [] as Sent[], sms: [] as Array<{ to: string; body: string }> }));

vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendOrgEmail: async (_org: string, args: Sent) => {
    outbox.email.push({ to: args.to, subject: args.subject, html: args.html, text: args.text });
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

const ymd = (daysFromToday: number) => new Date(Date.now() + daysFromToday * 86_400_000).toISOString().slice(0, 10);
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

async function company(reminderOn = true): Promise<string> {
  const org = await addOrg(api.sql, "Company");
  await api.sql(
    `update public.organizations
        set timezone = 'UTC', currency_code = 'CAD', automations_enabled = true, automation_settings = $2::jsonb
      where id = $1`,
    [org, JSON.stringify({ invoice_overdue_reminder: { enabled: reminderOn } })],
  );
  return org;
}

let n = 0;
async function invoice(
  org: string,
  opts: { cents: number; due: string; sent?: boolean; paid?: number; refunded?: number; remindedAt?: string },
): Promise<{ id: string; email: string }> {
  const email = `client${++n}@example.test`;
  const client = await addClient(api.sql, org);
  await api.sql("update public.clients set email = $2 where id = $1", [client, email]);
  const sent = opts.sent ?? true;
  const [row] = await api.sql<{ id: string }>(
    `insert into public.invoices (organization_id, client_id, number, status, amount_cents, due_date, sent_at, overdue_reminder_sent_at)
     values ($1, $2, $3, $4::public.invoice_status, $5, $6, $7, $8) returning id`,
    [org, client, `INV-${n}`, sent ? "sent" : "draft", opts.cents, opts.due, sent ? ago(20) : null, opts.remindedAt ?? null],
  );
  if (opts.paid) {
    await api.sql(
      `insert into public.invoice_payments (organization_id, invoice_id, amount_cents, refunded_cents, method)
       values ($1, $2, $3, $4, 'cash')`,
      [org, row.id, opts.paid, opts.refunded ?? 0],
    );
  }
  return { id: row.id, email };
}

const status = async (id: string) =>
  (await api.sql<{ status: string; stamped: boolean }>(
    "select status::text as status, overdue_reminder_sent_at is not null as stamped from public.invoices where id = $1",
    [id],
  ))[0];

describe.skipIf(!hasPostgrest)("#8 part-paid invoices are reminded on the balance", { timeout: 90_000 }, () => {
  it("chases what is still owed, leaves the status part-paid, and skips the ones that should not be chased", async () => {
    const { sendOverdueReminders } = await import("@/lib/automations");
    const org = await company();
    const off = await company(false);

    const partPaid = await invoice(org, { cents: 40_000, due: ymd(-5), paid: 10_000 });
    const refundedSome = await invoice(org, { cents: 40_000, due: ymd(-5), paid: 30_000, refunded: 10_000 });
    const notYetDue = await invoice(org, { cents: 40_000, due: ymd(5), paid: 10_000 });
    const draftDeposit = await invoice(org, { cents: 40_000, due: ymd(-5), sent: false, paid: 10_000 });
    const remindedLately = await invoice(org, { cents: 40_000, due: ymd(-10), paid: 10_000, remindedAt: ago(2) });
    const remindedLongAgo = await invoice(org, { cents: 40_000, due: ymd(-20), paid: 10_000, remindedAt: ago(8) });
    const switchedOff = await invoice(off, { cents: 40_000, due: ymd(-5), paid: 10_000 });
    const voided = await invoice(org, { cents: 40_000, due: ymd(-5), paid: 10_000 });
    await api.sql("update public.invoices set voided_at = now() where id = $1", [voided.id]);
    const unpaid = await invoice(org, { cents: 25_000, due: ymd(-5) });

    // The payment trigger is what made them part-paid; the test relies on it.
    expect((await status(partPaid.id)).status).toBe("partially_paid");
    expect((await status(draftDeposit.id)).status).toBe("partially_paid");

    outbox.email.length = 0;
    await sendOverdueReminders();
    const to = (c: { email: string }) => outbox.email.filter((e) => e.to === c.email);

    // Part-paid: the balance, with the total and what was paid beside it.
    const [mail] = to(partPaid);
    expect(mail, api.log()).toBeDefined();
    expect(mail.subject).toContain("$300.00 still owing on invoice");
    expect(mail.text).toContain("Balance due: $300.00 ($100.00 of $400.00 paid)");
    expect(mail.html).toContain("Balance due");
    expect(await status(partPaid.id)).toEqual({ status: "partially_paid", stamped: true });

    // Refunds count against what was paid: $300 paid, $100 back, $200 owed.
    expect(to(refundedSome)[0]?.text).toContain("Balance due: $200.00 ($200.00 of $400.00 paid)");

    // A week since the last reminder is due again; two days is not.
    expect(to(remindedLongAgo)).toHaveLength(1);
    expect(to(remindedLately)).toHaveLength(0);

    // Not chased: not yet due, never sent, company switched it off, voided.
    for (const quiet of [notYetDue, draftDeposit, switchedOff, voided]) {
      expect(to(quiet)).toHaveLength(0);
      expect((await status(quiet.id)).stamped).toBe(false);
    }

    // Unpaid and past due is unchanged: flipped to overdue, chased for the total.
    const [plain] = to(unpaid);
    expect(plain.subject).toMatch(/is \d+ days overdue/);
    expect(plain.text).toContain("Amount: $250.00");
    expect(plain.text).not.toContain("paid)");
    expect((await status(unpaid.id)).status).toBe("overdue");

    // Running again the same day sends nothing new.
    const before = outbox.email.length;
    await sendOverdueReminders();
    expect(outbox.email.length).toBe(before);
  });

  it("counts part-paid past-due invoices as overdue for the owners' digest", async () => {
    const { owedPastDueFilter } = await import("@/lib/automations");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const org = await company();
    await invoice(org, { cents: 10_000, due: ymd(-3), paid: 1_000 }); // part-paid, past due
    await invoice(org, { cents: 10_000, due: ymd(3), paid: 1_000 }); // part-paid, not due
    await invoice(org, { cents: 10_000, due: ymd(-3) }); // sent, past due (not flipped here)
    await api.sql(
      "update public.invoices set status = 'overdue' where organization_id = $1 and status = 'sent'",
      [org],
    );
    await invoice(org, { cents: 10_000, due: ymd(-3), paid: 10_000 }); // paid

    const { count, error } = await createSupabaseAdminClient()
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .or(owedPastDueFilter(ymd(0)))
      .is("paid_at", null);
    expect(error, api.log()).toBeNull();
    expect(count).toBe(2);
  });
});

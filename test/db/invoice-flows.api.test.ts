/**
 * An invoice's life, through the app's own actions, against a real database
 * behind the real PostgREST (test/db/api.ts): made from a finished job,
 * sent, paid in part, a payment corrected and removed, voided, deleted.
 *
 * What each step owes the books: a job on a live invoice reads as billed
 * and cannot be billed again; voiding or deleting frees it in the right way;
 * the paid status follows the payments. Nothing is really emailed: the test
 * stack has no mail key, and the status is what is checked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));

// No email leaves the test: sending "succeeds" and records who it was for.
const sentEmails: Array<{ to: string }> = [];
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  isEmailConfigured: () => true,
  sendOrgEmailDetailed: async (_org: string, message: { to: string }) => {
    sentEmails.push({ to: message.to });
    return { ok: true, id: "test-message" };
  },
}));

let api: Api;
let restoreEnv: () => void;
let invoices: typeof import("@/app/app/invoices/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  invoices = await import("@/app/app/invoices/actions");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

type Company = { org: string; client: string; owner: Member };

async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Invoice Co");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  const client = await addClient(api.sql, org);
  await api.sql("update public.clients set email = $2 where id = $1", [client, `client-${client.slice(0, 8)}@example.test`]);
  return { org, client, owner: await addMember(api.sql, org, "owner", "Owner") };
}

const finishedJob = async (c: Company, daysAgo = 2) => {
  const id = await addBooking(api.sql, c.org, c.client, {
    scheduledAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    status: "completed",
  });
  await api.sql("update public.bookings set total_cents = 14000 where id = $1", [id]);
  return id;
};

/** Run an action as the owner; a redirect is an answer. */
async function asOwner<T>(c: Company, work: () => Promise<T>): Promise<T | string> {
  request.cookies = api.sessionCookies(c.owner.userId);
  try {
    return await work();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("redirected to ")) return message;
    throw err;
  } finally {
    await settle();
  }
}

function invoiceForm(c: Company, jobId: string | null, dollars = "140.00"): FormData {
  const form = new FormData();
  form.set("client_id", c.client);
  if (jobId) form.set("booking_id", jobId);
  form.set("status", "draft");
  // The form posts its own running total, in dollars, beside the lines.
  form.set("subtotal_cents", dollars);
  form.set("tax_rate_bps", "");
  form.set("tax_label", "");
  form.set("due_date", new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  form.set(
    "line_items_json",
    JSON.stringify([{ db_id: null, sort_order: 0, booking_id: jobId, label: "Standard clean", quantity: "1", unit_price_dollars: dollars }]),
  );
  form.set("items_tax_rate_percent", "");
  form.set("items_tax_label", "");
  return form;
}

const idForm = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const invoiceRow = async (id: string) =>
  (
    await api.sql<{ status: string; amount_cents: number; sent: boolean; voided: boolean }>(
      "select status::text as status, amount_cents, sent_at is not null as sent, voided_at is not null as voided from public.invoices where id = $1",
      [id],
    )
  )[0];

const jobBilling = async (id: string) =>
  (
    await api.sql<{ stamp: string | null; released: boolean }>(
      "select billing_invoice_id as stamp, billing_released_at is not null as released from public.bookings where id = $1",
      [id],
    )
  )[0];

async function newInvoiceFor(c: Company, jobId: string): Promise<string> {
  const res = await asOwner(c, () => invoices.createInvoiceAction({}, invoiceForm(c, jobId)));
  const [row] = await api.sql<{ id: string }>(
    "select id from public.invoices where organization_id = $1 and booking_id = $2 and status <> 'void' order by created_at desc limit 1",
    [c.org, jobId],
  );
  expect(row, `createInvoiceAction answered ${JSON.stringify(res).slice(0, 300)}`).toBeTruthy();
  return row.id;
}

async function pay(c: Company, invoiceId: string, dollars: string, method = "cash") {
  return asOwner(c, () =>
    invoices.recordInvoicePaymentAction(
      invoiceId,
      {},
      idForm({ amount_dollars: dollars, method, reference: "", received_at: new Date().toISOString().slice(0, 10), notes: "" }),
    ),
  );
}

describe.skipIf(!hasPostgrest)("an invoice's life, through the app's own actions", () => {
  it("made from a finished job: a draft for the job's price, the job reads as billed, and a second invoice for it is refused", async () => {
    const c = await company();
    const jobId = await finishedJob(c);
    const id = await newInvoiceFor(c, jobId);
    expect(await invoiceRow(id)).toMatchObject({ status: "draft", amount_cents: 14000 });
    expect((await jobBilling(jobId)).stamp).toBe(id);

    const again = await asOwner(c, () => invoices.createInvoiceAction({}, invoiceForm(c, jobId)));
    expect(JSON.stringify(again)).toMatch(/already bills this job/);
    const [{ n }] = await api.sql<{ n: number }>(
      "select count(*)::int as n from public.invoices where booking_id = $1 and status <> 'void'",
      [jobId],
    );
    expect(n).toBe(1);
  });

  it("sent: the status says sent and the time it went", async () => {
    const c = await company();
    const id = await newInvoiceFor(c, await finishedJob(c));
    const answer = await asOwner(c, () => invoices.sendInvoiceAction({}, idForm({ id })));
    expect(await invoiceRow(id), JSON.stringify(answer)).toMatchObject({ status: "sent", sent: true });
    expect(sentEmails.at(-1)?.to).toBe(`client-${c.client.slice(0, 8)}@example.test`);
  });

  it("paid in part, a payment corrected, then removed: the status follows the money each time", async () => {
    const c = await company();
    const id = await newInvoiceFor(c, await finishedJob(c));
    await asOwner(c, () => invoices.sendInvoiceAction({}, idForm({ id })));
    await pay(c, id, "40.00");
    expect((await invoiceRow(id)).status).toBe("partially_paid");

    const [p] = await api.sql<{ id: string }>("select id from public.invoice_payments where invoice_id = $1", [id]);
    const corrected = await asOwner(c, () =>
      invoices.updateInvoicePaymentAction(
        idForm({ payment_id: p.id, invoice_id: id, amount_dollars: "140.00", method: "cash", reference: "", received_at: new Date().toISOString().slice(0, 10), notes: "" }),
      ),
    );
    expect(JSON.stringify(corrected)).not.toMatch(/"ok":false/);
    expect((await invoiceRow(id)).status).toBe("paid");

    await asOwner(c, () => invoices.deleteInvoicePaymentAction(idForm({ payment_id: p.id, invoice_id: id })));
    expect((await invoiceRow(id)).status).toBe("sent");
  });

  it("voided: it says void, and its job is free to bill again, but only by a person", async () => {
    const c = await company();
    const jobId = await finishedJob(c);
    const id = await newInvoiceFor(c, jobId);
    await asOwner(c, () => invoices.sendInvoiceAction({}, idForm({ id })));
    await asOwner(c, () => invoices.voidInvoiceAction(idForm({ id })));
    expect(await invoiceRow(id)).toMatchObject({ status: "void", voided: true });
    expect(await jobBilling(jobId)).toEqual({ stamp: null, released: true });

    // A person can bill it again.
    const next = await newInvoiceFor(c, jobId);
    expect(next).not.toBe(id);
  });

  it("a draft deleted: gone, and its job is unbilled again, still open to the automatic runs", async () => {
    const c = await company();
    const jobId = await finishedJob(c);
    const id = await newInvoiceFor(c, jobId);
    await asOwner(c, () => invoices.deleteInvoiceAction(idForm({ id })));
    const [{ n }] = await api.sql<{ n: number }>("select count(*)::int as n from public.invoices where id = $1", [id]);
    expect(n).toBe(0);
    expect(await jobBilling(jobId)).toEqual({ stamp: null, released: false });
  });

  it("a paid invoice cannot be voided out from under its payment", async () => {
    const c = await company();
    const jobId = await finishedJob(c);
    const id = await newInvoiceFor(c, jobId);
    await asOwner(c, () => invoices.sendInvoiceAction({}, idForm({ id })));
    await pay(c, id, "140.00");
    expect((await invoiceRow(id)).status).toBe("paid");
    await asOwner(c, () => invoices.voidInvoiceAction(idForm({ id })));
    const after = await invoiceRow(id);
    // Either refused (still paid), or voided with the money still on record; never paid money silently dropped.
    const [{ payments }] = await api.sql<{ payments: number }>("select count(*)::int as payments from public.invoice_payments where invoice_id = $1", [id]);
    expect(payments).toBe(1);
    expect(after.status, "a paid invoice was voided").toBe("paid");
  });
});

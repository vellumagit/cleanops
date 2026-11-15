/**
 * Bill for a period: combining the per-job drafts (2026-11-15).
 *
 * Auto-invoicing drafts one invoice per job as it finishes. Bill for a
 * period lists those drafts and says to tick the ones to combine; they
 * become lines and are voided. Svitlana ticked them and every save was
 * refused: "invoice INV-INV-2026-0350 (draft) already bills this job". The
 * billed check ran before the drafts were set aside, found each job on the
 * draft about to be voided, and stopped. The number also carried its prefix
 * twice.
 *
 * The real action against the real stack (test/db/api.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async () => (await import("./next-stubs")).nextServer());

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

type Company = { org: string; owner: Member; client: string };

async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Company");
  const owner = await addMember(api.sql, org, "owner", "Owner");
  const client = await addClient(api.sql, org, "Shannon");
  return { org, owner, client };
}

/** A finished job and the draft auto-invoicing raised for it. */
async function jobWithInvoice(c: Company, daysAgo: number, status = "draft"): Promise<{ job: string; invoice: string; number: string }> {
  const job = await addBooking(api.sql, c.org, c.client, {
    scheduledAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    status: "completed",
  });
  const [inv] = await api.sql<{ id: string; number: string }>(
    `insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents)
     values ($1, $2, $3, $4::public.invoice_status, 14175) returning id, number`,
    [c.org, c.client, job, status],
  );
  await api.sql("update public.bookings set billing_invoice_id = $2 where id = $1", [job, inv.id]);
  return { job, invoice: inv.id, number: inv.number };
}

async function billPeriod(c: Company, jobs: string[], absorb: string[]) {
  request.cookies = api.sessionCookies(c.owner.userId);
  try {
    const form = new FormData();
    form.set("client_id", c.client);
    form.set(
      "line_items_json",
      JSON.stringify(jobs.map((id, i) => ({ label: `Standard clean ${i + 1}`, quantity: "1", unit_price_dollars: "141.75", booking_id: id }))),
    );
    form.set("absorb_invoice_ids", JSON.stringify(absorb));
    const res = await invoices.createPeriodInvoiceAction({}, form);
    return `returned ${JSON.stringify(res)}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  } finally {
    await settle();
  }
}

const statusOf = async (id: string) =>
  (await api.sql<{ status: string }>("select status::text from public.invoices where id = $1", [id]))[0].status;

describe.skipIf(!hasPostgrest)("Bill for a period, combining the per-job drafts", () => {
  it("ticking the drafts creates one invoice for all the jobs and voids the drafts", async () => {
    const c = await company();
    const a = await jobWithInvoice(c, 20);
    const b = await jobWithInvoice(c, 13);

    const result = await billPeriod(c, [a.job, b.job], [a.invoice, b.invoice]);
    expect(result, api.log()).toMatch(/^redirected to \/app\/invoices\/[0-9a-f-]+\/edit$/);
    const newId = result.split("/")[3];

    expect(await statusOf(a.invoice)).toBe("void");
    expect(await statusOf(b.invoice)).toBe("void");
    const [fresh] = await api.sql<{ status: string; amount_cents: number }>(
      "select status::text, amount_cents from public.invoices where id = $1",
      [newId],
    );
    expect(fresh).toEqual({ status: "draft", amount_cents: 28350 });
    const lines = await api.sql<{ booking_id: string }>("select booking_id from public.invoice_line_items where invoice_id = $1", [newId]);
    expect(lines.map((l) => l.booking_id).sort()).toEqual([a.job, b.job].sort());
    const stamps = await api.sql<{ billing_invoice_id: string }>(
      "select billing_invoice_id from public.bookings where id = any($1::uuid[])",
      [[a.job, b.job]],
    );
    expect(stamps.every((s) => s.billing_invoice_id === newId)).toBe(true);
  });

  it("a job whose draft was NOT ticked is still refused, and nothing is created or voided", async () => {
    const c = await company();
    const a = await jobWithInvoice(c, 20);
    const b = await jobWithInvoice(c, 13);

    const result = await billPeriod(c, [a.job, b.job], [a.invoice]);
    expect(result).toContain("already bills this job");
    expect(await statusOf(a.invoice)).toBe("draft");
    expect(await statusOf(b.invoice)).toBe("draft");
    expect(
      await api.sql("select 1 from public.invoices where organization_id = $1 and booking_id is null", [c.org]),
    ).toEqual([]);
  });

  it("an invoice already sent is never absorbed: its job is refused and it stays sent", async () => {
    const c = await company();
    const sent = await jobWithInvoice(c, 20, "sent");

    const result = await billPeriod(c, [sent.job], [sent.invoice]);
    expect(result).toContain("already bills this job");
    expect(await statusOf(sent.invoice)).toBe("sent");
  });

  it("the refusal names the invoice once, not INV-INV-", async () => {
    const c = await company();
    const a = await jobWithInvoice(c, 20);
    expect(a.number).toMatch(/^INV-\d{4}-\d{4}$/);

    const result = await billPeriod(c, [a.job], []);
    expect(result).toContain(`invoice ${a.number} (draft) already bills this job`);
    expect(result).not.toContain("INV-INV-");
  });

  it("another company's draft can't be voided through this form", async () => {
    const c = await company();
    const other = await company();
    const theirs = await jobWithInvoice(other, 20);
    const mine = await addBooking(api.sql, c.org, c.client, {
      scheduledAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      status: "completed",
    });

    const result = await billPeriod(c, [mine], [theirs.invoice]);
    expect(result, api.log()).toMatch(/^redirected to /);
    expect(await statusOf(theirs.invoice)).toBe("draft");
  });
});

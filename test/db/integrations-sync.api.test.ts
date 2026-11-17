/**
 * Pushing money into the books: an invoice to QuickBooks or Sage, a paid
 * payroll run and a contractor statement to Sage, and the nightly jobs that
 * retry whatever didn't land. Pressed as the office presses them, against a
 * real database behind the real PostgREST; QuickBooks and Sage are stood in
 * for at their own hosts and record what they were sent.
 *
 * What each owes the books: the amounts the client was billed (lines, tax)
 * and the people were paid, once (pressing twice books nothing twice), only
 * for the company pressing, and a plain refusal when the books aren't
 * connected or the person isn't allowed.
 */
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const CRON_SECRET = "integrations-sync-test-cron-secret";
const ENV: Record<string, string> = {
  INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  QUICKBOOKS_CLIENT_ID: "test-qb-client",
  QUICKBOOKS_CLIENT_SECRET: "test-qb-secret",
  SAGE_CLIENT_ID: "test-sage-client",
  SAGE_CLIENT_SECRET: "test-sage-secret",
  CRON_SECRET,
};
const saved: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries(ENV)) {
  saved[k] = process.env[k];
  process.env[k] = v;
}

const invoices = await import("@/app/app/invoices/actions");
const payroll = await import("@/app/app/payroll/actions");
const statements = await import("@/app/app/payroll/contractors/run-actions");
const { GET: qbReconcile } = await import("@/app/api/cron/quickbooks-reconcile/route");
const { GET: sageReconcile } = await import("@/app/api/cron/sage-reconcile/route");
const { encryptSecret } = await import("@/lib/crypto");

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
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ---------------------------------------------------------------------------
// QuickBooks and Sage, stood in for
// ---------------------------------------------------------------------------

type Call = { method: string; path: string; token: string; body: Record<string, unknown> | null };
/** QuickBooks calls by company (realm id). */
const qbCalls = new Map<string, Call[]>();
/** Sage calls by access token (each company's own). */
const sageCalls = new Map<string, Call[]>();
let n = 0;
const realFetch = globalThis.fetch;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const push = <K,>(m: Map<K, Call[]>, k: K, c: Call) => {
  const list = m.get(k) ?? [];
  list.push(c);
  m.set(k, list);
};

const SAGE_LEDGERS = [
  { id: "la-sales", displayed_as: "Sales", nominal_code: "4000", visible_in_sales: true, ledger_account_type: { displayed_as: "Sales" } },
  { id: "la-wages", displayed_as: "Wages and Salaries", nominal_code: "7000", ledger_account_type: { displayed_as: "Direct Expenses" } },
  { id: "la-wages-payable", displayed_as: "Wages Payable", nominal_code: "2210", ledger_account_type: { displayed_as: "Current Liabilities" } },
  { id: "la-subcontract", displayed_as: "Subcontractor costs", nominal_code: "5100", ledger_account_type: { displayed_as: "Direct Expenses" } },
];
const SAGE_TAX = [
  { id: "CA_NO_TAX", displayed_as: "No Tax", type: "NO_TAX", percentage: "0.0" },
  { id: "CA_GST", displayed_as: "GST", percentage: "5.0" },
];

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  qbCalls.clear();
  sageCalls.clear();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    const token = (new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const body = typeof init?.body === "string" && init.body.startsWith("{") ? (JSON.parse(init.body) as Record<string, unknown>) : null;

    const qb = /^https:\/\/sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/([^/]+)(\/[^?]*)(?:\?(.*))?$/.exec(url);
    if (qb) {
      const [, realm, path, qs] = qb;
      push(qbCalls, realm, { method, path, token, body });
      if (path === "/query") {
        const q = new URLSearchParams(qs).get("query") ?? "";
        if (/FROM Customer/i.test(q)) return json(200, { QueryResponse: {} });
        if (/FROM Item/i.test(q)) return json(200, { QueryResponse: { Item: [{ Id: "1" }] } });
        if (/FROM CompanyInfo/i.test(q)) return json(200, { QueryResponse: { CompanyInfo: [{ Country: "CA" }] } });
        if (/FROM TaxRate/i.test(q)) return json(200, { QueryResponse: { TaxRate: [{ Id: "5", RateValue: 5 }, { Id: "11", RateValue: 13 }] } });
        if (/FROM TaxCode/i.test(q)) {
          return json(200, {
            QueryResponse: { TaxCode: [{ Id: "7", Name: "GST", Active: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "5" } }] } }] },
          });
        }
        if (/FROM PaymentMethod/i.test(q)) return json(200, { QueryResponse: {} });
        return json(400, { Fault: { Error: [{ Message: `stand-in has no answer for ${q}` }] } });
      }
      if (method === "POST" && path === "/customer") return json(200, { Customer: { Id: `cust-${++n}` } });
      if (method === "POST" && path === "/invoice") return json(200, { Invoice: { Id: `qbinv-${++n}` } });
      return json(404, { Fault: { Error: [{ Message: `stand-in has no ${method} ${path}` }] } });
    }

    const sage = /^https:\/\/api\.accounting\.sage\.com\/v3\.1(\/[^?]*)/.exec(url);
    if (sage) {
      const path = sage[1];
      push(sageCalls, token, { method, path, token, body });
      if (method === "GET" && path === "/ledger_accounts") return json(200, { $items: SAGE_LEDGERS });
      if (method === "GET" && path === "/tax_rates") return json(200, { $items: SAGE_TAX });
      if (method === "GET" && path === "/bank_accounts") return json(200, { $items: [{ id: "bank-1", displayed_as: "Chequing", bank_account_type: { id: "CHECKING", displayed_as: "Checking" } }] });
      if (method === "GET" && path === "/payment_methods") return json(200, { $items: [] });
      if (method === "POST" && path === "/contacts") return json(201, { id: `contact-${++n}`, displayed_as: "x" });
      if (method === "PUT" && path.startsWith("/contacts/")) return json(200, { id: path.split("/")[2] });
      if (method === "POST" && path === "/sales_invoices") return json(201, { id: `si-${++n}`, displayed_as: "SI" });
      if (method === "POST" && path === "/journals") return json(201, { id: `journal-${++n}` });
      if (method === "POST" && path === "/purchase_invoices") return json(201, { id: `pi-${++n}` });
      if (method === "POST" && path === "/contact_payments") return json(201, { id: `cp-${++n}` });
      return json(404, [{ $message: `stand-in has no ${method} ${path}` }]);
    }
    if (/intuit\.com|sage\.com|sageone\.com/.test(url)) throw new Error(`test: unexpected call to ${url}`);
    return realFetch(input, init);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const posts = (calls: Call[] | undefined, path: string) => (calls ?? []).filter((c) => c.method === "POST" && c.path === path);

// ---------------------------------------------------------------------------
// People, invoices, runs
// ---------------------------------------------------------------------------

async function company(name = "Books Co") {
  const org = await addOrg(api.sql, name);
  await api.sql("update public.organizations set timezone = 'America/Regina' where id = $1", [org]);
  const client = await addClient(api.sql, org, "Hilda Daubner");
  await api.sql("update public.clients set address = '123 Albert St, Regina, SK S4P 1A1, Canada', email = $2 where id = $1", [
    client,
    `hilda.${randomBytes(3).toString("hex")}@example.com`,
  ]);
  return {
    org,
    client,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    admin: await addMember(api.sql, org, "admin", "Iryna"),
    olha: await addMember(api.sql, org, "manager", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    bea: await addMember(api.sql, org, "employee", "Bea"),
  };
}
type Co = Awaited<ReturnType<typeof company>>;

async function connect(c: Co, provider: "quickbooks" | "sage", metadata: Record<string, unknown> = {}): Promise<string> {
  const token = `${provider}-${randomBytes(4).toString("hex")}`;
  const realm = provider === "quickbooks" ? `realm-${randomBytes(4).toString("hex")}` : null;
  await api.sql(
    `insert into public.integration_connections
       (organization_id, provider, status, external_account_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, metadata)
     values ($1, $2::public.integration_provider, 'active', $3, $4, $5, now() + interval '1 hour', $6::jsonb)`,
    [c.org, provider, realm, encryptSecret(token), encryptSecret(`refresh-${token}`), JSON.stringify(metadata)],
  );
  return realm ?? token;
}

let invoiceSeq = 0;
/** $250 deep clean + 2 × $25 oven, 5% GST: $315.00. */
async function invoice(c: Co, over: { status?: string; voided?: boolean; taxBps?: number; createdDaysAgo?: number } = {}): Promise<string> {
  const taxBps = over.taxBps ?? 500;
  const tax = Math.round((30000 * taxBps) / 10000);
  const [inv] = await api.sql<{ id: string }>(
    `insert into public.invoices (organization_id, client_id, status, amount_cents, tax_rate_bps, tax_amount_cents, number, voided_at, created_at)
     values ($1, $2, $3::public.invoice_status, $4, $5, $6, $7, $8::timestamptz, now() - make_interval(days => $9)) returning id`,
    [c.org, c.client, over.status ?? "sent", 30000 + tax, taxBps, tax, `INV-${9000 + ++invoiceSeq}`, over.voided ? new Date().toISOString() : null, over.createdDaysAgo ?? 0],
  );
  await api.sql(
    `insert into public.invoice_line_items (organization_id, invoice_id, label, quantity, unit_price_cents, sort_order)
     values ($1, $2, 'Deep clean', 1, 25000, 0), ($1, $2, 'Inside oven', 2, 2500, 1)`,
    [c.org, inv.id],
  );
  return inv.id;
}
const invoiceRow = async (id: string) =>
  (await api.sql<{ number: string; quickbooks_invoice_id: string | null; sage_invoice_id: string | null; status: string }>(
    "select number, quickbooks_invoice_id, sage_invoice_id, status::text as status from public.invoices where id = $1",
    [id],
  ))[0];

async function as<T>(m: Member, press: () => Promise<T>): Promise<T | { redirected: string }> {
  request.cookies = api.sessionCookies(m.userId);
  try {
    return await press();
  } catch (err) {
    const r = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
    if (r) return { redirected: r[1] };
    throw err;
  } finally {
    await settle();
  }
}
const idForm = (id: string) => {
  const f = new FormData();
  f.set("id", id);
  return f;
};

async function cron(GET: (r: NextRequest) => Promise<Response>, path: string, auth = true) {
  const res = await GET(new NextRequest(`https://sollos3.com${path}`, auth ? { headers: { authorization: `Bearer ${CRON_SECRET}` } } : {}));
  await settle();
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Regina's calendar date for an instant. */
const reginaDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Regina" });

// ===========================================================================

describe.skipIf(!hasPostgrest)("the Sync to QuickBooks button", { timeout: 120_000 }, () => {
  it("a manager pushes her company's invoice: the customer is made, the lines and tax go over at the billed amounts, and pressing again books nothing new", async () => {
    const c = await company();
    const realm = await connect(c, "quickbooks");
    const id = await invoice(c);
    const [{ created_at }] = await api.sql<{ created_at: string }>("select created_at::text from public.invoices where id = $1", [id]);

    const res = (await as(c.olha, () => invoices.syncInvoiceToQuickBooksAction({}, idForm(id)))) as { ok?: boolean; qbInvoiceId?: string; error?: string };
    expect(res.error, api.log().slice(-500)).toBeUndefined();
    expect(res.ok).toBe(true);
    const calls = qbCalls.get(realm);
    const [customer] = posts(calls, "/customer");
    expect(customer.body).toMatchObject({ DisplayName: expect.stringContaining("Hilda Daubner"), BillAddr: { Line1: "123 Albert St, Regina, SK S4P 1A1, Canada" } });
    const [sent] = posts(calls, "/invoice");
    expect(sent.body).toMatchObject({
      TxnDate: reginaDate(created_at),
      GlobalTaxCalculation: "TaxExcluded",
      CustomerMemo: { value: `Sollos invoice ${(await invoiceRow(id)).number}` },
      Line: [
        { Amount: 250, Description: "Deep clean", SalesItemLineDetail: { ItemRef: { value: "1" }, Qty: 1, UnitPrice: 250, TaxCodeRef: { value: "7" } } },
        { Amount: 50, Description: "Inside oven", SalesItemLineDetail: { ItemRef: { value: "1" }, Qty: 2, UnitPrice: 25, TaxCodeRef: { value: "7" } } },
      ],
    });
    expect((await invoiceRow(id)).quickbooks_invoice_id).toBe(res.qbInvoiceId);
    const [{ q }] = await api.sql<{ q: string | null }>("select quickbooks_customer_id as q from public.clients where id = $1", [c.client]);
    expect(q).toMatch(/^cust-/);

    expect(await as(c.owner, () => invoices.syncInvoiceToQuickBooksAction({}, idForm(id)))).toEqual({ ok: true, qbInvoiceId: res.qbInvoiceId });
    expect(posts(qbCalls.get(realm), "/invoice"), "booked once").toHaveLength(1);
  });

  it("a cleaner is refused; with QuickBooks not connected it says so; a taxed invoice QuickBooks has no code for is refused, not booked untaxed", async () => {
    const c = await company();
    const id = await invoice(c);
    expect(await as(c.anna, () => invoices.syncInvoiceToQuickBooksAction({}, idForm(id)))).toEqual({
      error: "Only owners, admins, or managers can push to QuickBooks.",
    });
    expect(await as(c.owner, () => invoices.syncInvoiceToQuickBooksAction({}, idForm(id)))).toEqual({
      error: "QuickBooks isn't connected. Reconnect it in Settings → Integrations, then try again.",
    });

    const realm = await connect(c, "quickbooks");
    const odd = await invoice(c, { taxBps: 1100 });
    const res = (await as(c.owner, () => invoices.syncInvoiceToQuickBooksAction({}, idForm(odd)))) as { error?: string };
    expect(res.error).toContain("no tax rate of 11% exists in your QuickBooks company");
    expect(posts(qbCalls.get(realm), "/invoice")).toEqual([]);
    expect((await invoiceRow(odd)).quickbooks_invoice_id).toBeNull();
    const [{ last_error }] = await api.sql<{ last_error: string | null }>(
      "select last_error from public.integration_connections where organization_id = $1 and provider = 'quickbooks'",
      [c.org],
    );
    expect(last_error, "the reason shows on the Integrations page").toContain("11%");
    expect(await as(c.owner, () => invoices.syncInvoiceToQuickBooksAction({}, idForm("")))).toEqual({ error: "Missing invoice id." });
  });

  // FIX-LATER: syncInvoiceToQuickBooksAction never checks the invoice is the caller's company's; pushInvoiceToQuickBooks reads it with the service key and books it into ITS company's QuickBooks
  it.fails("another company's invoice id books nothing into their QuickBooks", async () => {
    const mine = await company("Mine");
    const theirs = await company("Theirs");
    await connect(mine, "quickbooks");
    const theirRealm = await connect(theirs, "quickbooks");
    const theirInvoice = await invoice(theirs, { status: "draft" });

    const res = (await as(mine.owner, () => invoices.syncInvoiceToQuickBooksAction({}, idForm(theirInvoice)))) as { ok?: boolean; error?: string };
    expect(qbCalls.get(theirRealm) ?? [], "nothing sent to their QuickBooks").toEqual([]);
    expect((await invoiceRow(theirInvoice)).quickbooks_invoice_id).toBeNull();
    expect(res.ok).toBeUndefined();
  });

  // FIX-LATER: neither push checks voided_at/status; the button is hidden on a void invoice and the nightly job skips them, but the action itself books a voided invoice as revenue
  it.fails("a voided invoice is not booked into QuickBooks", async () => {
    const c = await company();
    const realm = await connect(c, "quickbooks");
    const id = await invoice(c, { status: "void", voided: true });
    const res = (await as(c.owner, () => invoices.syncInvoiceToQuickBooksAction({}, idForm(id)))) as { ok?: boolean; error?: string };
    expect(posts(qbCalls.get(realm), "/invoice")).toEqual([]);
    expect(res.error).toBeTruthy();
  });

  // FIX-LATER: the sync buttons check role only; a manager whose "invoicing" capability is off (pages bounce her) can still book invoices into QuickBooks/Sage — the capability migration says server actions gate on it
  it.fails("a manager with invoicing switched off can't push an invoice into the books", async () => {
    const c = await company();
    const realm = await connect(c, "quickbooks");
    const id = await invoice(c);
    await api.sql(`update public.memberships set capabilities = '{"invoicing": false}'::jsonb where id = $1`, [c.olha.membershipId]);
    const res = (await as(c.olha, () => invoices.syncInvoiceToQuickBooksAction({}, idForm(id)))) as { ok?: boolean; error?: string };
    expect(posts(qbCalls.get(realm), "/invoice")).toEqual([]);
    expect(res.ok).toBeUndefined();
  });
});

describe.skipIf(!hasPostgrest)("the Sync to Sage button", { timeout: 120_000 }, () => {
  it("a manager pushes her company's invoice: the contact is made with its address, the lines carry the billed tax, and pressing again books nothing new", async () => {
    const c = await company();
    const token = await connect(c, "sage");
    const id = await invoice(c);

    const res = (await as(c.olha, () => invoices.syncInvoiceToSageAction({}, idForm(id)))) as { ok?: boolean; sageInvoiceId?: string; error?: string };
    expect(res.error, api.log().slice(-500)).toBeUndefined();
    const calls = sageCalls.get(token);
    const [contact] = posts(calls, "/contacts");
    expect(contact.body).toMatchObject({
      contact: { contact_type_ids: ["CUSTOMER"], main_address: { address_line_1: "123 Albert St", city: "Regina", region: "SK", country_id: "CA" } },
    });
    const [si] = posts(calls, "/sales_invoices");
    const body = (si.body as { sales_invoice: Record<string, unknown> }).sales_invoice;
    expect(body).toMatchObject({ reference: (await invoiceRow(id)).number, tax_address_region_id: "CA-SK" });
    expect(body.invoice_lines).toEqual([
      { description: "Deep clean", quantity: 1, unit_price: 250, ledger_account_id: "la-sales", tax_rate_id: "CA_GST", tax_amount: 12.5, currency_tax_amount: 12.5 },
      { description: "Inside oven", quantity: 2, unit_price: 25, ledger_account_id: "la-sales", tax_rate_id: "CA_GST", tax_amount: 2.5, currency_tax_amount: 2.5 },
    ]);
    expect((await invoiceRow(id)).sage_invoice_id).toBe(res.sageInvoiceId);

    expect(await as(c.owner, () => invoices.syncInvoiceToSageAction({}, idForm(id)))).toEqual({ ok: true, sageInvoiceId: res.sageInvoiceId });
    expect(posts(sageCalls.get(token), "/sales_invoices")).toHaveLength(1);
  });

  it("a cleaner is refused, and with Sage not connected it says so", async () => {
    const c = await company();
    const id = await invoice(c);
    expect(await as(c.anna, () => invoices.syncInvoiceToSageAction({}, idForm(id)))).toEqual({ error: "Only owners, admins, or managers can push to Sage." });
    expect(await as(c.owner, () => invoices.syncInvoiceToSageAction({}, idForm(id)))).toEqual({
      error: "Sage isn't connected. Reconnect it in Settings → Integrations, then try again.",
    });
  });

  // FIX-LATER: syncInvoiceToSageAction never checks the invoice is the caller's company's; pushInvoiceToSage books any invoice id into its own company's Sage
  it.fails("another company's invoice id books nothing into their Sage", async () => {
    const mine = await company("Mine");
    const theirs = await company("Theirs");
    await connect(mine, "sage");
    const theirToken = await connect(theirs, "sage");
    const theirInvoice = await invoice(theirs, { status: "draft" });
    const res = (await as(mine.owner, () => invoices.syncInvoiceToSageAction({}, idForm(theirInvoice)))) as { ok?: boolean };
    expect(sageCalls.get(theirToken) ?? []).toEqual([]);
    expect((await invoiceRow(theirInvoice)).sage_invoice_id).toBeNull();
    expect(res.ok).toBeUndefined();
  });

  // FIX-LATER: same as QuickBooks: a voided invoice is booked into Sage by the action
  it.fails("a voided invoice is not booked into Sage", async () => {
    const c = await company();
    const token = await connect(c, "sage");
    const id = await invoice(c, { status: "void", voided: true });
    await as(c.owner, () => invoices.syncInvoiceToSageAction({}, idForm(id)));
    expect(posts(sageCalls.get(token), "/sales_invoices")).toEqual([]);
  });
});

// ===========================================================================

async function paidRun(c: Co, status = "paid"): Promise<string> {
  const [r] = await api.sql<{ id: string }>(
    `insert into public.payroll_runs (organization_id, period_start, period_end, status, total_cents, created_by, paid_at)
     values ($1, '2026-11-01', '2026-11-14', $2, 64000, $3, case when $2 = 'paid' then now() else null end) returning id`,
    [c.org, status, c.owner.membershipId],
  );
  await api.sql(
    `insert into public.payroll_items (payroll_run_id, organization_id, employee_id, employee_name, hours_worked, regular_pay_cents, total_cents)
     values ($1, $2, $3, 'Anna K', 20, 40000, 40000), ($1, $2, $4, 'Bea L', 12, 24000, 24000), ($1, $2, $5, 'Olha (no hours)', 0, 0, 0)`,
    [r.id, c.org, c.anna.membershipId, c.bea.membershipId, c.olha.membershipId],
  );
  return r.id;
}
const journalOf = async (id: string) => (await api.sql<{ j: string | null }>("select sage_journal_id as j from public.payroll_runs where id = $1", [id]))[0].j;

describe.skipIf(!hasPostgrest)("Post to Sage on a paid payroll run", { timeout: 120_000 }, () => {
  it("the owner posts it: wages debited per person at what they were paid, the run total held as a liability, once", async () => {
    const c = await company();
    const token = await connect(c, "sage");
    const run = await paidRun(c);

    expect(await as(c.owner, () => payroll.postPayrollRunToSageAction({}, idForm(run))), api.log().slice(-500)).toEqual({ ok: true });
    const [j] = posts(sageCalls.get(token), "/journals");
    const journal = (j.body as { journal: { journal_lines: Array<Record<string, unknown>>; reference: string } }).journal;
    expect(journal.journal_lines).toEqual([
      { ledger_account_id: "la-wages", debit: 400, credit: 0, details: "Anna K · 20h" },
      { ledger_account_id: "la-wages", debit: 240, credit: 0, details: "Bea L · 12h" },
      { ledger_account_id: "la-wages-payable", debit: 0, credit: 640, details: "Payroll 2026-11-01 to 2026-11-14" },
    ]);
    expect(await journalOf(run)).toMatch(/^journal-/);
    expect(await as(c.admin, () => payroll.postPayrollRunToSageAction({}, idForm(run)))).toEqual({ ok: true });
    expect(posts(sageCalls.get(token), "/journals"), "posted once").toHaveLength(1);
  });

  it("a manager and a cleaner are refused; another company's run, a draft run, and no Sage each post nothing", async () => {
    const c = await company();
    const other = await company("Other Co");
    const token = await connect(c, "sage");
    const otherToken = await connect(other, "sage");
    const run = await paidRun(c);
    const theirs = await paidRun(other);
    const draft = await paidRun(c, "draft");

    expect(await as(c.olha, () => payroll.postPayrollRunToSageAction({}, idForm(run)))).toEqual({ error: "Only owners and admins can post to Sage." });
    expect(await as(c.anna, () => payroll.postPayrollRunToSageAction({}, idForm(run)))).toEqual({ error: "Only owners and admins can post to Sage." });
    expect(await as(c.owner, () => payroll.postPayrollRunToSageAction({}, idForm(theirs)))).toEqual({ error: "Run not found." });
    expect(await as(c.owner, () => payroll.postPayrollRunToSageAction({}, idForm(draft)))).toEqual({
      error: "Only a run marked paid is posted to Sage; this one isn't yet.",
    });
    expect(sageCalls.get(token) ?? []).toEqual([]);
    expect(sageCalls.get(otherToken) ?? []).toEqual([]);
    expect(await journalOf(theirs)).toBeNull();

    const unconnected = await company("No Books");
    const lone = await paidRun(unconnected);
    expect(await as(unconnected.owner, () => payroll.postPayrollRunToSageAction({}, idForm(lone)))).toEqual({
      error: "Sage isn't connected. Reconnect it in Settings → Integrations, then try again.",
    });
  });

  it("validatePeriodRange: a real, ordered window of at most 92 days", async () => {
    expect(await payroll.validatePeriodRange("2026-11-01", "2026-11-14")).toBeNull();
    expect(await payroll.validatePeriodRange("2026-11-01", "2026-11-01")).toBeNull();
    expect(await payroll.validatePeriodRange("2026-01-01", "2026-04-02")).toBeNull(); // 92 days
    expect(await payroll.validatePeriodRange("2026-01-01", "2026-04-03")).toBe("A pay period can't be longer than 92 days — split it up.");
    expect(await payroll.validatePeriodRange("2026-02-01", "2026-02-31")).toBe("2026-02-31 isn't a real calendar date.");
    expect(await payroll.validatePeriodRange("2026-11-14", "2026-11-01")).toBe("Period end must be on or after start.");
    expect(await payroll.validatePeriodRange("11/01/2026", "2026-11-14")).toBe("Dates must be valid calendar dates.");
    expect(await payroll.validatePeriodRange("2026-11-01", "2062-11-14")).toBe("A pay period can't be longer than 92 days — split it up.");
  });
});

// ===========================================================================

async function statement(c: Co, status: "finalized" | "paid" = "finalized"): Promise<string> {
  const [r] = await api.sql<{ id: string }>(
    `insert into public.subcontractor_pay_runs (organization_id, period_start, period_end, status, total_cents, created_by, paid_at)
     values ($1, '2026-11-01', '2026-11-14', $2, 51000, $3, case when $2 = 'paid' then now() else null end) returning id`,
    [c.org, status, c.owner.membershipId],
  );
  await api.sql(
    `insert into public.subcontractor_pay_items (run_id, organization_id, membership_id, payee_name, minutes, entry_count, total_cents)
     values ($1, $2, $3, 'Anna K', 900, 4, 31500), ($1, $2, $4, 'Bea L', 600, 3, 19500), ($1, $2, $5, 'Olha', 0, 0, 0)`,
    [r.id, c.org, c.anna.membershipId, c.bea.membershipId, c.olha.membershipId],
  );
  return r.id;
}

describe.skipIf(!hasPostgrest)("Post to Sage on a contractor statement", { timeout: 120_000 }, () => {
  it("the owner posts it: a supplier and a bill per paid contractor at their amount, then the payments once it's paid, nothing twice", async () => {
    const c = await company();
    const token = await connect(c, "sage");
    const run = await statement(c);

    expect(await as(c.owner, () => statements.postStatementToSageAction(run)), api.log().slice(-500)).toEqual({ ok: true });
    const suppliers = posts(sageCalls.get(token), "/contacts");
    expect(suppliers.map((s) => (s.body as { contact: { contact_type_ids: string[] } }).contact.contact_type_ids)).toEqual([["VENDOR"], ["VENDOR"]]);
    const bills = posts(sageCalls.get(token), "/purchase_invoices").map((b) => (b.body as { purchase_invoice: { invoice_lines: Array<{ unit_price: number; ledger_account_id: string; tax_rate_id: string; description: string }> } }).purchase_invoice.invoice_lines[0]);
    expect(bills.map((b) => [b.unit_price, b.ledger_account_id, b.tax_rate_id]).sort()).toEqual([
      [195, "la-subcontract", "CA_NO_TAX"],
      [315, "la-subcontract", "CA_NO_TAX"],
    ]);
    expect(bills.find((b) => b.unit_price === 315)?.description).toContain("15h");
    expect(posts(sageCalls.get(token), "/contact_payments"), "not paid yet: no payments").toEqual([]);

    await api.sql("update public.subcontractor_pay_runs set status = 'paid', paid_at = now() where id = $1", [run]);
    expect(await as(c.admin, () => statements.postStatementToSageAction(run))).toEqual({ ok: true });
    const payments = posts(sageCalls.get(token), "/contact_payments").map((p) => (p.body as { contact_payment: { total_amount: number; bank_account_id: string } }).contact_payment);
    expect(payments.map((p) => [p.total_amount, p.bank_account_id]).sort()).toEqual([
      [195, "bank-1"],
      [315, "bank-1"],
    ]);
    expect(posts(sageCalls.get(token), "/purchase_invoices"), "bills not posted again").toHaveLength(2);

    await as(c.owner, () => statements.postStatementToSageAction(run));
    expect(posts(sageCalls.get(token), "/contact_payments"), "payments not posted again").toHaveLength(2);
    expect(posts(sageCalls.get(token), "/contacts"), "suppliers made once").toHaveLength(2);
  });

  it("a manager and a cleaner are refused, and another company's statement is out of reach", async () => {
    const c = await company();
    const other = await company("Other Co");
    await connect(c, "sage");
    const otherToken = await connect(other, "sage");
    const mine = await statement(c);
    const theirs = await statement(other);
    expect(await as(c.olha, () => statements.postStatementToSageAction(mine))).toEqual({ ok: false, error: "Only owners and admins can post to Sage." });
    expect(await as(c.anna, () => statements.postStatementToSageAction(mine))).toEqual({ ok: false, error: "Only owners and admins can post to Sage." });
    expect(await as(c.owner, () => statements.postStatementToSageAction(theirs))).toEqual({ ok: false, error: "Statement not found." });
    expect(sageCalls.get(otherToken) ?? []).toEqual([]);
  });
});

// ===========================================================================

describe.skipIf(!hasPostgrest)("the nightly QuickBooks and Sage catch-up jobs", { timeout: 180_000 }, () => {
  it("quickbooks-reconcile: refuses without the cron secret; books what was sent and missed, skips drafts, voids and the unconnected, and parks what can't be fixed by retrying", async () => {
    expect((await cron(qbReconcile, "/api/cron/quickbooks-reconcile", false)).status).toBe(401);

    const c = await company();
    const realm = await connect(c, "quickbooks");
    const missed = await invoice(c);
    const draft = await invoice(c, { status: "draft" });
    const voided = await invoice(c, { status: "void", voided: true });
    const odd = await invoice(c, { taxBps: 1100 });
    const ancient = await invoice(c, { createdDaysAgo: 120 });
    const lonely = await company("No Books");
    const unconnected = await invoice(lonely);

    const first = await cron(qbReconcile, `/api/cron/quickbooks-reconcile?org_id=${c.org}`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect((await invoiceRow(missed)).quickbooks_invoice_id).toMatch(/^qbinv-/);
    expect((await invoiceRow(draft)).quickbooks_invoice_id).toBeNull();
    expect((await invoiceRow(voided)).quickbooks_invoice_id).toBeNull();
    expect((await invoiceRow(odd)).quickbooks_invoice_id).toBeNull();
    expect((await invoiceRow(ancient)).quickbooks_invoice_id, "older than 90 days needs a person").toBeNull();
    const detail = (first.body.detail as Array<{ synced: number; needs_attention: Array<{ invoice: string; reason: string }> }>)[0];
    expect(detail.synced).toBe(1);
    expect(detail.needs_attention.map((x) => x.invoice)).toEqual([(await invoiceRow(odd)).number]);
    const [{ metadata }] = await api.sql<{ metadata: { reconcile_skip?: Record<string, unknown> } }>(
      "select metadata from public.integration_connections where organization_id = $1 and provider = 'quickbooks'",
      [c.org],
    );
    expect(Object.keys(metadata.reconcile_skip ?? {})).toEqual([odd]);

    const before = posts(qbCalls.get(realm), "/invoice").length;
    const second = await cron(qbReconcile, "/api/cron/quickbooks-reconcile");
    expect(second.status).toBe(200);
    expect(posts(qbCalls.get(realm), "/invoice").length, "nothing booked twice, the parked one left alone").toBe(before);
    expect((await invoiceRow(unconnected)).quickbooks_invoice_id).toBeNull();

    // Once QuickBooks has the rate, ?retry_skipped=1 tries the parked one again.
    await api.sql("update public.invoices set tax_rate_bps = 500, tax_amount_cents = 1500, amount_cents = 31500 where id = $1", [odd]);
    await cron(qbReconcile, `/api/cron/quickbooks-reconcile?org_id=${c.org}&retry_skipped=1`);
    expect((await invoiceRow(odd)).quickbooks_invoice_id).toMatch(/^qbinv-/);
  });

  it("sage-reconcile: refuses without the cron secret; books a missed invoice and a paid run's journal, once, for connected companies only", async () => {
    expect((await cron(sageReconcile, "/api/cron/sage-reconcile", false)).status).toBe(401);
    const c = await company();
    const token = await connect(c, "sage");
    const missed = await invoice(c);
    const draft = await invoice(c, { status: "draft" });
    const run = await paidRun(c);
    const lonely = await company("No Books");
    const unconnected = await invoice(lonely);

    const first = await cron(sageReconcile, `/api/cron/sage-reconcile?org_id=${c.org}`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect((await invoiceRow(missed)).sage_invoice_id).toMatch(/^si-/);
    expect((await invoiceRow(draft)).sage_invoice_id).toBeNull();
    expect(await journalOf(run)).toMatch(/^journal-/);
    const [inv] = posts(sageCalls.get(token), "/sales_invoices");
    const lines = (inv.body as { sales_invoice: { invoice_lines: Array<{ unit_price: number; quantity: number; tax_amount: number }> } }).sales_invoice.invoice_lines;
    expect(lines.reduce((s, l) => s + l.unit_price * l.quantity + l.tax_amount, 0), "the total the client was billed").toBe(315);

    await cron(sageReconcile, "/api/cron/sage-reconcile");
    expect(posts(sageCalls.get(token), "/sales_invoices")).toHaveLength(1);
    expect(posts(sageCalls.get(token), "/journals")).toHaveLength(1);
    expect((await invoiceRow(unconnected)).sage_invoice_id).toBeNull();
  });
});

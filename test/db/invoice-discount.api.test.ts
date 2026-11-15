/**
 * A discount line on an invoice (2026-11-15).
 *
 * Svitlana entered a $200 discount on a move-out clean as a line at -200 and
 * the save was refused: "Price must be > 0". Invoices never had a discount;
 * the database had refused a negative line price since the table was made.
 *
 * The real line save against the real stack (test/db/api.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addOrg } from "./harness";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async () => (await import("./next-stubs")).nextServer());

let api: Api;
let restoreEnv: () => void;
let lines: typeof import("@/lib/invoice-line-items");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  lines = await import("@/lib/invoice-line-items");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

type Row = { label: string; quantity: string; unit_price_dollars: string; booking_id?: string | null };

async function invoice(): Promise<{ org: string; client: string; id: string }> {
  const org = await addOrg(api.sql, "Company");
  const client = await addClient(api.sql, org, "Oliver Little");
  const [inv] = await api.sql<{ id: string }>(
    "insert into public.invoices (organization_id, client_id, status, amount_cents) values ($1, $2, 'sent', 101500) returning id",
    [org, client],
  );
  return { org, client, id: inv.id };
}

async function save(inv: { org: string; id: string }, rows: Row[], taxPercent = "") {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const form = new FormData();
  form.set(
    "line_items_json",
    JSON.stringify(rows.map((r, i) => ({ db_id: null, sort_order: i, booking_id: null, ...r }))),
  );
  form.set("items_tax_rate_percent", taxPercent);
  form.set("items_tax_label", taxPercent ? "GST" : "");
  return lines.reconcileInvoiceLineItems(
    createSupabaseAdminClient(),
    { id: inv.id, organization_id: inv.org, tax_rate_bps: null, tax_label: null },
    form,
  );
}

const stored = (id: string) =>
  api.sql<{ label: string; unit_price_cents: number }>(
    "select label, unit_price_cents from public.invoice_line_items where invoice_id = $1 order by sort_order",
    [id],
  );

describe.skipIf(!hasPostgrest)("a discount line on an invoice", () => {
  it("her invoice: $1,015 move-out clean less $200 saves and comes to $815", async () => {
    const inv = await invoice();
    const res = await save(inv, [
      { label: "Move-out clean · Wed, Oct 28, 2026", quantity: "1", unit_price_dollars: "1,015.00" },
      { label: "Discount", quantity: "1", unit_price_dollars: "-200" },
    ]);
    expect(res, api.log()).toMatchObject({ ok: true, totalCents: 81500, itemCount: 2 });
    expect(await stored(inv.id)).toEqual([
      { label: "Move-out clean · Wed, Oct 28, 2026", unit_price_cents: 101500 },
      { label: "Discount", unit_price_cents: -20000 },
    ]);
  });

  it("tax is worked out on what is left after the discount", async () => {
    const inv = await invoice();
    const res = await save(
      inv,
      [
        { label: "Clean", quantity: "1", unit_price_dollars: "1000" },
        { label: "Discount", quantity: "1", unit_price_dollars: "-200" },
      ],
      "5",
    );
    // $800 + 5% = $840.
    expect(res).toMatchObject({ ok: true, totalCents: 84000, taxAmountCents: 4000 });
  });

  it("discounts that leave nothing to pay are refused in words, and nothing is written", async () => {
    const inv = await invoice();
    const res = await save(inv, [
      { label: "Clean", quantity: "1", unit_price_dollars: "100" },
      { label: "Discount", quantity: "1", unit_price_dollars: "-100" },
    ]);
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain("more than $0");
    expect(await stored(inv.id)).toEqual([]);
  });

  it("a discount can't sit on a job's own line, in the app or in the database", async () => {
    const inv = await invoice();
    const job = await addBooking(api.sql, inv.org, inv.client, {
      scheduledAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      status: "completed",
    });
    const res = await save(inv, [
      { label: "Clean", quantity: "1", unit_price_dollars: "300" },
      { label: "Discount", quantity: "1", unit_price_dollars: "-50", booking_id: job },
    ]);
    expect((res as { error: string }).error).toContain("separate Discount line");

    await expect(
      api.sql(
        "insert into public.invoice_line_items (organization_id, invoice_id, label, quantity, unit_price_cents, booking_id) values ($1, $2, 'x', 1, -500, $3)",
        [inv.org, inv.id, job],
      ),
    ).rejects.toThrow(/invoice_line_items_discount_names_no_job/);
  });

  it("a line at $0 is still refused", async () => {
    const inv = await invoice();
    const res = await save(inv, [
      { label: "Clean", quantity: "1", unit_price_dollars: "300" },
      { label: "Free extra", quantity: "1", unit_price_dollars: "0" },
    ]);
    expect((res as { error: string }).error).toContain("Enter a price for every line");
  });
});

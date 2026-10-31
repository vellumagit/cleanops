/**
 * Money paid "in advance" must not land on an invoice that is already paid.
 * Replays INV-2026-0358 (2026-10-29): $420 owed, $1,260 recorded.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let invoice: Record<string, unknown>;
let payments: Array<{ amount_cents: number; refunded_cents: number | null }> | null;
let paymentsError: { message: string } | null;
let waiting: Array<Record<string, unknown>>;
const paymentInserts: Array<Record<string, unknown>> = [];
const audits: Array<Record<string, unknown>> = [];

vi.mock("@/lib/audit", () => ({
  logSystemAuditEvent: async (a: Record<string, unknown>) => {
    audits.push(a);
  },
}));
vi.mock("@/lib/sage", () => ({ pushInvoicePaymentToSage: async () => {} }));
vi.mock("@/lib/quickbooks", () => ({ pushInvoicePaymentToQuickBooks: async () => {} }));
vi.mock("@/lib/automations", () => ({ autoOnInvoicePaid: async () => {} }));
vi.mock("@/lib/supabase/admin", () => {
  const chain = (result: () => unknown): unknown =>
    new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result());
          if (prop === "maybeSingle" || prop === "single") return async () => result();
          return () => chain(result);
        },
      },
    );
  return {
    createSupabaseAdminClient: () => ({
      from: (table: string) => ({
        select: () => {
          if (table === "invoices") return chain(() => ({ data: invoice, error: null }));
          if (table === "invoice_payments") {
            return chain(() => ({ data: payments, error: paymentsError }));
          }
          if (table === "booking_prepayments") return chain(() => ({ data: waiting, error: null }));
          return chain(() => ({ data: [], error: null }));
        },
        update: () => chain(() => ({ data: [{ id: "claimed" }], error: null })),
        insert: (row: Record<string, unknown>) => {
          paymentInserts.push(row);
          return chain(() => ({ data: { id: "pay" }, error: null }));
        },
      }),
    }),
  };
});

const { applyPrepaymentsToInvoice, prepaymentRefusal } = await import("@/lib/booking-prepayments");

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const prepay = (id: string, amount_cents = 42000) => ({
  id,
  amount_cents,
  method: "bank_transfer",
  reference: "e-transfer",
  notes: null,
  received_at: "2026-10-29T18:00:00Z",
  recorded_by: "m1",
});

describe("prepaymentRefusal", () => {
  const inv = (netPaidCents: number) => ({ number: "INV-2026-0358", amountCents: 42000, netPaidCents });

  it("refuses money on an invoice already paid in full", () => {
    expect(prepaymentRefusal(inv(42000), 42000, money)).toContain("already paid in full");
    expect(prepaymentRefusal(inv(126000), 100, money)).toContain("already paid in full");
  });

  it("refuses more than is owing, and says how much is", () => {
    expect(prepaymentRefusal(inv(40000), 42000, money)).toContain("only has $20.00 left");
  });

  it("allows up to what is owing, counting refunds as owing again", () => {
    expect(prepaymentRefusal(inv(0), 42000, money)).toBeNull();
    expect(prepaymentRefusal(inv(40000), 2000, money)).toBeNull();
  });
});

describe("applyPrepaymentsToInvoice", () => {
  beforeEach(() => {
    invoice = {
      id: "i1",
      number: "INV-2026-0358",
      organization_id: "org",
      booking_id: "b1",
      amount_cents: 42000,
      voided_at: null,
      status: "paid",
    };
    payments = [];
    paymentsError = null;
    waiting = [];
    paymentInserts.length = 0;
    audits.length = 0;
  });

  it("applies money waiting on the job when the invoice is unpaid, and logs it", async () => {
    waiting = [prepay("p1")];
    expect(await applyPrepaymentsToInvoice("i1")).toBe(1);
    expect(paymentInserts).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "mark_paid", entity_id: "i1" });
  });

  it("leaves it on the job when the invoice is already paid", async () => {
    payments = [{ amount_cents: 42000, refunded_cents: 0 }];
    waiting = [prepay("p1"), prepay("p2")];
    expect(await applyPrepaymentsToInvoice("i1")).toBe(0);
    expect(paymentInserts).toHaveLength(0);
  });

  it("stops as soon as the invoice is paid", async () => {
    waiting = [prepay("p1"), prepay("p2")];
    expect(await applyPrepaymentsToInvoice("i1")).toBe(1);
    expect(paymentInserts).toHaveLength(1);
  });

  it("applies nothing when it can't read what's been paid", async () => {
    payments = null;
    paymentsError = { message: "connection reset" };
    waiting = [prepay("p1")];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await applyPrepaymentsToInvoice("i1")).toBe(0);
    expect(paymentInserts).toHaveLength(0);
    errors.mockRestore();
  });
});

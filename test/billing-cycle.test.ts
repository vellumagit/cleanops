/**
 * What the monthly billing run may bill, replayed from the Nov 1, 2026 case:
 * work a person voided and visits already on a live invoice must not come back.
 * The database is stubbed; the route's own decision is what runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Job = {
  id: string;
  status: string;
  total_cents: number;
  scheduled_at: string;
  service_type: string;
  service_type_label: string;
  address: string;
  duration_minutes: number;
  billing_released_at: string | null;
};

const job = (id: string, over: Partial<Job> = {}): Job => ({
  id,
  status: "completed",
  total_cents: 14700,
  scheduled_at: "2026-10-01T16:30:00Z",
  service_type: "standard",
  service_type_label: "Standard clean",
  address: "903 Proctor Wynd NW",
  duration_minutes: 240,
  billing_released_at: null,
  ...over,
});

let jobs: Job[] = [];
let lineLinks: Array<{ booking_id: string; invoice: Record<string, unknown> }> = [];
let lineReadError: { message: string } | null = null;
const invoiceInserts: Array<Record<string, unknown>> = [];
const lineInserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: () => null }));
vi.mock("@/lib/org-timezone", () => ({ getOrgTimezone: async () => "America/Regina" }));
vi.mock("@/lib/booking-prepayments", () => ({ applyPrepaymentsToInvoice: async () => {} }));
vi.mock("@/lib/invoice-send", () => ({ scheduleAutoSendIfEnabled: async () => {} }));
vi.mock("@/lib/supabase/admin", () => {
  const chain = (result: () => unknown, extra: Record<string, unknown> = {}): unknown =>
    new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result());
          if (prop in extra) return extra[prop];
          return () => chain(result, extra);
        },
      },
    );
  return {
    createSupabaseAdminClient: () => ({
      from: (table: string) => ({
        select: (columns: string) => {
          if (table === "organizations") {
            return chain(() => ({
              data: [{ id: "org", name: "Svit", default_tax_rate_bps: null, default_tax_label: null, timezone: "America/Regina" }],
            }));
          }
          if (table === "clients") {
            return chain(() => ({
              data: [{ id: "c1", name: "Promotional Wearhouse", email: "x@y.z", address: null, billing_cadence: "monthly", billing_type: "itemized", flat_rate_cents: null, billing_anchor_day: null, billing_anchor_date: null, organization_id: "org" }],
            }));
          }
          if (table === "invoice_line_items") {
            return chain(() => ({ data: lineReadError ? null : lineLinks, error: lineReadError }));
          }
          if (table === "bookings" && columns.includes("service_type")) {
            return chain(() => ({ data: jobs, error: null }));
          }
          return chain(() => ({ data: [], error: null }));
        },
        insert: (row: Record<string, unknown>) => {
          if (table === "invoices") {
            invoiceInserts.push(row);
            return chain(() => ({ data: { id: "new", number: "INV-NEW" }, error: null }), {
              select: () => ({ single: async () => ({ data: { id: "new", number: "INV-NEW" }, error: null }) }),
            });
          }
          if (table === "invoice_line_items") lineInserts.push(row);
          return chain(() => ({ error: null }));
        },
        update: () => chain(() => ({ data: [], error: null })),
      }),
    }),
  };
});

const { GET } = await import("@/app/api/cron/billing-cycle/route");

const run = () => GET(new Request("https://sollos3.com/api/cron/billing-cycle"));

describe("the monthly billing run", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T07:00:00Z"));
    jobs = [];
    lineLinks = [];
    lineReadError = null;
    invoiceInserts.length = 0;
    lineInserts.length = 0;
  });

  it("bills new work", async () => {
    jobs = [job("oct1"), job("oct15")];
    await run();
    expect(invoiceInserts).toHaveLength(1);
    expect(invoiceInserts[0].amount_cents).toBe(29400);
    expect(lineInserts.map((l) => l.booking_id)).toEqual(["oct1", "oct15"]);
  });

  it("leaves work a person voided, whatever else is on the run", async () => {
    jobs = [job("apr2", { billing_released_at: "2026-10-29T20:21:00Z" }), job("oct1")];
    await run();
    expect(invoiceInserts[0].amount_cents).toBe(14700);
    expect(lineInserts.map((l) => l.booking_id)).toEqual(["oct1"]);
  });

  it("drafts nothing when everything was voided", async () => {
    jobs = [job("apr2", { billing_released_at: "2026-10-29T20:21:00Z" })];
    await run();
    expect(invoiceInserts).toHaveLength(0);
  });

  it("won't bill a visit already on a live invoice with no stamp", async () => {
    jobs = [job("aug6"), job("oct1")];
    lineLinks = [
      { booking_id: "aug6", invoice: { id: "i312", number: 312, status: "overdue", amount_cents: 88200 } },
    ];
    await run();
    expect(lineInserts.map((l) => l.booking_id)).toEqual(["oct1"]);
  });

  it("can bill a job again when the only invoice naming it is void", async () => {
    jobs = [job("oct1")];
    lineLinks = [
      { booking_id: "oct1", invoice: { id: "old", number: 9, status: "void", amount_cents: 14700 } },
    ];
    await run();
    expect(lineInserts.map((l) => l.booking_id)).toEqual(["oct1"]);
  });

  it("bills nothing when it can't check what is already billed", async () => {
    jobs = [job("oct1")];
    lineReadError = { message: "connection reset" };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await run();
    expect(invoiceInserts).toHaveLength(0);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

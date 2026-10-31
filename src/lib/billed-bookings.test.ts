import { describe, it, expect } from "vitest";
import {
  noteBilled,
  billableInSweep,
  matchLineToJob,
  releaseJobsFromVoidedInvoices,
  type BilledBy,
} from "./billed-bookings";

const inv = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "inv1",
  number: 64,
  status: "sent",
  amount_cents: 14175,
  ...over,
});

describe("noteBilled", () => {
  it("records the invoice billing a booking", () => {
    const m = new Map<string, BilledBy>();
    noteBilled(m, "bk1", inv());
    expect(m.get("bk1")).toEqual({
      id: "inv1",
      number: 64,
      status: "sent",
      amountCents: 14175,
    });
  });

  it("IGNORES voided invoices — voiding is how you free a job to be rebilled", () => {
    const m = new Map<string, BilledBy>();
    noteBilled(m, "bk1", inv({ status: "void" }));
    expect(m.has("bk1")).toBe(false);
  });

  it("first writer wins, so the three signals can't fight", () => {
    // invoices.booking_id is read first, then line items, then the stamp.
    // A booking reachable by all three must resolve to ONE answer.
    const m = new Map<string, BilledBy>();
    noteBilled(m, "bk1", inv({ id: "first" }));
    noteBilled(m, "bk1", inv({ id: "second" }));
    noteBilled(m, "bk1", inv({ id: "third" }));
    expect(m.get("bk1")?.id).toBe("first");
  });

  it("a void first does not block a real invoice found later", () => {
    // The void is skipped entirely rather than claiming the slot — otherwise
    // a voided invoice would mask a live one and the job would read unbilled.
    const m = new Map<string, BilledBy>();
    noteBilled(m, "bk1", inv({ id: "voided", status: "void" }));
    noteBilled(m, "bk1", inv({ id: "real" }));
    expect(m.get("bk1")?.id).toBe("real");
  });

  it("skips null bookings and null invoices without throwing", () => {
    const m = new Map<string, BilledBy>();
    noteBilled(m, null, inv());
    noteBilled(m, undefined, inv());
    noteBilled(m, "bk1", null);
    expect(m.size).toBe(0);
  });

  it("treats a missing amount as zero rather than NaN", () => {
    const m = new Map<string, BilledBy>();
    noteBilled(m, "bk1", inv({ amount_cents: null }));
    expect(m.get("bk1")?.amountCents).toBe(0);
  });

  it("keeps a draft distinguishable from a sent invoice", () => {
    // The consolidate panel decides whether a job can be folded in based on
    // this status — a draft can, a sent one must be left alone.
    const m = new Map<string, BilledBy>();
    noteBilled(m, "bk1", inv({ status: "draft" }));
    expect(m.get("bk1")?.status).toBe("draft");
  });
});

describe("billableInSweep", () => {
  const billed = new Map<string, BilledBy>([
    ["on-invoice", { id: "i", number: 1, status: "sent", amountCents: 100 }],
  ]);

  it("keeps only work nobody has billed or voided", () => {
    const rows = [
      { id: "new", billing_released_at: null },
      { id: "voided", billing_released_at: "2026-10-29T20:21:00Z" },
      { id: "on-invoice", billing_released_at: null },
    ];
    expect(billableInSweep(rows, billed).map((r) => r.id)).toEqual(["new"]);
  });
});

describe("matchLineToJob", () => {
  const TZ = "America/Regina";
  const job = (id: string, scheduled_at: string, total_cents: number | null = 14700) => ({
    id,
    scheduled_at,
    total_cents,
  });
  const line = (label: string, over: Partial<{ quantity: number; unit_price_cents: number }> = {}) => ({
    label,
    quantity: 1,
    unit_price_cents: 14700,
    ...over,
  });
  // INV-2026-0312's real hand-added line. It says 10:30; the job moved to 1:30.
  const oct15 = "Standard clean · Thu, Oct 15, 2026, 10:30 AM–2:30 PM · Main address · 903 Proctor Wynd NW";

  it("links on date and price, not time", () => {
    expect(matchLineToJob(line(oct15), [job("a", "2026-10-15T19:30:00Z")], TZ)).toBe("a");
  });

  it("doesn't read Oct 1 out of Oct 15", () => {
    expect(matchLineToJob(line(oct15), [job("oct1", "2026-10-01T16:30:00Z")], TZ)).toBeNull();
  });

  it("uses the org's day, not UTC's", () => {
    // 8 PM Thursday in Alberta is already Friday in UTC.
    const label = "Standard clean · Thu, Oct 15, 2026, 8:00 PM";
    expect(matchLineToJob(line(label), [job("late", "2026-10-16T02:00:00Z")], TZ)).toBe("late");
  });

  it("leaves it alone unless exactly one job fits", () => {
    const two = [job("a", "2026-10-15T16:00:00Z"), job("b", "2026-10-15T19:00:00Z")];
    expect(matchLineToJob(line(oct15), two, TZ)).toBeNull();
    expect(matchLineToJob(line(oct15), [], TZ)).toBeNull();
  });

  it("leaves it alone when the price or quantity differs, or no date is named", () => {
    const jobs = [job("a", "2026-10-15T19:30:00Z")];
    expect(matchLineToJob(line(oct15, { unit_price_cents: 10000 }), jobs, TZ)).toBeNull();
    expect(matchLineToJob(line(oct15, { quantity: 2 }), jobs, TZ)).toBeNull();
    expect(matchLineToJob(line("Extra supplies"), jobs, TZ)).toBeNull();
  });
});

describe("releaseJobsFromVoidedInvoices", () => {
  /** Records every bookings update; the reads answer from `rows`. */
  function fake(rows: { invoices: unknown[]; lines: unknown[] }) {
    const updates: Array<{ set: Record<string, unknown>; filters: Record<string, unknown> }> = [];
    const client = {
      from: (table: string) => ({
        select: () => ({
          in: async () => ({ data: table === "invoices" ? rows.invoices : rows.lines, error: null }),
        }),
        update: (set: Record<string, unknown>) => {
          const entry = { set, filters: {} as Record<string, unknown> };
          updates.push(entry);
          const chain = {
            in: (col: string, v: unknown) => ((entry.filters[col] = v), chain),
            eq: (col: string, v: unknown) => ((entry.filters[col] = v), chain),
            is: (col: string, v: unknown) => ((entry.filters[col] = v), chain),
            then: (resolve: (v: unknown) => void) => resolve({ error: null }),
          };
          return chain;
        },
      }),
    };
    return { client: client as never, updates };
  }

  it("un-stamps and marks stamped jobs, then marks the rest only if unstamped", async () => {
    const { client, updates } = fake({
      invoices: [{ booking_id: "per-job" }, { booking_id: null }],
      lines: [{ booking_id: "on-line" }, { booking_id: "per-job" }],
    });
    await releaseJobsFromVoidedInvoices(client, "org", ["i1"], "NOW");
    expect(updates[0].set).toEqual({ billing_invoice_id: null, billing_released_at: "NOW" });
    expect(updates[0].filters).toEqual({ billing_invoice_id: ["i1"], organization_id: "org" });
    expect(updates[1].set).toEqual({ billing_released_at: "NOW" });
    // Still stamped means another live invoice bills it; hands off.
    expect(updates[1].filters).toEqual({
      id: ["per-job", "on-line"],
      organization_id: "org",
      billing_invoice_id: null,
    });
  });

  it("does nothing for no invoices", async () => {
    const { client, updates } = fake({ invoices: [], lines: [] });
    await releaseJobsFromVoidedInvoices(client, "org", [], "NOW");
    expect(updates).toHaveLength(0);
  });
});

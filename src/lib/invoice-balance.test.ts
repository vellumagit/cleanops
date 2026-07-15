import { describe, it, expect } from "vitest";
import { netPaidCents, outstandingBalanceCents } from "./invoice-balance";

describe("netPaidCents", () => {
  it("sums payments when there are no refunds", () => {
    expect(netPaidCents([{ amount_cents: 6000 }, { amount_cents: 4000 }])).toBe(
      10_000,
    );
  });

  it("subtracts refunds from the collected total", () => {
    // Paid $100, refunded $30 → net $70
    expect(
      netPaidCents([{ amount_cents: 10_000, refunded_cents: 3_000 }]),
    ).toBe(7_000);
  });

  it("treats a full refund as zero net collected", () => {
    expect(
      netPaidCents([{ amount_cents: 10_000, refunded_cents: 10_000 }]),
    ).toBe(0);
  });

  it("handles null/empty inputs safely", () => {
    expect(netPaidCents(null)).toBe(0);
    expect(netPaidCents(undefined)).toBe(0);
    expect(netPaidCents([])).toBe(0);
    expect(netPaidCents([{ amount_cents: null, refunded_cents: null }])).toBe(0);
  });
});

describe("outstandingBalanceCents", () => {
  it("is zero for a fully-paid, un-refunded invoice", () => {
    expect(
      outstandingBalanceCents(10_000, [{ amount_cents: 10_000 }]),
    ).toBe(0);
  });

  it("reopens the full amount after a full refund", () => {
    expect(
      outstandingBalanceCents(10_000, [
        { amount_cents: 10_000, refunded_cents: 10_000 },
      ]),
    ).toBe(10_000);
  });

  it("reflects the remaining balance after a partial refund", () => {
    // Paid in full, then $30 refunded → $30 owed again
    expect(
      outstandingBalanceCents(10_000, [
        { amount_cents: 10_000, refunded_cents: 3_000 },
      ]),
    ).toBe(3_000);
  });

  it("never goes negative on overpayment", () => {
    expect(
      outstandingBalanceCents(10_000, [{ amount_cents: 12_000 }]),
    ).toBe(0);
  });

  it("accounts for partial payments across multiple rows", () => {
    expect(
      outstandingBalanceCents(10_000, [
        { amount_cents: 4_000 },
        { amount_cents: 3_000, refunded_cents: 1_000 },
      ]),
    ).toBe(4_000); // 4000 + (3000-1000) = 6000 net → 4000 owed
  });
});

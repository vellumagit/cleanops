import { describe, it, expect } from "vitest";
import { noteBilled, type BilledBy } from "./billed-bookings";

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

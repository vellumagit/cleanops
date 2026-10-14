import { describe, it, expect } from "vitest";
import { quoteRange } from "./estimate-quote";

describe("quoteRange", () => {
  it("keeps both ranges and says which number the total is", () => {
    const q = quoteRange({
      priceInitialLow: 612,
      priceInitialHigh: 746,
      priceRecurringLow: 362,
      priceRecurringHigh: 442,
      estInitMins: 390,
      estRecurMins: 240,
    });
    expect(q.totalCents).toBe(74600);
    expect(q.summary).toBe("Website quote — first clean: $612–$746, then $362–$442 per visit");
    expect(q.totalNote).toMatch(/^Estimate total set to \$746 \(top of the first-clean range\)/);
    expect(q.timeNote).toBe("Calculator time: first clean ~6.5h, recurring ~4h");
  });

  it("a single price is not shown as a range", () => {
    const q = quoteRange({ priceInitialLow: 300, priceInitialHigh: 300 });
    expect(q.initial).toBe("$300");
    expect(q.recurring).toBeNull();
  });

  it("strings from a urlencoded form work, junk is ignored", () => {
    const q = quoteRange({ priceInitialLow: "200", priceInitialHigh: "abc" });
    expect(q.totalCents).toBe(20000);
    expect(quoteRange({}).summary).toBeNull();
    expect(quoteRange({}).totalCents).toBe(0);
  });
});

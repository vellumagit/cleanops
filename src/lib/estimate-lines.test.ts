import { describe, expect, it } from "vitest";
import {
  estimateLinesHighTotalCents,
  estimateLinesTotalCents,
  highEnd,
  parseEstimateLines,
  priceRangeLabel,
} from "./estimate-lines";

const rows = (list: Array<Record<string, string>>) => JSON.stringify(list);

describe("a price range", () => {
  it("a high end only counts when it is above the low end", () => {
    expect(highEnd(30000, 40000)).toBe(40000);
    expect(highEnd(30000, 30000)).toBeNull();
    expect(highEnd(30000, 20000)).toBeNull();
    expect(highEnd(30000, null)).toBeNull();
    expect(highEnd(30000, undefined)).toBeNull();
    expect(highEnd(0, 5000)).toBe(5000);
  });

  it("reads as one amount, or as low – high", () => {
    expect(priceRangeLabel(30000, null, "CAD")).toBe("$300.00");
    expect(priceRangeLabel(30000, 30000, "CAD")).toBe("$300.00");
    expect(priceRangeLabel(30000, 40000, "CAD")).toBe("$300.00 – $400.00");
    expect(priceRangeLabel(0, 5000, "USD")).toBe("$0.00 – $50.00");
  });

  it("the high total counts a fixed line at its one price, and is null when no line has a range", () => {
    const lines = [
      { quantity: 1, unit_price_cents: 30000, unit_price_high_cents: 40000 },
      { quantity: 2, unit_price_cents: 3000, unit_price_high_cents: null },
      { quantity: 1.5, unit_price_cents: 2000, unit_price_high_cents: 3000 },
    ];
    expect(estimateLinesTotalCents(lines)).toBe(39000);
    expect(estimateLinesHighTotalCents(lines)).toBe(50500);
    expect(estimateLinesHighTotalCents(lines.map((l) => ({ ...l, unit_price_high_cents: null })))).toBeNull();
    expect(estimateLinesHighTotalCents([])).toBeNull();
  });
});

describe("reading the form's lines with a range", () => {
  const line = { label: "Deep clean", quantity: "1", unit_price_dollars: "300", unit_price_high_dollars: "400" };

  it("keeps the high price only when the range tick is on", () => {
    expect(parseEstimateLines(rows([line]), { range: true }).lines).toEqual([
      { label: "Deep clean", quantity: 1, unit_price_cents: 30000, unit_price_high_cents: 40000, sort_order: 0 },
    ]);
    expect(parseEstimateLines(rows([line])).lines[0].unit_price_high_cents).toBeNull();
    expect(parseEstimateLines(rows([line]), { range: false }).lines[0].unit_price_high_cents).toBeNull();
  });

  it("an empty or equal high price is a fixed line; a lower or unreadable one is refused by name", () => {
    const read = (high: string) => parseEstimateLines(rows([{ ...line, unit_price_high_dollars: high }]), { range: true });
    expect(read("").lines[0].unit_price_high_cents).toBeNull();
    expect(read("300").lines[0].unit_price_high_cents).toBeNull();
    expect(read("$1,200.50").lines[0].unit_price_high_cents).toBe(120050);
    expect(read("299.99")).toEqual({ lines: [], error: '"Deep clean": the high price is below the low price.' });
    expect(read("lots")).toEqual({ lines: [], error: '"Deep clean" has a high price that isn\'t a number.' });
    expect(read("2000000").error).toBe('"Deep clean" is too large.');
  });

  it("a row with only a high price typed is still a blank row", () => {
    expect(parseEstimateLines(rows([{ label: "", quantity: "1", unit_price_dollars: "", unit_price_high_dollars: "" }]), { range: true })).toEqual({
      lines: [],
    });
  });
});

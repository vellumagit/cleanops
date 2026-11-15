import { describe, expect, it } from "vitest";
import { spreadDiscounts, type BooksLine } from "./invoice-discount";

const total = (lines: BooksLine[]) => lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPriceCents), 0);

describe("spreadDiscounts", () => {
  it("leaves an invoice with no discount exactly as it is", () => {
    const lines = [{ description: "Clean", quantity: 2, unitPriceCents: 5000 }];
    expect(spreadDiscounts(lines)).toEqual(lines);
  });

  it("one job less $200: one positive line for what is left", () => {
    const out = spreadDiscounts([
      { description: "Move-out clean", quantity: 1, unitPriceCents: 101500 },
      { description: "Discount", quantity: 1, unitPriceCents: -20000 },
    ]);
    expect(out).toEqual([{ description: "Move-out clean (less discount)", quantity: 1, unitPriceCents: 81500 }]);
  });

  it("spreads across several lines in proportion, never negative, and to the cent", () => {
    const lines = [
      { description: "A", quantity: 3, unitPriceCents: 3333 },
      { description: "B", quantity: 1, unitPriceCents: 14175 },
      { description: "C", quantity: 1, unitPriceCents: 701 },
      { description: "Discount", quantity: 1, unitPriceCents: -1001 },
    ];
    const out = spreadDiscounts(lines);
    expect(out).toHaveLength(3);
    expect(out.every((l) => l.unitPriceCents > 0 && l.quantity === 1)).toBe(true);
    expect(total(out)).toBe(total(lines));
  });

  it("two discounts are taken together", () => {
    const lines = [
      { description: "A", quantity: 1, unitPriceCents: 10000 },
      { description: "Loyalty", quantity: 1, unitPriceCents: -1000 },
      { description: "Sorry we were late", quantity: 1, unitPriceCents: -500 },
    ];
    expect(spreadDiscounts(lines)).toEqual([{ description: "A (less discount)", quantity: 1, unitPriceCents: 8500 }]);
  });

  it("a discount as large as everything else leaves one line, never a negative one", () => {
    const out = spreadDiscounts([
      { description: "A", quantity: 1, unitPriceCents: 5000 },
      { description: "Discount", quantity: 1, unitPriceCents: -5000 },
    ]);
    expect(out).toEqual([{ description: "Services (after discount)", quantity: 1, unitPriceCents: 0 }]);
  });
});

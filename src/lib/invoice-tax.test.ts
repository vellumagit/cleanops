import { describe, it, expect } from "vitest";
import { computeTax, formatTaxRate, parseTaxRate } from "./invoice-tax";

describe("computeTax", () => {
  it("returns a no-tax breakdown when rate is null/0/negative", () => {
    for (const rate of [null, undefined, 0, -100]) {
      const r = computeTax(10_000, { rateBps: rate as number | null });
      expect(r.taxAmountCents).toBeNull();
      expect(r.rateBps).toBeNull();
      expect(r.totalCents).toBe(10_000);
    }
  });

  it("applies a bps rate and rounds to the nearest cent", () => {
    // 13% HST on $100.00 = $13.00
    expect(computeTax(10_000, { rateBps: 1300 })).toMatchObject({
      taxAmountCents: 1_300,
      totalCents: 11_300,
      rateBps: 1300,
    });
    // 5% GST on $19.99 = 99.95¢ → rounds to $1.00
    expect(computeTax(1_999, { rateBps: 500 }).taxAmountCents).toBe(100);
    // rounds half to nearest: 12.5% on $1.00 = 12.5¢ → 13¢ (Math.round)
    expect(computeTax(100, { rateBps: 1250 }).taxAmountCents).toBe(13);
  });

  it("keeps totals as integer cents (no float drift)", () => {
    const r = computeTax(3_333, { rateBps: 875 }); // 8.75%
    expect(Number.isInteger(r.taxAmountCents!)).toBe(true);
    expect(Number.isInteger(r.totalCents)).toBe(true);
    expect(r.totalCents).toBe(r.subtotalCents + r.taxAmountCents!);
  });
});

describe("formatTaxRate", () => {
  it("formats bps and trims trailing zeros", () => {
    expect(formatTaxRate(500)).toBe("5%");
    expect(formatTaxRate(1250)).toBe("12.5%");
    expect(formatTaxRate(1300)).toBe("13%");
    expect(formatTaxRate(875)).toBe("8.75%");
  });

  it("returns empty string for null/0", () => {
    expect(formatTaxRate(null)).toBe("");
    expect(formatTaxRate(0)).toBe("");
    expect(formatTaxRate(undefined)).toBe("");
  });
});

describe("parseTaxRate", () => {
  it("parses percent strings into bps", () => {
    expect(parseTaxRate("5")).toBe(500);
    expect(parseTaxRate("12.5")).toBe(1250);
    expect(parseTaxRate(" 8.75 ")).toBe(875);
  });

  it("returns null for empty/invalid/negative input", () => {
    for (const v of ["", "  ", null, undefined, "abc", "-5"]) {
      expect(parseTaxRate(v as string | null)).toBeNull();
    }
  });

  it("caps at the DB max of 99.99% (9999 bps)", () => {
    expect(parseTaxRate("150")).toBe(9999);
    expect(parseTaxRate("99.99")).toBe(9999);
  });
});

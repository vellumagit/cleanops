import { describe, it, expect } from "vitest";
import {
  allocateLineTax,
  sageRatePercent,
  type SageTaxRate,
} from "./sage-rate";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("allocateLineTax", () => {
  it("puts all the tax on a single line", () => {
    expect(allocateLineTax([40000], 3200)).toEqual([3200]);
  });

  it("is all zeros for an untaxed invoice", () => {
    expect(allocateLineTax([1000, 2000, 3000], 0)).toEqual([0, 0, 0]);
  });

  it("splits evenly when the lines are equal", () => {
    expect(allocateLineTax([10000, 10000], 1000)).toEqual([500, 500]);
  });

  it("allocates proportionally to line size", () => {
    expect(allocateLineTax([10000, 30000], 4000)).toEqual([1000, 3000]);
  });

  // The whole point: pennies must not go missing.
  it("sums EXACTLY to the invoice tax even when it doesn't divide evenly", () => {
    const lines = [3333, 3333, 3334];
    const out = allocateLineTax(lines, 1001);
    expect(sum(out)).toBe(1001);
  });

  it("stays exact across a range of awkward splits", () => {
    for (const tax of [1, 7, 99, 1001, 12345]) {
      for (const lines of [[1, 1, 1], [100, 3, 7], [5000, 1], [7, 11, 13, 17]]) {
        expect(sum(allocateLineTax(lines, tax))).toBe(tax);
      }
    }
  });

  it("doesn't divide by zero when every line is free", () => {
    expect(allocateLineTax([0, 0], 0)).toEqual([0, 0]);
  });

  it("returns nothing for no lines", () => {
    expect(allocateLineTax([], 500)).toEqual([]);
  });
});

const ON = "2026-07-29";

describe("sageRatePercent", () => {
  // The live bug: Sage sends "5.0", and the old matcher required a number.
  it("parses a string percentage", () => {
    expect(sageRatePercent({ id: "GST", percentage: "5.0" }, ON)).toBe(5);
  });

  it("accepts a numeric percentage too", () => {
    expect(sageRatePercent({ id: "GST", percentage: 5 }, ON)).toBe(5);
  });

  it("reads zero as zero, not as missing", () => {
    expect(sageRatePercent({ id: "CA_NO_TAX", percentage: "0.0" }, ON)).toBe(0);
  });

  // Without attributes=all, Sage omits the field entirely.
  it("returns null when Sage sent no percentage at all", () => {
    expect(sageRatePercent({ id: "CA_NO_TAX" }, ON)).toBeNull();
  });

  it("returns null for an unparseable value", () => {
    expect(sageRatePercent({ id: "X", percentage: "n/a" }, ON)).toBeNull();
  });

  it("prefers the dated entry effective on the invoice date", () => {
    const rate: SageTaxRate = {
      id: "HST",
      percentage: "15.0",
      percentages: [
        { percentage: "13.0", from_date: "1900-01-01", to_date: "2026-06-30" },
        { percentage: "15.0", from_date: "2026-07-01", to_date: null },
      ],
    };
    expect(sageRatePercent(rate, "2026-07-29")).toBe(15);
    expect(sageRatePercent(rate, "2026-01-15")).toBe(13);
  });

  it("falls back to the scalar when no dated entry covers the date", () => {
    const rate: SageTaxRate = {
      id: "GST",
      percentage: "5.0",
      percentages: [
        { percentage: "7.0", from_date: "1990-01-01", to_date: "1999-12-31" },
      ],
    };
    expect(sageRatePercent(rate, ON)).toBe(5);
  });

  it("treats open-ended ranges as still in effect", () => {
    const rate: SageTaxRate = {
      id: "GST",
      percentages: [{ percentage: "5.0", from_date: "1900-01-01", to_date: null }],
    };
    expect(sageRatePercent(rate, ON)).toBe(5);
  });
});

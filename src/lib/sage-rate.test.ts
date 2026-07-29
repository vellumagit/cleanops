import { describe, it, expect } from "vitest";
import { sageRatePercent, type SageTaxRate } from "./sage-rate";

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

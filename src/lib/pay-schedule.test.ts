import { describe, expect, it } from "vitest";
import { suggestedPayPeriod } from "./pay-schedule";

describe("suggestedPayPeriod — semimonthly (1–15 & 16–end)", () => {
  it("mid-month suggests the 16th–EOM of the PREVIOUS month", () => {
    const p = suggestedPayPeriod("semimonthly", null, "2026-09-10", null);
    expect(p).toEqual({ start: "2026-08-16", end: "2026-08-31", complete: true });
  });

  it("late month suggests the 1st–15th of THIS month", () => {
    const p = suggestedPayPeriod("semimonthly", null, "2026-09-20", null);
    expect(p).toEqual({ start: "2026-09-01", end: "2026-09-15", complete: true });
  });

  it("when the completed period is already covered, suggests the in-progress one", () => {
    const p = suggestedPayPeriod("semimonthly", null, "2026-09-20", "2026-09-15");
    expect(p).toEqual({ start: "2026-09-16", end: "2026-09-30", complete: false });
  });

  it("February month-end is right", () => {
    const p = suggestedPayPeriod("semimonthly", null, "2026-03-02", null);
    expect(p).toEqual({ start: "2026-02-16", end: "2026-02-28", complete: true });
  });

  it("leap-year February too", () => {
    const p = suggestedPayPeriod("semimonthly", null, "2028-03-02", null);
    expect(p).toEqual({ start: "2028-02-16", end: "2028-02-29", complete: true });
  });
});

describe("suggestedPayPeriod — monthly", () => {
  it("suggests the previous calendar month", () => {
    const p = suggestedPayPeriod("monthly", null, "2026-09-03", null);
    expect(p).toEqual({ start: "2026-08-01", end: "2026-08-31", complete: true });
  });
});

describe("suggestedPayPeriod — biweekly from an anchor", () => {
  // Anchor: Monday 2026-08-03 was a real period start → periods
  // Aug 3–16, Aug 17–30, Aug 31–Sep 13, …
  it("suggests the last completed 14-day cycle", () => {
    const p = suggestedPayPeriod("biweekly", "2026-08-03", "2026-09-02", null);
    expect(p).toEqual({ start: "2026-08-17", end: "2026-08-30", complete: true });
  });

  it("covered cycle rolls forward to the in-progress one", () => {
    const p = suggestedPayPeriod(
      "biweekly",
      "2026-08-03",
      "2026-09-02",
      "2026-08-30",
    );
    expect(p).toEqual({ start: "2026-08-31", end: "2026-09-13", complete: false });
  });

  it("a today BEFORE the anchor still resolves a sane window", () => {
    const p = suggestedPayPeriod("biweekly", "2026-08-03", "2026-07-25", null);
    expect(p.start < p.end).toBe(true);
    expect(p.complete).toBe(true);
  });
});

describe("suggestedPayPeriod — weekly", () => {
  it("suggests the last completed 7-day cycle", () => {
    // Anchor Monday 2026-08-03 → weeks Mon–Sun. Today Wed Sep 2 →
    // last complete week is Aug 24–30.
    const p = suggestedPayPeriod("weekly", "2026-08-03", "2026-09-02", null);
    expect(p).toEqual({ start: "2026-08-24", end: "2026-08-30", complete: true });
  });
});

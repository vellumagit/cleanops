import { describe, it, expect } from "vitest";
import {
  monthlyAnchorPeriodEnding,
  biweeklyAnchorPeriodEnding,
  weeklyAnchorPeriodEnding,
  isValidAnchorDay,
} from "./billing-anchor";

describe("monthlyAnchorPeriodEnding", () => {
  it("fires on the anchor day and bills the previous full cycle", () => {
    expect(monthlyAnchorPeriodEnding("2026-08-15", 15)).toEqual({
      startYmd: "2026-07-15",
      endYmdExclusive: "2026-08-15",
      key: "anchor-monthly:2026-07-15",
      label: "Jul 15 – Aug 14, 2026",
    });
  });

  it("stays silent every other day of the month", () => {
    expect(monthlyAnchorPeriodEnding("2026-08-14", 15)).toBeNull();
    expect(monthlyAnchorPeriodEnding("2026-08-16", 15)).toBeNull();
    expect(monthlyAnchorPeriodEnding("2026-08-01", 15)).toBeNull();
  });

  it("crosses a year boundary without drama", () => {
    expect(monthlyAnchorPeriodEnding("2026-01-20", 20)).toEqual({
      startYmd: "2025-12-20",
      endYmdExclusive: "2026-01-20",
      key: "anchor-monthly:2025-12-20",
      label: "Dec 20 – Jan 19, 2026",
    });
  });

  it("handles February because the 28 cap makes it ordinary", () => {
    // Anchor 28: Jan 28 → Feb 28 in a non-leap year. No clamping rules,
    // because a day that would need clamping cannot be chosen.
    expect(monthlyAnchorPeriodEnding("2026-02-28", 28)).toEqual({
      startYmd: "2026-01-28",
      endYmdExclusive: "2026-02-28",
      key: "anchor-monthly:2026-01-28",
      label: "Jan 28 – Feb 27, 2026",
    });
  });

  it("refuses out-of-range anchors rather than guessing", () => {
    expect(monthlyAnchorPeriodEnding("2026-08-29", 29)).toBeNull();
    expect(monthlyAnchorPeriodEnding("2026-08-31", 31)).toBeNull();
    expect(monthlyAnchorPeriodEnding("2026-08-15", 0)).toBeNull();
  });

  it("anchor day 1 reproduces a calendar month", () => {
    expect(monthlyAnchorPeriodEnding("2026-09-01", 1)).toEqual({
      startYmd: "2026-08-01",
      endYmdExclusive: "2026-09-01",
      key: "anchor-monthly:2026-08-01",
      label: "Aug 1 – Aug 31, 2026",
    });
  });
});

describe("biweeklyAnchorPeriodEnding", () => {
  it("fires every 14 days from the anchor, billing the closed cycle", () => {
    expect(biweeklyAnchorPeriodEnding("2026-08-29", "2026-08-15")).toEqual({
      startYmd: "2026-08-15",
      endYmdExclusive: "2026-08-29",
      key: "anchor-biweekly:2026-08-15",
      label: "Aug 15 – Aug 28, 2026",
    });
    // Two cycles on: fires again.
    expect(biweeklyAnchorPeriodEnding("2026-09-12", "2026-08-15")).toEqual({
      startYmd: "2026-08-29",
      endYmdExclusive: "2026-09-12",
      key: "anchor-biweekly:2026-08-29",
      label: "Aug 29 – Sep 11, 2026",
    });
  });

  it("is silent on the anchor day itself — no bill for a cycle that just began", () => {
    expect(biweeklyAnchorPeriodEnding("2026-08-15", "2026-08-15")).toBeNull();
  });

  it("is silent on non-cycle days", () => {
    expect(biweeklyAnchorPeriodEnding("2026-08-28", "2026-08-15")).toBeNull();
    expect(biweeklyAnchorPeriodEnding("2026-08-30", "2026-08-15")).toBeNull();
  });

  it("a future anchor is simply not due yet", () => {
    expect(biweeklyAnchorPeriodEnding("2026-08-15", "2026-09-01")).toBeNull();
  });

  it("keeps exact 14-day cycles across a DST change", () => {
    // North American spring-forward (Mar 8 2026). Noon-UTC arithmetic means
    // the 23-hour local day cannot shift the cycle.
    expect(biweeklyAnchorPeriodEnding("2026-03-15", "2026-03-01")).toEqual({
      startYmd: "2026-03-01",
      endYmdExclusive: "2026-03-15",
      key: "anchor-biweekly:2026-03-01",
      label: "Mar 1 – Mar 14, 2026",
    });
  });
});

describe("weeklyAnchorPeriodEnding", () => {
  it("fires every 7 days from the anchor, billing the closed cycle", () => {
    expect(weeklyAnchorPeriodEnding("2026-08-22", "2026-08-15")).toEqual({
      startYmd: "2026-08-15",
      endYmdExclusive: "2026-08-22",
      key: "anchor-weekly:2026-08-15",
      label: "Aug 15 – Aug 21, 2026",
    });
    // Three cycles on: fires again.
    expect(weeklyAnchorPeriodEnding("2026-09-05", "2026-08-15")).toEqual({
      startYmd: "2026-08-29",
      endYmdExclusive: "2026-09-05",
      key: "anchor-weekly:2026-08-29",
      label: "Aug 29 – Sep 4, 2026",
    });
  });

  it("is silent on the anchor day itself and on non-cycle days", () => {
    expect(weeklyAnchorPeriodEnding("2026-08-15", "2026-08-15")).toBeNull();
    expect(weeklyAnchorPeriodEnding("2026-08-21", "2026-08-15")).toBeNull();
    expect(weeklyAnchorPeriodEnding("2026-08-23", "2026-08-15")).toBeNull();
  });

  it("a future anchor is simply not due yet", () => {
    expect(weeklyAnchorPeriodEnding("2026-08-15", "2026-09-01")).toBeNull();
  });

  it("a weekly boundary that is also a biweekly boundary keys differently", () => {
    // Day 14 from an anchor satisfies BOTH strides; the key prefix keeps a
    // client switched between cadences from colliding on the same period.
    const w = weeklyAnchorPeriodEnding("2026-08-29", "2026-08-15");
    const b = biweeklyAnchorPeriodEnding("2026-08-29", "2026-08-15");
    expect(w?.key).toBe("anchor-weekly:2026-08-22");
    expect(b?.key).toBe("anchor-biweekly:2026-08-15");
  });
});

describe("key formats never collide with legacy", () => {
  it("prefixes both cadences with anchor-", () => {
    // Legacy keys are `monthly:YYYY-MM` and `biweekly:<period END ymd>`.
    // The dangerous case: a client billed 1st–14th Aug the legacy way holds
    // `biweekly:2026-08-15`; an anchored period STARTING Aug 15 must not
    // produce that same string, or its first invoice is silently skipped
    // as a duplicate.
    const m = monthlyAnchorPeriodEnding("2026-08-15", 15);
    const b = biweeklyAnchorPeriodEnding("2026-08-29", "2026-08-15");
    expect(m?.key.startsWith("anchor-monthly:")).toBe(true);
    expect(b?.key.startsWith("anchor-biweekly:")).toBe(true);
    expect(b?.key).not.toBe("biweekly:2026-08-15");
  });
});

describe("isValidAnchorDay", () => {
  it("accepts 1 through 28 and nothing else", () => {
    expect(isValidAnchorDay(1)).toBe(true);
    expect(isValidAnchorDay(28)).toBe(true);
    expect(isValidAnchorDay(0)).toBe(false);
    expect(isValidAnchorDay(29)).toBe(false);
    expect(isValidAnchorDay("15")).toBe(true);
    expect(isValidAnchorDay(null)).toBe(false);
    expect(isValidAnchorDay(14.5)).toBe(false);
  });
});

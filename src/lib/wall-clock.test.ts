import { describe, it, expect } from "vitest";
import {
  nextDayAtHourUtc,
  zonedDayBoundsUtc,
  formatHourLabel,
  zonedYmd,
  zonedMidnightUtc,
  startOfWeekUtc,
  zonedDayStartUtc,
} from "./wall-clock";

const EDM = "America/Edmonton"; // MDT (UTC-6) summer / MST (UTC-7) winter
const REG = "America/Regina"; // CST (UTC-6) year-round, no DST

describe("nextDayAtHourUtc", () => {
  it("summer (MDT): job at 2 PM Jul 26 → 5 PM Jul 27 = 23:00 UTC", () => {
    const from = new Date("2026-07-26T20:00:00Z"); // 2 PM MDT
    expect(nextDayAtHourUtc(from, EDM, 17).toISOString()).toBe(
      "2026-07-27T23:00:00.000Z",
    );
  });

  it("winter (MST): job on Jan 10 → 5 PM Jan 11 = 00:00 UTC Jan 12", () => {
    const from = new Date("2026-01-10T20:00:00Z"); // 1 PM MST
    expect(nextDayAtHourUtc(from, EDM, 17).toISOString()).toBe(
      "2026-01-12T00:00:00.000Z",
    );
  });

  it("late-evening job still lands on the NEXT local day, not the day after", () => {
    // 11:30 PM MDT Jul 26 = 05:30 UTC Jul 27 — local day is still the 26th.
    const from = new Date("2026-07-27T05:30:00Z");
    expect(nextDayAtHourUtc(from, EDM, 17).toISOString()).toBe(
      "2026-07-27T23:00:00.000Z",
    );
  });

  it("crosses the spring-forward DST transition correctly", () => {
    // Mar 7 2026 in Edmonton (MST, UTC-7); Mar 8 2 AM clocks jump to MDT.
    // 5 PM Mar 8 MDT = 23:00 UTC (not 00:00 next day).
    const from = new Date("2026-03-07T19:00:00Z");
    expect(nextDayAtHourUtc(from, EDM, 17).toISOString()).toBe(
      "2026-03-08T23:00:00.000Z",
    );
  });

  it("crosses the fall-back DST transition correctly", () => {
    // Oct 31 2026 (MDT, UTC-6); Nov 1 clocks fall back to MST (UTC-7).
    // 5 PM Nov 1 MST = 00:00 UTC Nov 2.
    const from = new Date("2026-10-31T18:00:00Z");
    expect(nextDayAtHourUtc(from, EDM, 17).toISOString()).toBe(
      "2026-11-02T00:00:00.000Z",
    );
  });

  it("no-DST zone (Regina) is a flat UTC-6 year-round", () => {
    const summer = new Date("2026-07-26T20:00:00Z");
    const winter = new Date("2026-01-10T20:00:00Z");
    expect(nextDayAtHourUtc(summer, REG, 9).toISOString()).toBe(
      "2026-07-27T15:00:00.000Z",
    );
    expect(nextDayAtHourUtc(winter, REG, 9).toISOString()).toBe(
      "2026-01-11T15:00:00.000Z",
    );
  });

  it("rolls over month and year boundaries", () => {
    const from = new Date("2026-12-31T20:00:00Z"); // Dec 31, 1 PM MST
    expect(nextDayAtHourUtc(from, EDM, 8).toISOString()).toBe(
      "2027-01-01T15:00:00.000Z",
    );
  });
});

describe("zonedDayBoundsUtc", () => {
  it("yesterday in Edmonton summer = [06:00 UTC, 06:00 UTC next day)", () => {
    // Jul 27 10 AM MDT → yesterday = Jul 26 local.
    const now = new Date("2026-07-27T16:00:00Z");
    const { start, end } = zonedDayBoundsUtc(now, EDM, -1);
    expect(start.toISOString()).toBe("2026-07-26T06:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-27T06:00:00.000Z");
  });

  it("fall-back day is 25 hours long and the bounds reflect it", () => {
    // Nov 1 2026: starts at 06:00 UTC (MDT midnight), next midnight is
    // 07:00 UTC (MST) — a 25h local day.
    const now = new Date("2026-11-02T18:00:00Z");
    const { start, end } = zonedDayBoundsUtc(now, EDM, -1);
    expect(start.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T07:00:00.000Z");
  });

  it("today (offset 0) contains 'now'", () => {
    const now = new Date("2026-07-27T16:00:00Z");
    const { start, end } = zonedDayBoundsUtc(now, EDM, 0);
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(end.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("formatHourLabel", () => {
  it("formats 12-hour labels", () => {
    expect(formatHourLabel(0)).toBe("12:00 AM");
    expect(formatHourLabel(9)).toBe("9:00 AM");
    expect(formatHourLabel(12)).toBe("12:00 PM");
    expect(formatHourLabel(17)).toBe("5:00 PM");
    expect(formatHourLabel(23)).toBe("11:00 PM");
  });
});

const TOR = "America/Toronto"; // UTC-4 in August (EDT)

describe("zonedYmd", () => {
  it("gives the org's calendar day, not the server's", () => {
    // 2026-08-05 01:00 UTC is still Aug 4 in Edmonton. Bucketing on the raw
    // UTC string filed evening jobs under the next day's heading while the
    // card beneath printed today's time.
    const evening = new Date("2026-08-05T01:00:00Z");
    expect(zonedYmd(evening, EDM)).toBe("2026-08-04");
    expect(zonedYmd(evening, TOR)).toBe("2026-08-04");
    expect(zonedYmd(evening, "UTC")).toBe("2026-08-05");
  });

  it("rolls over at local midnight, not UTC midnight", () => {
    expect(zonedYmd(new Date("2026-08-05T05:59:00Z"), EDM)).toBe("2026-08-04");
    expect(zonedYmd(new Date("2026-08-05T06:00:00Z"), EDM)).toBe("2026-08-05");
  });
});

describe("zonedMidnightUtc", () => {
  it("resolves local midnight to the right UTC instant", () => {
    expect(zonedMidnightUtc("2026-08-05", EDM).toISOString()).toBe(
      "2026-08-05T06:00:00.000Z",
    );
    expect(zonedMidnightUtc("2026-08-05", TOR).toISOString()).toBe(
      "2026-08-05T04:00:00.000Z",
    );
  });

  it("reads the offset at the instant rather than assuming one", () => {
    // MST in January, UTC-7.
    expect(zonedMidnightUtc("2026-01-15", EDM).toISOString()).toBe(
      "2026-01-15T07:00:00.000Z",
    );
  });

  it("is unaffected by DST in a zone that has none", () => {
    expect(zonedMidnightUtc("2026-08-05", REG).toISOString()).toBe(
      "2026-08-05T06:00:00.000Z",
    );
    expect(zonedMidnightUtc("2026-01-15", REG).toISOString()).toBe(
      "2026-01-15T06:00:00.000Z",
    );
  });
});

describe("startOfWeekUtc", () => {
  it("finds Monday 00:00 LOCAL, which is not UTC midnight", () => {
    // The defect this replaces: the old helper round-tripped through a locale
    // string and landed on UTC midnight — Sunday 18:00 in Edmonton — so a
    // Sunday-evening shift was counted in the previous pay week.
    const wed = new Date("2026-08-05T20:00:00Z"); // Wed, 2 PM MDT
    expect(startOfWeekUtc(wed, EDM).toISOString()).toBe(
      "2026-08-03T06:00:00.000Z",
    );
  });

  it("keeps a Sunday-evening shift in the week that is ending", () => {
    // Sun Aug 9, 7 PM Edmonton = Aug 10 01:00 UTC.
    const sundayEvening = new Date("2026-08-10T01:00:00Z");
    expect(startOfWeekUtc(sundayEvening, EDM).toISOString()).toBe(
      "2026-08-03T06:00:00.000Z",
    );
  });

  it("treats Monday as the start of its own week", () => {
    const mondayMorning = new Date("2026-08-03T15:00:00Z"); // 9 AM MDT
    expect(startOfWeekUtc(mondayMorning, EDM).toISOString()).toBe(
      "2026-08-03T06:00:00.000Z",
    );
  });

  it("crosses a month boundary without losing the week", () => {
    const tue = new Date("2026-09-01T18:00:00Z");
    expect(startOfWeekUtc(tue, EDM).toISOString()).toBe(
      "2026-08-31T06:00:00.000Z",
    );
  });
});

describe("zonedDayStartUtc", () => {
  it("offsets by LOCAL days, so a 7-day window really spans seven", () => {
    const now = new Date("2026-08-04T18:00:00Z"); // Tue noon MDT
    const start = zonedDayStartUtc(now, EDM, 1);
    const end = zonedDayStartUtc(now, EDM, 8);
    expect(start.toISOString()).toBe("2026-08-05T06:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-12T06:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 3600_000);
  });

  it("goes backwards for a trailing window", () => {
    const now = new Date("2026-08-04T18:00:00Z");
    expect(zonedDayStartUtc(now, EDM, -30).toISOString()).toBe(
      "2026-07-05T06:00:00.000Z",
    );
  });
});

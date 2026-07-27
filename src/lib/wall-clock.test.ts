import { describe, it, expect } from "vitest";
import {
  nextDayAtHourUtc,
  zonedDayBoundsUtc,
  formatHourLabel,
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

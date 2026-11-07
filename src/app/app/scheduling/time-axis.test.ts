import { describe, expect, it } from "vitest";
import {
  dateKey,
  formatHourLabel,
  formatTimeLabel,
  minutesOfDay,
} from "./time-axis";

describe("scheduling time axis", () => {
  it("uses the requested timezone when deriving a booking day", () => {
    expect(dateKey(new Date("2026-11-07T01:00:00.000Z"), "America/Edmonton"))
      .toBe("2026-11-06");
  });

  it("uses local calendar fields when no timezone is supplied", () => {
    expect(dateKey(new Date(2026, 10, 7))).toBe("2026-11-07");
  });

  it("derives minutes from midnight in the requested timezone", () => {
    expect(minutesOfDay("2026-11-07T01:05:00.000Z", "UTC")).toBe(65);
  });

  it("formats hour and time labels consistently", () => {
    expect(formatHourLabel(0)).toBe("12 AM");
    expect(formatHourLabel(12)).toBe("12 PM");
    expect(formatTimeLabel(0)).toBe("12 AM");
    expect(formatTimeLabel(12 * 60 + 5)).toBe("12:05 PM");
    expect(formatTimeLabel(14 * 60)).toBe("2 PM");
  });
});

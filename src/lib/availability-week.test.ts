import { describe, expect, it } from "vitest";
import {
  WEEK_DAYS,
  hoursError,
  overlapError,
  timeLabel,
  toHHMM,
  weekdayTemplate,
} from "./availability-week";

describe("toHHMM", () => {
  it("accepts a time with or without seconds", () => {
    expect(toHHMM("09:00:00")).toBe("09:00");
    expect(toHHMM("17:30:00.000")).toBe("17:30");
    expect(toHHMM("09:00")).toBe("09:00");
    expect(toHHMM(" 23:59 ")).toBe("23:59");
  });

  it("refuses what is not a time of day", () => {
    for (const bad of ["", "9:00", "24:00", "12:60", "noon", null, undefined]) {
      expect(toHHMM(bad)).toBeNull();
    }
  });
});

describe("timeLabel", () => {
  it("writes times the way people say them", () => {
    expect(timeLabel("09:00:00")).toBe("9:00 AM");
    expect(timeLabel("13:30")).toBe("1:30 PM");
    expect(timeLabel("00:15")).toBe("12:15 AM");
    expect(timeLabel("12:00")).toBe("12:00 PM");
  });
});

describe("hoursError", () => {
  it("passes a start before an end, in either format", () => {
    expect(hoursError("09:00", "17:00")).toBeNull();
    expect(hoursError("09:00:00", "17:00:00")).toBeNull();
  });

  it("says what is wrong otherwise", () => {
    expect(hoursError("17:00", "09:00")).toMatch(/after the start/);
    expect(hoursError("09:00", "09:00")).toMatch(/after the start/);
    expect(hoursError("", "17:00")).toMatch(/Pick/);
  });
});

describe("overlapError", () => {
  it("allows a split shift", () => {
    expect(
      overlapError([
        { start: "13:00", end: "17:00" },
        { start: "08:00", end: "12:00" },
      ]),
    ).toBeNull();
    // Back to back is not an overlap.
    expect(
      overlapError([
        { start: "08:00", end: "12:00" },
        { start: "12:00", end: "16:00" },
      ]),
    ).toBeNull();
  });

  it("catches two blocks that overlap", () => {
    expect(
      overlapError([
        { start: "08:00", end: "12:00" },
        { start: "11:00", end: "15:00" },
      ]),
    ).toMatch(/overlap/);
  });
});

describe("weekdayTemplate", () => {
  it("copies the first weekday that has hours", () => {
    expect(weekdayTemplate({ 3: [{ start: "10:00", end: "14:00" }], 6: [{ start: "08:00", end: "09:00" }] })).toEqual([
      { start: "10:00", end: "14:00" },
    ]);
  });

  it("falls back to nine to five, and never to the weekend", () => {
    expect(weekdayTemplate({ 6: [{ start: "08:00", end: "09:00" }] })).toEqual([{ start: "09:00", end: "17:00" }]);
  });
});

describe("WEEK_DAYS", () => {
  it("is the whole week once, Monday first, in the database's numbering", () => {
    expect(WEEK_DAYS.map((d) => d.value)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

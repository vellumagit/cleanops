import { describe, expect, it } from "vitest";
import { minutesBeforeMidnight, placeAcrossDays } from "./calendar-placement";

const tz = "America/Regina"; // UTC-6 all year
const at = (iso: string) => new Date(iso);

describe("placeAcrossDays", () => {
  it("a daytime visit is one block on its day", () => {
    expect(placeAcrossDays(at("2026-11-20T15:00:00Z"), at("2026-11-20T18:00:00Z"), tz)).toEqual([
      { ymd: "2026-11-20", hour: 9, minute: 0, minutes: 180, part: "whole" },
    ]);
  });

  it("11 PM for two hours: an hour before midnight, and an hour at the top of the next day", () => {
    // 11:00 PM Nov 20 in Regina is 05:00 UTC Nov 21.
    expect(placeAcrossDays(at("2026-11-21T05:00:00Z"), at("2026-11-21T07:00:00Z"), tz)).toEqual([
      { ymd: "2026-11-20", hour: 23, minute: 0, minutes: 60, part: "start" },
      { ymd: "2026-11-21", hour: 0, minute: 0, minutes: 60, part: "end" },
    ]);
  });

  it("ending exactly at midnight stays one block", () => {
    expect(placeAcrossDays(at("2026-11-21T04:00:00Z"), at("2026-11-21T06:00:00Z"), tz)).toEqual([
      { ymd: "2026-11-20", hour: 22, minute: 0, minutes: 120, part: "whole" },
    ]);
  });

  it("the day is the company's, not UTC's: 7 PM Regina is already tomorrow in UTC", () => {
    expect(placeAcrossDays(at("2026-11-21T01:00:00Z"), at("2026-11-21T03:00:00Z"), tz)).toEqual([
      { ymd: "2026-11-20", hour: 19, minute: 0, minutes: 120, part: "whole" },
    ]);
  });

  it("a half-hour start keeps its minutes on both sides", () => {
    expect(placeAcrossDays(at("2026-11-21T05:30:00Z"), at("2026-11-21T08:15:00Z"), tz)).toEqual([
      { ymd: "2026-11-20", hour: 23, minute: 30, minutes: 30, part: "start" },
      { ymd: "2026-11-21", hour: 0, minute: 0, minutes: 135, part: "end" },
    ]);
  });
});

describe("minutesBeforeMidnight", () => {
  it("is the whole visit unless it runs past midnight", () => {
    expect(minutesBeforeMidnight(9 * 60, 180)).toBe(180);
    expect(minutesBeforeMidnight(23 * 60, 120)).toBe(60);
    expect(minutesBeforeMidnight(22 * 60, 120)).toBe(120);
  });
});

import { describe, it, expect } from "vitest";
import { resolveSeriesMove } from "./series-move";
import { generateOccurrences } from "./recurrence";

describe("resolveSeriesMove", () => {
  it("a visit moved Thu → Wed restarts the series on the Wednesday", () => {
    expect(
      resolveSeriesMove({
        oldDate: "2026-11-12",
        newDate: "2026-11-11",
        postedStartsAt: "2026-11-12",
      }),
    ).toEqual({ visitDayMoved: true, startsAt: "2026-11-11" });
  });

  it("a start date typed on purpose wins", () => {
    expect(
      resolveSeriesMove({
        oldDate: "2026-11-12",
        newDate: "2026-11-11",
        postedStartsAt: "2026-11-18",
      }).startsAt,
    ).toBe("2026-11-18");
  });

  it("same day, nothing moved", () => {
    expect(
      resolveSeriesMove({
        oldDate: "2026-11-12",
        newDate: "2026-11-12",
        postedStartsAt: "2026-11-12",
      }),
    ).toEqual({ visitDayMoved: false, startsAt: "2026-11-12" });
  });
});

describe("visits generated after the moved visit keep its weekday", () => {
  it("every 3 weeks from a Wednesday stays on Wednesday", () => {
    // Summer dates: this machine's tz database may predate Alberta's
    // permanent UTC-6, and the weekday is what this test is about.
    const out = generateOccurrences(
      {
        pattern: "tri_weekly",
        custom_days: null,
        start_time: "13:15",
        starts_at: "2027-05-05",
        ends_at: null,
        generate_ahead: 4,
        tz: "America/Edmonton",
      },
      4,
      new Date("2027-05-05T19:15:00Z"), // Wed May 5, 1:15 PM
    );
    const weekdays = out.map((iso) =>
      new Date(iso).toLocaleDateString("en-US", {
        weekday: "short",
        timeZone: "America/Edmonton",
      }),
    );
    expect(weekdays).toEqual(["Wed", "Wed", "Wed", "Wed"]);
    expect(out[0].slice(0, 10)).toBe("2027-05-26");
  });
});

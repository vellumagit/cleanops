import { describe, expect, it } from "vitest";
import { dayLabel } from "./day-label";

const TZ = "America/Edmonton";
// Sat Sep 5 2026, 10:00 AM Edmonton (MDT, UTC-6).
const NOW = new Date("2026-09-05T16:00:00Z");

describe("dayLabel", () => {
  it("names today, with the time in the org's zone", () => {
    const l = dayLabel("2026-09-05T21:00:00Z", TZ, NOW);
    expect(l).toMatchObject({ day: "Today", time: "3:00 PM", isToday: true, daysAway: 0 });
  });

  it("an evening job is still today in Edmonton even though UTC has rolled over", () => {
    // 11:30 PM Edmonton on Sep 5 = 05:30Z on Sep 6.
    const l = dayLabel("2026-09-06T05:30:00Z", TZ, NOW);
    expect(l.day).toBe("Today");
    expect(l.time).toBe("11:30 PM");
  });

  it("tomorrow and yesterday", () => {
    expect(dayLabel("2026-09-06T21:00:00Z", TZ, NOW).day).toBe("Tomorrow");
    expect(dayLabel("2026-09-04T21:00:00Z", TZ, NOW).day).toBe("Yesterday");
  });

  it("inside the week is a weekday name", () => {
    expect(dayLabel("2026-09-08T21:00:00Z", TZ, NOW).day).toBe("Tuesday");
  });

  it("three weeks out is the date — the Anna case", () => {
    const l = dayLabel("2026-09-26T21:00:00Z", TZ, NOW);
    expect(l.day).toBe("Sat Sep 26");
    expect(l.isToday).toBe(false);
    expect(l.daysAway).toBe(21);
  });
});

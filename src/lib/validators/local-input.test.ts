/**
 * Wall time in a zone -> the instant it names, on the days the clocks change.
 *
 * September sweep, Tier 1 #7: localInputToUtcIso took the zone's offset at
 * the wrong moment, so for a few hours after each clock change a time landed
 * an hour off. Toronto and London, in 2025, on purpose: this machine's
 * time-zone data is out of date for Alberta from November 2026, and a test
 * must not depend on that.
 */
import { describe, expect, it } from "vitest";
import { localInputToUtcIso } from "./common";

const TORONTO = "America/Toronto";
const LONDON = "Europe/London";

/** What a clock on the wall in `tz` reads at this instant, as "YYYY-MM-DDTHH:mm". */
function wallClock(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

describe("localInputToUtcIso", () => {
  it("an ordinary day", () => {
    expect(localInputToUtcIso("2025-07-10T09:00", TORONTO)).toBe("2025-07-10T13:00:00.000Z");
    expect(localInputToUtcIso("2025-01-10T09:00", TORONTO)).toBe("2025-01-10T14:00:00.000Z");
  });

  // Clocks go back at 2:00 AM on 2025-11-02 (06:00Z).
  it("the morning the clocks go back: 3:00 AM is standard time, not an hour early", () => {
    expect(localInputToUtcIso("2025-11-02T00:30", TORONTO)).toBe("2025-11-02T04:30:00.000Z");
    expect(localInputToUtcIso("2025-11-02T03:00", TORONTO)).toBe("2025-11-02T08:00:00.000Z");
    expect(localInputToUtcIso("2025-11-02T05:30", TORONTO)).toBe("2025-11-02T10:30:00.000Z");
    expect(localInputToUtcIso("2025-11-02T12:00", TORONTO)).toBe("2025-11-02T17:00:00.000Z");
  });

  // Clocks go forward at 2:00 AM on 2025-03-09 (07:00Z).
  it("the morning the clocks go forward: 4:00 AM is daylight time, not an hour late", () => {
    expect(localInputToUtcIso("2025-03-09T01:00", TORONTO)).toBe("2025-03-09T06:00:00.000Z");
    expect(localInputToUtcIso("2025-03-09T04:00", TORONTO)).toBe("2025-03-09T08:00:00.000Z");
    expect(localInputToUtcIso("2025-03-09T06:30", TORONTO)).toBe("2025-03-09T10:30:00.000Z");
    expect(localInputToUtcIso("2025-03-09T12:00", TORONTO)).toBe("2025-03-09T16:00:00.000Z");
  });

  it("a zone ahead of UTC, the morning its clocks go back", () => {
    // British Summer Time ends at 01:00Z on 2025-10-26.
    expect(localInputToUtcIso("2025-10-26T03:00", LONDON)).toBe("2025-10-26T03:00:00.000Z");
    expect(localInputToUtcIso("2025-10-25T23:00", LONDON)).toBe("2025-10-25T22:00:00.000Z");
  });

  /**
   * The property behind all of the above: whatever time is typed, the instant
   * it becomes reads back as that same time on a clock in the zone. Checked
   * for every half hour of both change days and the days either side. The
   * hour that does not exist (2:00-2:59 going forward) and the hour that
   * happens twice (1:00-1:59 going back) have no single right answer and are
   * left out.
   */
  it("every other time on those days reads back as the time that was typed", () => {
    const wrong: string[] = [];
    for (const day of ["2025-03-08", "2025-03-09", "2025-03-10", "2025-11-01", "2025-11-02", "2025-11-03"]) {
      for (let half = 0; half < 48; half++) {
        const hour = Math.floor(half / 2);
        if (day === "2025-03-09" && hour === 2) continue;
        if (day === "2025-11-02" && hour === 1) continue;
        const typed = `${day}T${String(hour).padStart(2, "0")}:${half % 2 ? "30" : "00"}`;
        const back = wallClock(localInputToUtcIso(typed, TORONTO), TORONTO);
        if (back !== typed) wrong.push(`${typed} became ${back}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("hands unparseable input back untouched for the caller's own check", () => {
    expect(localInputToUtcIso("not a time", TORONTO)).toBe("not a time");
  });
});

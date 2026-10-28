import { describe, it, expect } from "vitest";
import { describeDelta, expectedVisitInstant, findSeriesDrift } from "./series-drift";

// Regina is UTC-6 all year on every tzdata, so these tests say the same
// thing on a laptop with old rules and on the server with new ones.
const TZ = "America/Regina";
const series = [{ id: "s1", start_time: "09:00:00", clientName: "Nancy Ellestad" }];
const visit = (id: string, at: string, over: Partial<{ status: string; time_set_by_hand_at: string | null }> = {}) => ({
  id,
  series_id: "s1",
  scheduled_at: at,
  status: "confirmed",
  time_set_by_hand_at: null,
  ...over,
});
const NOW = Date.parse("2026-10-28T17:00:00Z");

describe("expectedVisitInstant", () => {
  it("keeps the visit's date and puts it at the series' time", () => {
    // Stored at 16:00Z = 10:00 AM; the series says 9:00 AM = 15:00Z.
    expect(expectedVisitInstant("2026-11-02T16:00:00Z", "09:00:00", TZ).toISOString()).toBe(
      "2026-11-02T15:00:00.000Z",
    );
  });
  it("follows the zone's own rules — Edmonton in summer is UTC-6", () => {
    expect(expectedVisitInstant("2026-07-06T16:00:00Z", "09:00", "America/Edmonton").toISOString()).toBe(
      "2026-07-06T15:00:00.000Z",
    );
  });
});

describe("findSeriesDrift", () => {
  it("names the visits an hour late, grouped by series, in date order", () => {
    const drift = findSeriesDrift({
      series,
      tz: TZ,
      now: NOW,
      visits: [
        visit("b", "2026-11-16T16:00:00Z"),
        visit("a", "2026-11-02T16:00:00Z"),
        visit("ok", "2026-11-30T15:00:00Z"),
      ],
    });
    expect(drift).toHaveLength(1);
    expect(drift[0].clientName).toBe("Nancy Ellestad");
    expect(drift[0].startTime).toBe("09:00");
    expect(drift[0].visits.map((v) => v.id)).toEqual(["a", "b"]);
    expect(drift[0].visits[0]).toMatchObject({
      expected_at: "2026-11-02T15:00:00.000Z",
      deltaMinutes: 60,
    });
  });

  it("leaves alone what a person set, what's over, and what's past", () => {
    const drift = findSeriesDrift({
      series,
      tz: TZ,
      now: NOW,
      visits: [
        visit("hand", "2026-11-02T16:00:00Z", { time_set_by_hand_at: "2026-10-01T00:00:00Z" }),
        visit("done", "2026-10-05T16:00:00Z", { status: "completed" }),
        visit("gone", "2026-10-20T16:00:00Z", { status: "cancelled" }),
        visit("past", "2026-10-27T16:00:00Z"),
      ],
    });
    expect(drift).toEqual([]);
  });

  it("reports a deliberate-looking move too — the office decides, with Keep", () => {
    const drift = findSeriesDrift({
      series,
      tz: TZ,
      now: NOW,
      visits: [visit("x", "2026-11-14T18:00:00Z")],
    });
    expect(drift[0].visits[0].deltaMinutes).toBe(180);
  });
});

describe("describeDelta", () => {
  it("speaks in hours and minutes", () => {
    expect(describeDelta(60)).toBe("an hour late");
    expect(describeDelta(-60)).toBe("an hour early");
    expect(describeDelta(30)).toBe("30 min late");
    expect(describeDelta(120)).toBe("2 hours late");
    expect(describeDelta(135)).toBe("2h 15m late");
  });
});

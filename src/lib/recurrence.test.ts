import { describe, expect, it } from "vitest";
import { generateOccurrences, type SeriesRule } from "@/lib/recurrence";

/**
 * The scheduling backbone of a ~95%-recurring business, tested for the
 * failure that actually shipped: the extension cursor (`after`) is the
 * previous booking's UTC INSTANT, and an Edmonton evening visit lives on
 * the NEXT UTC day — so weekly series drifted a weekday and month-end
 * series could skip a month. Every assertion below renders the generated
 * instants back in the org zone, because that's the wall the clients see.
 *
 * PROCESS-TZ NOTE: the fixed code passes these in any process timezone
 * (verified: 10/10 under both UTC and UTC−3). The OLD code failed 7/10
 * under TZ=UTC — production's zone — but only 1/10 on a UTC−3 dev box,
 * which is exactly why the bug survived local testing. CI runs Ubuntu
 * (UTC), so the gate enforces the production failure mode.
 */

const TZ = "America/Edmonton";

const rule = (over: Partial<SeriesRule>): SeriesRule => ({
  pattern: "weekly",
  custom_days: null,
  start_time: "19:00",
  starts_at: "2026-09-01", // a Tuesday
  ends_at: null,
  generate_ahead: 8,
  monthly_nth: null,
  monthly_dow: null,
  tz: TZ,
  ...over,
});

const inTz = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));

const dayInTz = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    weekday: "short",
  }).format(new Date(iso));

describe("generateOccurrences — evening cursor (the drift bug)", () => {
  it("a weekly Tuesday 7 PM series extends to TUESDAYS, not Wednesdays", () => {
    // Tue Sep 1 2026 19:00 MDT == Wed Sep 2 01:00 UTC — the instant whose
    // UTC day-label caused the drift.
    const after = new Date("2026-09-02T01:00:00.000Z");
    const next = generateOccurrences(rule({}), 4, after);
    expect(next).toHaveLength(4);
    for (const iso of next) expect(dayInTz(iso)).toBe("Tue");
    expect(inTz(next[0])).toContain("2026-09-08");
    expect(inTz(next[0])).toContain("19:00");
  });

  it("a morning series was never affected and stays put", () => {
    const morning = rule({ start_time: "09:00" });
    // Tue Sep 1 09:00 MDT == 15:00 UTC same day.
    const after = new Date("2026-09-01T15:00:00.000Z");
    const next = generateOccurrences(morning, 2, after);
    expect(next.map(dayInTz)).toEqual(["Tue", "Tue"]);
    expect(inTz(next[0])).toContain("2026-09-08");
  });

  it("a month-end evening series does not skip a month", () => {
    const monthly = rule({
      pattern: "monthly",
      starts_at: "2026-05-31",
    });
    // Fri Jul 31 2026 19:00 MDT == Aug 1 01:00 UTC — the instant that made
    // the re-anchor start from August and emit September.
    const after = new Date("2026-08-01T01:00:00.000Z");
    const next = generateOccurrences(monthly, 2, after);
    expect(inTz(next[0])).toContain("2026-08-31");
    expect(inTz(next[1])).toContain("2026-09-30"); // clamped 31st
    expect(inTz(next[0])).toContain("19:00");
  });

  it("custom-weekly does not skip the day immediately after an evening visit", () => {
    const wed = rule({
      pattern: "custom_weekly",
      custom_days: [2, 3], // Tue + Wed
    });
    // Tue Sep 1 19:00 MDT — next occurrence must be TOMORROW (Wed Sep 2),
    // which the raw-instant scan start (already Sep 2 UTC, +1 day) skipped.
    const after = new Date("2026-09-02T01:00:00.000Z");
    const next = generateOccurrences(wed, 2, after);
    expect(inTz(next[0])).toContain("2026-09-02");
    expect(dayInTz(next[0])).toBe("Wed");
    expect(inTz(next[1])).toContain("2026-09-08");
  });
});

describe("generateOccurrences — DST boundaries", () => {
  it("holds 23:00 wall-clock across the November fall-back", () => {
    const late = rule({ start_time: "23:00", starts_at: "2026-10-27" }); // Tue
    // Tue Oct 27 23:00 MDT == Oct 28 05:00 UTC.
    const after = new Date("2026-10-28T05:00:00.000Z");
    const next = generateOccurrences(late, 3, after);
    // Nov 1 2026 is the fall-back; Nov 3 + Nov 10 are MST (UTC-7).
    expect(next.map(dayInTz)).toEqual(["Tue", "Tue", "Tue"]);
    for (const iso of next) expect(inTz(iso)).toContain("23:00");
    expect(inTz(next[0])).toContain("2026-11-03");
  });

  it("holds wall-clock across the March spring-forward", () => {
    const series = rule({ start_time: "19:00", starts_at: "2027-03-02" }); // Tue, MST
    const after = new Date("2027-03-03T02:00:00.000Z"); // Tue Mar 2 19:00 MST
    const next = generateOccurrences(series, 2, after);
    expect(next.map(dayInTz)).toEqual(["Tue", "Tue"]);
    expect(inTz(next[0])).toContain("2027-03-09"); // MDT week
    expect(inTz(next[0])).toContain("19:00");
  });
});

describe("generateOccurrences — month-length re-anchoring", () => {
  it("a 31st series clamps to short months and returns: Jan 31 → Feb 28 → Mar 31", () => {
    const monthly = rule({
      pattern: "monthly",
      start_time: "10:00",
      starts_at: "2027-01-31",
    });
    const out = generateOccurrences(monthly, 3, null);
    expect(inTz(out[0])).toContain("2027-01-31");
    expect(inTz(out[1])).toContain("2027-02-28");
    expect(inTz(out[2])).toContain("2027-03-31");
  });
});

describe("generateOccurrences — guardrails that must keep holding", () => {
  it("every result is strictly after the cursor instant", () => {
    const after = new Date("2026-09-02T01:00:00.000Z");
    for (const iso of generateOccurrences(rule({}), 6, after)) {
      expect(new Date(iso).getTime()).toBeGreaterThan(after.getTime());
    }
  });

  it("skip_dates drop the org-local day they name", () => {
    const after = new Date("2026-09-02T01:00:00.000Z");
    const next = generateOccurrences(
      rule({ skip_dates: ["2026-09-08"] }),
      2,
      after,
    );
    expect(inTz(next[0])).toContain("2026-09-15");
  });

  it("ends_at stops the series", () => {
    const next = generateOccurrences(
      rule({ ends_at: "2026-09-15" }),
      10,
      new Date("2026-09-02T01:00:00.000Z"),
    );
    expect(next).toHaveLength(2); // Sep 8 + Sep 15 only
  });
});

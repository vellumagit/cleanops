import { describe, it, expect } from "vitest";
import { preserveSubSecond, endsAfterStart } from "./time-entry-edit";
import { zonedMidnightUtc, zonedDayStartUtc, zonedYmd } from "./wall-clock";
import { localInputToUtcIso } from "./validators/common";

const EDM = "America/Edmonton"; // MDT (UTC-6) summer / MST (UTC-7) winter

describe("preserveSubSecond", () => {
  // Olha's entry edfc74a8: clock_in 2026-08-04T18:56:56.289Z, 0.332s after
  // the previous punch's clock_out at 18:56:55.957Z.
  const STORED = "2026-08-04T18:56:56.289Z";

  it("keeps the stored instant when the form returns it truncated to the second", () => {
    expect(preserveSubSecond("2026-08-04T18:56:56.000Z", STORED)).toBe(STORED);
  });

  it("passes a real edit through unchanged", () => {
    const edited = "2026-08-04T19:30:00.000Z";
    expect(preserveSubSecond(edited, STORED)).toBe(edited);
  });

  it("does not treat a one-second edit as an unchanged field", () => {
    const edited = "2026-08-04T18:56:57.000Z";
    expect(preserveSubSecond(edited, STORED)).toBe(edited);
  });

  it("truncates toward the past, so a .999 stored value still matches", () => {
    const stored = "2026-08-04T18:56:56.999Z";
    expect(preserveSubSecond("2026-08-04T18:56:56.000Z", stored)).toBe(stored);
  });

  it("accepts the +00:00 offset PostgREST returns, not just Z", () => {
    const stored = "2026-08-04T18:56:56.289+00:00";
    expect(preserveSubSecond("2026-08-04T18:56:56.000Z", stored)).toBe(stored);
  });

  it("returns the submitted value when there is no stored one (create)", () => {
    expect(preserveSubSecond("2026-08-04T18:56:56.000Z", null)).toBe(
      "2026-08-04T18:56:56.000Z",
    );
  });

  it("passes null through (clearing an open shift's end)", () => {
    expect(preserveSubSecond(null, STORED)).toBeNull();
  });

  it("falls back to the submitted value on an unparseable stored timestamp", () => {
    expect(preserveSubSecond("2026-08-04T18:56:56.000Z", "not-a-date")).toBe(
      "2026-08-04T18:56:56.000Z",
    );
  });
});

describe("endsAfterStart", () => {
  const NOW = Date.parse("2026-08-08T22:00:00.000Z");

  it("the back-to-back punch no longer collides once seconds survive", () => {
    // Previous entry ends 18:56:55.957; the edited entry starts 18:56:56.289.
    expect(
      endsAfterStart(
        "2026-08-04T18:56:55.957+00:00",
        "2026-08-04T18:56:56.289Z",
        NOW,
      ),
    ).toBe(false);
  });

  it("still collides when the punch really is inside the previous shift", () => {
    expect(
      endsAfterStart(
        "2026-08-04T19:30:00+00:00",
        "2026-08-04T18:56:56.289Z",
        NOW,
      ),
    ).toBe(true);
  });

  it("catches the equal-instant overlap that string comparison missed", () => {
    // Postgres drops the fractional part when it is zero. Lexicographically
    // '+' (0x2B) sorts below '.' (0x2E), so this pair used to read as clean.
    expect(
      endsAfterStart(
        "2026-08-04T18:57:00+00:00",
        "2026-08-04T18:56:59.500Z",
        NOW,
      ),
    ).toBe(true);
  });

  it("treats an open shift as running until now, per the documented contract", () => {
    expect(endsAfterStart(null, "2026-08-08T21:00:00.000Z", NOW)).toBe(true);
    // A start after "now" cannot be reached by a shift that ends at "now".
    expect(endsAfterStart(null, "2026-08-08T23:00:00.000Z", NOW)).toBe(false);
  });

  it("ignores an unparseable row rather than blocking every edit", () => {
    expect(endsAfterStart("garbage", "2026-08-04T18:56:56.289Z", NOW)).toBe(
      false,
    );
  });
});

describe("timesheet window is a pair of org-local calendar days", () => {
  // The window the page builds for ?from=2026-07-23&to=2026-07-23.
  const dayStart = zonedMidnightUtc("2026-07-23", EDM);
  const dayEnd = zonedDayStartUtc(zonedMidnightUtc("2026-07-23", EDM), EDM, 1);

  it("summer: covers 00:00–24:00 Edmonton, i.e. 06:00Z to 06:00Z", () => {
    expect(dayStart.toISOString()).toBe("2026-07-23T06:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-07-24T06:00:00.000Z");
  });

  it("winter: the offset is seven hours, not six", () => {
    expect(zonedMidnightUtc("2026-01-15", EDM).toISOString()).toBe(
      "2026-01-15T07:00:00.000Z",
    );
  });

  // Olha's three evening entries — the ones that used to land a day early.
  const EVENING = [
    { id: "d03b4b71", at: "2026-07-24T02:30:05Z", day: "2026-07-23" },
    { id: "3ff2f0d6", at: "2026-07-24T00:40:06Z", day: "2026-07-23" },
    { id: "2e2f90d1", at: "2026-07-15T02:35:00Z", day: "2026-07-14" },
  ];

  it("an evening shift falls in the day it is rendered as", () => {
    for (const e of EVENING) {
      const t = new Date(e.at);
      expect(zonedYmd(t, EDM)).toBe(e.day);

      const start = zonedMidnightUtc(e.day, EDM).getTime();
      const end = zonedDayStartUtc(zonedMidnightUtc(e.day, EDM), EDM, 1).getTime();
      expect(t.getTime()).toBeGreaterThanOrEqual(start);
      expect(t.getTime()).toBeLessThan(end);
    }
  });

  it("the old UTC-anchored window excluded exactly these entries", () => {
    for (const e of EVENING) {
      const t = new Date(e.at).getTime();
      const oldStart = Date.parse(`${e.day}T00:00:00Z`);
      const oldEnd = Date.parse(`${e.day}T23:59:59Z`);
      expect(t > oldEnd || t < oldStart).toBe(true);
    }
  });

  it("6:00 PM is the summer cutoff the old window created", () => {
    // 5:59 PM local was inside the old window; 6:00 PM fell out of its day.
    expect(Date.parse("2026-07-23T23:59:00Z")).toBeLessThanOrEqual(
      Date.parse("2026-07-23T23:59:59Z"),
    );
    expect(localInputToUtcIso("2026-07-23T18:00", EDM)).toBe(
      "2026-07-24T00:00:00.000Z",
    );
  });
});

import { describe, it, expect } from "vitest";
import { formatElapsed, overrunMinutes } from "./use-elapsed";

const MIN = 60_000;
const at = (iso: string) => new Date(iso).getTime();

describe("formatElapsed", () => {
  it("shows minutes under an hour and h+m past it", () => {
    expect(formatElapsed(0)).toBe("0m");
    expect(formatElapsed(47 * MIN)).toBe("47m");
    expect(formatElapsed(3 * 60 * MIN + 12 * MIN)).toBe("3h 12m");
  });

  it("floors rather than rounds, and never goes negative", () => {
    expect(formatElapsed(59_999)).toBe("0m");
    expect(formatElapsed(-5 * MIN)).toBe("0m");
  });
});

describe("overrunMinutes", () => {
  // The live case that exposed the bug: booking 841f3aa1 is a 6h job split
  // across 2 cleaners (3h each) scheduled 19:00Z, and the cleaner clocked in
  // at 18:49:40Z — ten minutes EARLY, which 42% of real entries are.
  const clockInMs = at("2026-07-30T18:49:40Z");
  const scheduledStartMs = at("2026-07-30T19:00:00Z");
  const scheduledMinutes = 180;
  const over = (nowIso: string) =>
    overrunMinutes({
      clockInMs,
      scheduledStartMs,
      scheduledMinutes,
      nowMs: at(nowIso),
    });

  it("does not call an early start an overrun", () => {
    // Clock-in + 3h. Anchoring to clock-in would have said "over" here, while
    // the card's own next line still reads "7:00 PM · 3h".
    expect(over("2026-07-30T21:49:40Z")).toBe(0);
    // One second before the real scheduled end.
    expect(over("2026-07-30T21:59:59Z")).toBe(0);
  });

  it("starts counting from the scheduled end", () => {
    expect(over("2026-07-30T22:00:00Z")).toBe(0);
    expect(over("2026-07-30T22:01:00Z")).toBe(1);
    expect(over("2026-07-31T00:00:00Z")).toBe(120);
  });

  it("gives a late start its full window", () => {
    // Same job, clocked in 40 minutes late: the window slides so they still
    // get 3h, matching sendShiftClockOutReminders' max().
    const late = at("2026-07-30T19:40:00Z");
    const args = { clockInMs: late, scheduledStartMs, scheduledMinutes };
    expect(overrunMinutes({ ...args, nowMs: at("2026-07-30T22:39:00Z") })).toBe(0);
    expect(overrunMinutes({ ...args, nowMs: at("2026-07-30T22:41:00Z") })).toBe(1);
  });

  it("never reports a fractional-minute overrun as an overrun", () => {
    // Gating on milliseconds while formatting floored minutes is what made
    // the pill read "· 0m over".
    expect(over("2026-07-30T22:00:59Z")).toBe(0);
  });
});

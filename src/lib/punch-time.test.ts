import { describe, it, expect } from "vitest";
import { punchTime } from "./punch-time";

const NOW = new Date("2026-10-28T15:40:00Z").getTime();

describe("punchTime", () => {
  it("uses the phone's time when it's recent", () => {
    expect(punchTime("2026-10-28T15:02:10.000Z", NOW)).toBe("2026-10-28T15:02:10.000Z");
  });

  it("allows a tap sent hours later from a dead zone", () => {
    expect(punchTime("2026-10-28T09:00:00.000Z", NOW)).toBe("2026-10-28T09:00:00.000Z");
  });

  it("falls back to now for a tap older than 12 hours", () => {
    expect(punchTime("2026-10-27T15:00:00.000Z", NOW)).toBe("2026-10-28T15:40:00.000Z");
  });

  it("tolerates a phone clock a few minutes fast, not more", () => {
    expect(punchTime("2026-10-28T15:43:00.000Z", NOW)).toBe("2026-10-28T15:43:00.000Z");
    expect(punchTime("2026-10-28T16:10:00.000Z", NOW)).toBe("2026-10-28T15:40:00.000Z");
  });

  it("falls back to now when nothing or garbage was sent", () => {
    expect(punchTime(null, NOW)).toBe("2026-10-28T15:40:00.000Z");
    expect(punchTime("", NOW)).toBe("2026-10-28T15:40:00.000Z");
    expect(punchTime("yesterday", NOW)).toBe("2026-10-28T15:40:00.000Z");
  });
});

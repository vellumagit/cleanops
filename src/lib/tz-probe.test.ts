import { describe, it, expect } from "vitest";
import { buildTzProbe, findTzMismatch, tzOffsetMinutes, type TzProbe } from "./tz-probe";

// Server on current rules: Alberta is UTC-6 all year from 2026-11-01.
const alberta: TzProbe = {
  tz: "America/Edmonton",
  samples: [0, 45, 100, 160, 220].map((d) => ({
    at: new Date(Date.UTC(2026, 9, 8, 12) + d * 86_400_000).toISOString(),
    offsetMinutes: -360,
  })),
};
// A phone on pre-2026c rules: falls back Nov 1 08:00 UTC, springs forward Mar 14 09:00 UTC.
const stalePhone = (_tz: string, at: Date) => {
  const t = at.getTime();
  return t >= Date.UTC(2026, 10, 1, 8) && t < Date.UTC(2027, 2, 14, 9) ? -420 : -360;
};

describe("findTzMismatch", () => {
  it("a phone on the old Alberta rules shows times an hour early from Nov 1", () => {
    const m = findTzMismatch(alberta, stalePhone);
    expect(m).toEqual({ at: "2026-11-01T12:00:00.000Z", diffMinutes: -60 });
  });

  it("a device on current rules is fine", () => {
    expect(findTzMismatch(alberta, () => -360)).toBeNull();
  });

  it("a device that can't format the zone is left alone", () => {
    expect(
      findTzMismatch(alberta, () => {
        throw new RangeError("bad tz");
      }),
    ).toBeNull();
  });
});

describe("buildTzProbe / tzOffsetMinutes", () => {
  it("agrees with itself on this machine, whatever its rules", () => {
    const probe = buildTzProbe("America/Toronto", new Date("2026-10-08T00:00:00Z"));
    expect(probe.samples).toHaveLength(7);
    expect(findTzMismatch(probe)).toBeNull();
  });

  it("reads a fixed zone exactly", () => {
    expect(tzOffsetMinutes("Asia/Kolkata", new Date("2026-12-01T00:00:00Z"))).toBe(330);
    expect(tzOffsetMinutes("UTC", new Date())).toBe(0);
  });
});

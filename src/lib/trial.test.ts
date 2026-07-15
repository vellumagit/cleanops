import { describe, it, expect } from "vitest";
import { remainingTrialDays, TRIAL_DAYS } from "./trial";

const DAY = 24 * 60 * 60 * 1000;
const startIso = "2026-07-01T00:00:00Z";
const startMs = Date.parse(startIso);

describe("remainingTrialDays", () => {
  it("gives the full trial when no start date is set", () => {
    expect(remainingTrialDays(null, startMs)).toBe(TRIAL_DAYS);
    expect(remainingTrialDays(undefined, startMs)).toBe(TRIAL_DAYS);
  });

  it("gives the full trial for an invalid start date", () => {
    expect(remainingTrialDays("not-a-date", startMs)).toBe(TRIAL_DAYS);
  });

  it("returns the full trial at the moment it starts", () => {
    expect(remainingTrialDays(startIso, startMs)).toBe(TRIAL_DAYS);
  });

  it("counts down as time passes (ceil)", () => {
    expect(remainingTrialDays(startIso, startMs + 1 * DAY)).toBe(13);
    // 3.5 days elapsed → 10.5 left → ceil → 11
    expect(remainingTrialDays(startIso, startMs + 3.5 * DAY)).toBe(11);
  });

  it("is 0 once the trial is fully spent — the double-trial guard", () => {
    expect(remainingTrialDays(startIso, startMs + TRIAL_DAYS * DAY)).toBe(0);
    expect(remainingTrialDays(startIso, startMs + 30 * DAY)).toBe(0);
  });

  it("never exceeds the trial length even for a future start", () => {
    expect(remainingTrialDays(startIso, startMs - 5 * DAY)).toBe(TRIAL_DAYS);
  });

  it("honors a custom trial length", () => {
    expect(remainingTrialDays(startIso, startMs + 2 * DAY, 30)).toBe(28);
  });

  it("accepts a Date instance for the start", () => {
    expect(remainingTrialDays(new Date(startIso), startMs + 1 * DAY)).toBe(13);
  });
});

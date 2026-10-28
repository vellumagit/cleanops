import { describe, expect, it } from "vitest";
import {
  classifyJob,
  lateStarters,
  orgUsesClockIn,
  LATE_START_NUDGE_MINUTES,
  NO_CLOCK_IN_GRACE_MINUTES,
  type JobWatchInput,
} from "@/lib/job-watch";

const START = Date.parse("2026-08-15T23:00:00.000Z");
const MIN = 60_000;

const job = (over: Partial<JobWatchInput> = {}): JobWatchInput => ({
  scheduledAtMs: START,
  windowEndMs: START + 120 * MIN,
  status: "confirmed",
  staffed: true,
  hasClockIn: false,
  nowMs: START,
  nudgedAtMs: null,
  flaggedAtMs: null,
  ...over,
});

describe("classifyJob — nothing to say", () => {
  it("stays quiet before the grace has elapsed", () => {
    const almost = job({ nowMs: START + (LATE_START_NUDGE_MINUTES - 1) * MIN });
    expect(classifyJob(almost).kind).toBe("none");
  });

  it("stays quiet once somebody clocked in — the clock-out watcher owns it", () => {
    const started = job({ hasClockIn: true, nowMs: START + 10 * 60 * MIN });
    expect(classifyJob(started).kind).toBe("none");
  });

  it("believes a human who marked the job complete or cancelled", () => {
    for (const status of ["completed", "cancelled"]) {
      const done = job({ status, nowMs: START + 10 * 60 * MIN });
      expect(classifyJob(done).kind).toBe("none");
    }
  });

  it("leaves unstaffed and pending jobs to their own watchers", () => {
    const unstaffed = job({ staffed: false, nowMs: START + 10 * 60 * MIN });
    const pending = job({ status: "pending", nowMs: START + 10 * 60 * MIN });
    expect(classifyJob(unstaffed).kind).toBe("none");
    expect(classifyJob(pending).kind).toBe("none");
  });
});

describe("classifyJob — late start (recoverable)", () => {
  it("nudges once the start is past the grace and the window is still open", () => {
    const late = job({ nowMs: START + 20 * MIN });
    const v = classifyJob(late);
    expect(v.kind).toBe("late_start");
    if (v.kind === "late_start") expect(v.minutesLate).toBe(20);
  });

  it("nudges an in_progress job too — the status moved but no clock ever started", () => {
    const late = job({ status: "in_progress", nowMs: START + 30 * MIN });
    expect(classifyJob(late).kind).toBe("late_start");
  });

  it("says it once — a second pass with the stamp set is silent", () => {
    const already = job({ nowMs: START + 40 * MIN, nudgedAtMs: START + 20 * MIN });
    expect(classifyJob(already).kind).toBe("none");
  });
});

describe("classifyJob — no clock-in (the money guard)", () => {
  const wellPast = START + (120 + NO_CLOCK_IN_GRACE_MINUTES) * MIN;

  it("asks the office once the whole window has passed with no clock-in", () => {
    const v = classifyJob(job({ nowMs: wellPast }));
    expect(v.kind).toBe("no_clock_in");
    if (v.kind === "no_clock_in") {
      expect(v.minutesPastEnd).toBe(NO_CLOCK_IN_GRACE_MINUTES);
    }
  });

  it("outranks the late-start nudge — the window is gone, nudging is pointless", () => {
    expect(classifyJob(job({ nowMs: wellPast })).kind).toBe("no_clock_in");
  });

  it("asks once — the flag stamp silences later passes", () => {
    const already = job({ nowMs: wellPast + 12 * 60 * MIN, flaggedAtMs: wellPast });
    expect(classifyJob(already).kind).toBe("none");
  });

  it("a nudged job still gets flagged later — different word, different stamp", () => {
    const nudgedThenPast = job({ nowMs: wellPast, nudgedAtMs: START + 20 * MIN });
    expect(classifyJob(nudgedThenPast).kind).toBe("no_clock_in");
  });

  it("treats a zero-length window as gone at once rather than never flagging", () => {
    const noDuration = job({
      windowEndMs: START,
      nowMs: START + (NO_CLOCK_IN_GRACE_MINUTES + 1) * MIN,
    });
    expect(classifyJob(noDuration).kind).toBe("no_clock_in");
  });

  it("waits for the last segment on a split shift — 4h + 4h is an 8-hour window", () => {
    // Two cleaners, 4h each, the second from 4h in. At start + 4h30 the job
    // measured by its shared length would be over; the second cleaner's
    // segment has barely begun.
    const split = job({ windowEndMs: START + 8 * 60 * MIN });
    expect(classifyJob({ ...split, nowMs: START + 270 * MIN }).kind).toBe("late_start");
    expect(classifyJob({ ...split, nowMs: START + (480 + NO_CLOCK_IN_GRACE_MINUTES) * MIN }).kind).toBe(
      "no_clock_in",
    );
  });
});

describe("lateStarters — each person measured from her own start", () => {
  const crew = [
    { membershipId: "morning", startOffsetMinutes: null },
    { membershipId: "afternoon", startOffsetMinutes: 240 },
  ];

  it("nudges only the one whose start has passed", () => {
    const at20 = lateStarters({ scheduledAtMs: START, crew, nowMs: START + 20 * MIN });
    expect(at20.map((p) => p.membershipId)).toEqual(["morning"]);
    expect(at20[0]).toMatchObject({ dueAtMs: START, minutesLate: 20 });
  });

  it("picks the second one up once her own start is 15 minutes gone", () => {
    const early = lateStarters({ scheduledAtMs: START, crew, nowMs: START + 250 * MIN });
    expect(early.map((p) => p.membershipId)).toEqual(["morning"]);
    const late = lateStarters({ scheduledAtMs: START, crew, nowMs: START + 255 * MIN });
    expect(late.map((p) => p.membershipId)).toEqual(["morning", "afternoon"]);
    expect(late[1]).toMatchObject({ dueAtMs: START + 240 * MIN, minutesLate: 15 });
  });

  it("names a person once even when she is both primary and crew", () => {
    const twice = [
      { membershipId: "morning", startOffsetMinutes: null },
      { membershipId: "morning", startOffsetMinutes: null },
    ];
    expect(lateStarters({ scheduledAtMs: START, crew: twice, nowMs: START + 20 * MIN })).toHaveLength(1);
  });
});

describe("orgUsesClockIn", () => {
  it("is silent for an org that has never clocked in — every job would flag", () => {
    expect(orgUsesClockIn(0)).toBe(false);
  });

  it("watches an org with any recent clock-in activity", () => {
    expect(orgUsesClockIn(1)).toBe(true);
    expect(orgUsesClockIn(140)).toBe(true);
  });
});

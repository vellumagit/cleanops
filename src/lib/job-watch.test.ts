import { describe, expect, it } from "vitest";
import {
  autoCompleteDue,
  classifyJob,
  enteredAfterStart,
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

  it("says nothing about a job written down after it started", () => {
    // Oct 30, 2026: an 8:45 meeting entered at 10:05. Inside the window it
    // is not a late start, and once the window is gone it is not a
    // no-clock-in question — the entry is the evidence.
    const entered = START + 80 * MIN;
    const inside = job({ createdAtMs: entered, nowMs: START + 100 * MIN });
    const after = job({ createdAtMs: entered, nowMs: START + 10 * 60 * MIN });
    expect(classifyJob(inside).kind).toBe("none");
    expect(classifyJob(after).kind).toBe("none");
  });

  it("enteredAfterStart is the one test both the watch and the assignment notice use", () => {
    expect(enteredAfterStart(START + 1, START)).toBe(true);
    expect(enteredAfterStart(START, START)).toBe(false);
    expect(enteredAfterStart(START - 7 * 24 * 60 * MIN, START)).toBe(false);
    expect(enteredAfterStart(null, START)).toBe(false);
    expect(enteredAfterStart(undefined, START)).toBe(false);
  });

  it("still watches a job booked ahead, however late it was booked", () => {
    const booked = job({ createdAtMs: START - 1, nowMs: START + 10 * 60 * MIN });
    expect(classifyJob(booked).kind).toBe("no_clock_in");
    const unknown = job({ createdAtMs: null, nowMs: START + 10 * 60 * MIN });
    expect(classifyJob(unknown).kind).toBe("no_clock_in");
  });
});

describe("autoCompleteDue — the sweep counts from the job's end", () => {
  // Ranj Asi, 2026-11-05: 9:30 AM, ten hours, one cleaner, 4-hour grace.
  const at = (hhmm: string) => Date.parse(`2026-11-05T${hhmm}:00-06:00`);
  const ranj = (nowMs: number) =>
    autoCompleteDue({
      scheduledAt: new Date(at("09:30")).toISOString(),
      durationMinutes: 600,
      dividesHours: false,
      crew: [{ membership_id: "anna", split_start_offset_minutes: null, split_duration_minutes: null }],
      graceHours: 4,
      nowMs,
    });

  it("is not due at the 8 PM sweep — the window only ended at 7:30", () => {
    expect(ranj(at("20:00"))).toBe(false);
    expect(ranj(at("23:29"))).toBe(false);
  });

  it("is due at 11:30 PM, four hours after the end, when the office has been asked", () => {
    expect(ranj(at("23:30"))).toBe(true);
  });

  it("uses the crew's shared window when the org divides hours", () => {
    // Ten hours shared three ways is a 3h20m window: due at 9:00 + 3:20 + 4h.
    const crew = ["a", "b", "c"].map((membership_id) => ({ membership_id, split_start_offset_minutes: null, split_duration_minutes: null }));
    const divided = (nowMs: number) =>
      autoCompleteDue({ scheduledAt: new Date(at("09:00")).toISOString(), durationMinutes: 600, dividesHours: true, crew, graceHours: 4, nowMs });
    expect(divided(at("16:19"))).toBe(false);
    expect(divided(at("16:20"))).toBe(true);
  });

  it("the question comes first: silence is asked about half an hour after the end", () => {
    // classifyJob asks at end + NO_CLOCK_IN_GRACE_MINUTES; the sweep waits
    // end + hours. With any grace of an hour or more the order is fixed.
    const end = at("19:30");
    const asked = classifyJob(job({ scheduledAtMs: at("09:30"), windowEndMs: end, nowMs: end + NO_CLOCK_IN_GRACE_MINUTES * MIN }));
    expect(asked.kind).toBe("no_clock_in");
    expect(ranj(end + NO_CLOCK_IN_GRACE_MINUTES * MIN)).toBe(false);
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

describe("classifyJob — a moved job is a new job to watch", () => {
  it("asks again about a job moved after it was flagged", () => {
    // Flagged at 3:30 PM yesterday, then moved to today 9:00 AM: the flag
    // was about yesterday's slot.
    const movedStart = START + 24 * 60 * MIN;
    const v = classifyJob(
      job({
        scheduledAtMs: movedStart,
        windowEndMs: movedStart + 120 * MIN,
        nowMs: movedStart + (120 + NO_CLOCK_IN_GRACE_MINUTES) * MIN,
        flaggedAtMs: START + 150 * MIN,
        nudgedAtMs: START + 20 * MIN,
      }),
    );
    expect(v.kind).toBe("no_clock_in");
  });

  it("nudges again after a move later the same day", () => {
    const movedStart = START + 180 * MIN;
    const v = classifyJob(
      job({
        scheduledAtMs: movedStart,
        windowEndMs: movedStart + 120 * MIN,
        nowMs: movedStart + 20 * MIN,
        nudgedAtMs: START + 20 * MIN,
      }),
    );
    expect(v.kind).toBe("late_start");
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

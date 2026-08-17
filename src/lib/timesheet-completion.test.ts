import { describe, expect, it } from "vitest";

/**
 * "Did this person take longer than expected?" — the timesheet's completion
 * badge, and the one number on that page that was still measuring a team job
 * by its WHOLE length instead of the asker's share.
 *
 * Two cleaners on a 3h job each owe 90 minutes. Comparing either against 180
 * reported them 90 minutes under, so every crew job showed both cleaners
 * finishing an hour and a half early — forever, and most visibly for the two
 * people who split the most work. The clock-out cron and the over-allotted
 * flag had already been taught the share; completion had not.
 *
 * Extracted here as the pure decision so it stays taught.
 */

const ON_TARGET_GRACE_MINUTES = 5;

export type Completion = "under" | "on_target" | "over" | null;

export function classifyCompletion(
  actualMinutes: number,
  /** What THIS person was allotted: their split segment, their share of a
   *  divided team job, or the whole booking when they worked it alone. */
  allottedMinutes: number | null,
): { completion: Completion; diffMinutes: number } {
  if (!allottedMinutes || actualMinutes <= 0) {
    return { completion: null, diffMinutes: 0 };
  }
  const diff = actualMinutes - allottedMinutes;
  if (diff < -ON_TARGET_GRACE_MINUTES) {
    return { completion: "under", diffMinutes: Math.abs(diff) };
  }
  if (diff > ON_TARGET_GRACE_MINUTES) {
    return { completion: "over", diffMinutes: diff };
  }
  return { completion: "on_target", diffMinutes: 0 };
}

/** What the page now feeds in: the person's window, else the whole booking. */
function allotmentFor(
  shiftWindow: { allottedMinutes: number } | undefined,
  bookingDurationMinutes: number | null,
): number | null {
  return shiftWindow?.allottedMinutes ?? bookingDurationMinutes ?? null;
}

describe("a two-person job is judged per person", () => {
  const JOB = 180; // 3h booking
  const share = { allottedMinutes: 90 }; // divided evenly across 2 cleaners

  it("both cleaners working their share read as on target, not early", () => {
    const allotted = allotmentFor(share, JOB);
    expect(classifyCompletion(90, allotted).completion).toBe("on_target");
  });

  it("the old whole-job comparison is what called them 90 minutes early", () => {
    // Regression guard: this is the behaviour that shipped, spelled out so
    // nobody restores it by "simplifying" back to booking.duration_minutes.
    const wrong = classifyCompletion(90, JOB);
    expect(wrong.completion).toBe("under");
    expect(wrong.diffMinutes).toBe(90);
  });

  it("a cleaner who genuinely runs long on their share still reads over", () => {
    const allotted = allotmentFor(share, JOB);
    const v = classifyCompletion(140, allotted);
    expect(v.completion).toBe("over");
    expect(v.diffMinutes).toBe(50);
  });

  it("someone who really did finish their share early still reads under", () => {
    const allotted = allotmentFor(share, JOB);
    const v = classifyCompletion(40, allotted);
    expect(v.completion).toBe("under");
    expect(v.diffMinutes).toBe(50);
  });
});

describe("split shifts use the segment, not an even share", () => {
  it("a 2h segment of a 6h job is judged against the 2h", () => {
    const allotted = allotmentFor({ allottedMinutes: 120 }, 360);
    expect(classifyCompletion(125, allotted).completion).toBe("on_target");
    expect(classifyCompletion(200, allotted).completion).toBe("over");
  });
});

describe("solo jobs are unchanged", () => {
  it("no window means the whole booking is the allotment", () => {
    const allotted = allotmentFor(undefined, 180);
    expect(allotted).toBe(180);
    expect(classifyCompletion(180, allotted).completion).toBe("on_target");
    expect(classifyCompletion(60, allotted).completion).toBe("under");
  });
});

describe("edge cases stay quiet rather than lying", () => {
  it("an open shift (no elapsed time) has no verdict", () => {
    expect(classifyCompletion(0, 90).completion).toBeNull();
  });

  it("a booking with no duration has nothing to compare against", () => {
    expect(classifyCompletion(90, allotmentFor(undefined, null)).completion)
      .toBeNull();
  });

  it("within five minutes either way counts as on target", () => {
    expect(classifyCompletion(94, 90).completion).toBe("on_target");
    expect(classifyCompletion(86, 90).completion).toBe("on_target");
    expect(classifyCompletion(96, 90).completion).toBe("over");
  });
});

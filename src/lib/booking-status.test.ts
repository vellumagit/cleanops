import { describe, it, expect } from "vitest";
import { futureStatusError, EARLY_START_GRACE_MINUTES } from "./booking-status";

const NOW = new Date("2026-08-04T16:00:00Z").getTime();
const MIN = 60_000;
const at = (minutesFromNow: number) =>
  new Date(NOW + minutesFromNow * MIN).toISOString();

const future = at(2 * 24 * 60);
const past = at(-2 * 24 * 60);

describe("futureStatusError", () => {
  it("rejects a future job saved as completed", () => {
    // Production shape: booking a766d848 was created 2026-08-03 for a job on
    // 2026-08-05 with status completed. That hid the shift from Jim entirely,
    // because the field app treats a completed booking as nothing to accept.
    expect(futureStatusError(future, "completed", NOW)).toContain(
      "to be marked completed",
    );
  });

  it("rejects a far-future job saved as in progress", () => {
    expect(futureStatusError(future, "in_progress", NOW)).toContain(
      "to be marked in progress",
    );
  });

  it("allows every other status on a future job", () => {
    for (const s of ["pending", "confirmed", "en_route", "cancelled"]) {
      expect(futureStatusError(future, s, NOW)).toBeNull();
    }
  });

  it("leaves back-filling alone — any status on a past date is fine", () => {
    // Owners routinely reconstruct history when switching tools. The previous
    // guard blocked this and was removed for exactly that reason.
    for (const s of ["completed", "in_progress", "confirmed", "cancelled"]) {
      expect(futureStatusError(past, s, NOW)).toBeNull();
    }
  });

  it("does not throw on an unparseable date", () => {
    expect(futureStatusError("not-a-date", "completed", NOW)).toBeNull();
  });
});

describe("the early-start grace window", () => {
  // The rest of the codebase assumes a cleaner can start before the hour on
  // the schedule (bookings/actions.ts:1372). A guard that rejected any future
  // in_progress would have made the field app refuse legitimate clock-ins the
  // moment it was wired in there.
  it("lets a crew clock into a job that starts within the window", () => {
    for (const mins of [1, 30, 90, EARLY_START_GRACE_MINUTES - 1]) {
      expect(futureStatusError(at(mins), "in_progress", NOW)).toBeNull();
    }
  });

  it("lets a short job be finished slightly before its scheduled start", () => {
    expect(futureStatusError(at(45), "completed", NOW)).toBeNull();
  });

  it("treats the boundary itself as still allowed", () => {
    expect(
      futureStatusError(at(EARLY_START_GRACE_MINUTES), "in_progress", NOW),
    ).toBeNull();
  });

  it("rejects one minute past the boundary", () => {
    expect(
      futureStatusError(at(EARLY_START_GRACE_MINUTES + 1), "in_progress", NOW),
    ).not.toBeNull();
  });

  it("still catches the incident that motivated the guard", () => {
    // a766d848: created ~50 hours ahead of its slot, saved completed.
    expect(futureStatusError(at(50 * 60), "completed", NOW)).not.toBeNull();
  });

  it("catches dragging a finished job into next week", () => {
    expect(futureStatusError(at(7 * 24 * 60), "completed", NOW)).not.toBeNull();
  });
});

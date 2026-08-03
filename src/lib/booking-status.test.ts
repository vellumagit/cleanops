import { describe, it, expect } from "vitest";
import { futureStatusError } from "./booking-status";

const future = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
const past = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();

describe("futureStatusError", () => {
  it("rejects a future job saved as completed", () => {
    // Production shape: booking a766d848 was created 2026-08-03 for a job on
    // 2026-08-05 with status completed. That hid the shift from Jim entirely,
    // because the field app treats a completed booking as nothing to accept.
    expect(futureStatusError(future, "completed")).toContain(
      "can't be marked completed",
    );
  });

  it("rejects a future job saved as in progress", () => {
    expect(futureStatusError(future, "in_progress")).toContain(
      "can't be marked in progress",
    );
  });

  it("allows every other status on a future job", () => {
    for (const s of ["pending", "confirmed", "en_route", "cancelled"]) {
      expect(futureStatusError(future, s)).toBeNull();
    }
  });

  it("leaves back-filling alone — any status on a past date is fine", () => {
    // Owners routinely reconstruct history when switching tools. The previous
    // guard blocked this and was removed for exactly that reason.
    for (const s of ["completed", "in_progress", "confirmed", "cancelled"]) {
      expect(futureStatusError(past, s)).toBeNull();
    }
  });

  it("does not throw on an unparseable date", () => {
    expect(futureStatusError("not-a-date", "completed")).toBeNull();
  });
});

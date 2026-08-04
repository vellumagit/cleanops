import { describe, it, expect } from "vitest";
import {
  futureStatusError,
  EARLY_START_GRACE_MINUTES,
  WRITABLE_BOOKING_STATUSES,
  BOOKING_STATUS_TRANSITIONS,
  statusDropdownOptions,
} from "./booking-status";

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

describe("WRITABLE_BOOKING_STATUSES", () => {
  it("includes pending — it has three producers and is form-selectable", () => {
    // The estimate-to-booking conversion, Duplicate, and now the form itself.
    expect(WRITABLE_BOOKING_STATUSES).toContain("pending");
  });

  it("excludes en_route — still in the enum, but nothing produces one", () => {
    // Postgres can't drop enum values, so the DB will accept it forever. The
    // app should not offer or accept what it has no meaning for.
    expect(WRITABLE_BOOKING_STATUSES).not.toContain("en_route");
  });

  it("never blocks pending on a date, however far out", () => {
    // Pencilling in a job months ahead is the entire point of the status.
    expect(futureStatusError(at(365 * 24 * 60), "pending", NOW)).toBeNull();
  });
});

describe("statusDropdownOptions", () => {
  it("offers pending a way out — it used to be a dead end", () => {
    // Duplicate creates pending bookings, and with no `pending` key the
    // server's lookup fell through to [] and refused every target. The list
    // dropdown could not move a duplicated booking at all.
    expect(statusDropdownOptions("pending")).toEqual([
      "pending",
      "confirmed",
      "cancelled",
    ]);
  });

  it("won't let one click take pending straight to completed", () => {
    // → completed auto-invoices. Billing a client for a job nobody confirmed
    // is the wrong end of that mistake to find out from.
    expect(statusDropdownOptions("pending")).not.toContain("completed");
    expect(statusDropdownOptions("pending")).not.toContain("in_progress");
  });

  it("always leads with the current status so it reads as selected", () => {
    for (const s of ["pending", "confirmed", "in_progress"]) {
      expect(statusDropdownOptions(s)[0]).toBe(s);
    }
  });

  it("gives terminal statuses nothing — they render as a plain badge", () => {
    expect(statusDropdownOptions("completed")).toEqual([]);
    expect(statusDropdownOptions("cancelled")).toEqual([]);
  });

  it("never offers a status the app cannot write", () => {
    for (const from of Object.keys(BOOKING_STATUS_TRANSITIONS)) {
      for (const to of statusDropdownOptions(from)) {
        expect(WRITABLE_BOOKING_STATUSES).toContain(to);
      }
    }
  });
});

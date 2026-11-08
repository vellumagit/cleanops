import { describe, expect, it } from "vitest";
import {
  getScheduleConflictWindows,
  hasSplitScheduleConflict,
  type ScheduleAssignment,
  type SegmentWindow,
} from "./segment-conflicts";

const start = "2026-11-09T15:00:00.000Z";
const segments: SegmentWindow[] = [
  { membership_id: "early-cleaner", start_offset_minutes: 0, duration_minutes: 120 },
  { membership_id: "late-cleaner", start_offset_minutes: 240, duration_minutes: 120 },
];

function assignment(
  overrides: Partial<ScheduleAssignment> = {},
): ScheduleAssignment {
  return {
    booking_id: "other-booking",
    membership_id: "late-cleaner",
    scheduled_at: "2026-11-09T19:30:00.000Z",
    booking_duration_minutes: 60,
    status: "confirmed",
    split_start_offset_minutes: null,
    split_duration_minutes: null,
    ...overrides,
  };
}

describe("proposed schedule conflict windows", () => {
  it("keeps a regular booking interval that crosses midnight", () => {
    expect(
      getScheduleConflictWindows({
        scheduledAt: "2026-11-09T23:30:00.000Z",
        bookingDuration: 120,
        segments: [
          {
            membership_id: "cleaner",
            start_offset_minutes: null,
            duration_minutes: null,
          },
        ],
      }),
    ).toEqual([
      {
        membership_id: "cleaner",
        start_at: "2026-11-09T23:30:00.000Z",
        end_at: "2026-11-10T01:30:00.000Z",
      },
    ]);
  });

  it("applies split offsets and durations across midnight", () => {
    expect(
      getScheduleConflictWindows({
        scheduledAt: "2026-11-09T23:30:00.000Z",
        bookingDuration: 180,
        segments: [
          {
            membership_id: "late-cleaner",
            start_offset_minutes: 90,
            duration_minutes: 90,
          },
        ],
      }),
    ).toEqual([
      {
        membership_id: "late-cleaner",
        start_at: "2026-11-10T01:00:00.000Z",
        end_at: "2026-11-10T02:30:00.000Z",
      },
    ]);
  });
});

describe("split schedule conflict detection", () => {
  it("detects an assignment that started the previous day", () => {
    expect(
      hasSplitScheduleConflict({
        bookingId: "moving-booking",
        scheduledAt: "2026-11-10T00:00:00.000Z",
        bookingDuration: 60,
        segments: [
          {
            membership_id: "late-cleaner",
            start_offset_minutes: null,
            duration_minutes: null,
          },
        ],
        otherAssignments: [
          assignment({
            scheduled_at: "2026-11-09T23:30:00.000Z",
            booking_duration_minutes: 60,
          }),
        ],
      }),
    ).toBe(true);
  });

  it("detects an assignment that starts the following day", () => {
    expect(
      hasSplitScheduleConflict({
        bookingId: "moving-booking",
        scheduledAt: "2026-11-09T23:30:00.000Z",
        bookingDuration: 120,
        segments: [
          {
            membership_id: "late-cleaner",
            start_offset_minutes: null,
            duration_minutes: null,
          },
        ],
        otherAssignments: [
          assignment({
            scheduled_at: "2026-11-10T00:30:00.000Z",
            booking_duration_minutes: 30,
          }),
        ],
      }),
    ).toBe(true);
  });

  it("detects overlap with the affected cleaner's later segment", () => {
    expect(
      hasSplitScheduleConflict({
        bookingId: "moving-booking",
        scheduledAt: start,
        bookingDuration: 360,
        segments,
        otherAssignments: [assignment()],
      }),
    ).toBe(true);
  });

  it("does not reject a job that overlaps only the booking's empty gap", () => {
    expect(
      hasSplitScheduleConflict({
        bookingId: "moving-booking",
        scheduledAt: start,
        bookingDuration: 360,
        segments,
        otherAssignments: [
          assignment({
            scheduled_at: "2026-11-09T17:30:00.000Z",
            booking_duration_minutes: 30,
          }),
        ],
      }),
    ).toBe(false);
  });

  it("uses a competing split assignment's own window", () => {
    expect(
      hasSplitScheduleConflict({
        bookingId: "moving-booking",
        scheduledAt: start,
        bookingDuration: 360,
        segments,
        otherAssignments: [
          assignment({
            scheduled_at: "2026-11-09T15:00:00.000Z",
            booking_duration_minutes: 360,
            split_start_offset_minutes: 0,
            split_duration_minutes: 60,
          }),
        ],
      }),
    ).toBe(false);
  });

  it("detects overlap with a competing split assignment's actual window", () => {
    expect(
      hasSplitScheduleConflict({
        bookingId: "moving-booking",
        scheduledAt: start,
        bookingDuration: 360,
        segments,
        otherAssignments: [
          assignment({
            scheduled_at: start,
            booking_duration_minutes: 360,
            split_start_offset_minutes: 270,
            split_duration_minutes: 30,
          }),
        ],
      }),
    ).toBe(true);
  });

  it("treats a helper without split metadata as assigned for the whole booking", () => {
    expect(
      hasSplitScheduleConflict({
        bookingId: "moving-booking",
        scheduledAt: start,
        bookingDuration: 360,
        segments: [
          ...segments,
          {
            membership_id: "helper",
            start_offset_minutes: null,
            duration_minutes: null,
          },
        ],
        otherAssignments: [
          assignment({
            membership_id: "helper",
            scheduled_at: "2026-11-09T16:00:00.000Z",
            booking_duration_minutes: 30,
          }),
        ],
      }),
    ).toBe(true);
  });

  it("ignores the moved booking itself and cancelled assignments", () => {
    expect(
      hasSplitScheduleConflict({
        bookingId: "moving-booking",
        scheduledAt: start,
        bookingDuration: 360,
        segments,
        otherAssignments: [
          assignment({ booking_id: "moving-booking" }),
          assignment({ status: "cancelled" }),
        ],
      }),
    ).toBe(false);
  });
});

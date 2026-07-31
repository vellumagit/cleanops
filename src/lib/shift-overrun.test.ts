import { describe, it, expect } from "vitest";
import {
  resolveClockOutThresholds,
  closedEntryOverrunMinutes,
  expectedEndMs,
  DEFAULT_GRACE_MINUTES,
  DEFAULT_REMINDER_INTERVAL_MINUTES,
  MAX_GRACE_MINUTES,
  MIN_GRACE_MINUTES,
} from "./shift-overrun";

const T = (iso: string) => new Date(iso).getTime();

describe("resolveClockOutThresholds", () => {
  it("falls back to the pre-settings behaviour when unconfigured", () => {
    for (const input of [null, undefined, {}, { shift_clock_out_reminder: {} }]) {
      expect(resolveClockOutThresholds(input)).toEqual({
        graceMinutes: DEFAULT_GRACE_MINUTES,
        reminderIntervalMinutes: DEFAULT_REMINDER_INTERVAL_MINUTES,
      });
    }
  });

  it("reads configured values", () => {
    expect(
      resolveClockOutThresholds({
        shift_clock_out_reminder: {
          enabled: true,
          grace_minutes: 45,
          reminder_interval_minutes: 15,
        },
      }),
    ).toEqual({ graceMinutes: 45, reminderIntervalMinutes: 15 });
  });

  it("snaps to 5-minute steps", () => {
    const r = resolveClockOutThresholds({
      shift_clock_out_reminder: {
        grace_minutes: 47,
        reminder_interval_minutes: 13,
      },
    });
    expect(r.graceMinutes).toBe(45);
    expect(r.reminderIntervalMinutes).toBe(15);
  });

  it("clamps so a bad value can't disable the guard", () => {
    // 30 days of grace is indistinguishable from no guard at all — the exact
    // failure mode (a 68-hour entry) this subsystem exists to catch.
    expect(
      resolveClockOutThresholds({
        shift_clock_out_reminder: { grace_minutes: 43_200 },
      }).graceMinutes,
    ).toBe(MAX_GRACE_MINUTES);
    expect(
      resolveClockOutThresholds({
        shift_clock_out_reminder: { grace_minutes: 0 },
      }).graceMinutes,
    ).toBe(MIN_GRACE_MINUTES);
  });

  it("ignores garbage rather than throwing", () => {
    expect(
      resolveClockOutThresholds({
        shift_clock_out_reminder: { grace_minutes: "banana" },
      }).graceMinutes,
    ).toBe(DEFAULT_GRACE_MINUTES);
    expect(
      resolveClockOutThresholds({ shift_clock_out_reminder: null }),
    ).toEqual({
      graceMinutes: DEFAULT_GRACE_MINUTES,
      reminderIntervalMinutes: DEFAULT_REMINDER_INTERVAL_MINUTES,
    });
  });
});

describe("expectedEndMs", () => {
  it("uses the scheduled start when the cleaner arrives early", () => {
    // 42% of real entries clock in before their booking. Anchoring to
    // clock-in would invent an overrun for all of them.
    expect(
      expectedEndMs({
        clockInMs: T("2026-07-30T08:50:00Z"),
        scheduledStartMs: T("2026-07-30T09:00:00Z"),
        scheduledMinutes: 120,
      }),
    ).toBe(T("2026-07-30T11:00:00Z"));
  });

  it("uses clock-in when the cleaner starts late, preserving the full window", () => {
    expect(
      expectedEndMs({
        clockInMs: T("2026-07-30T09:40:00Z"),
        scheduledStartMs: T("2026-07-30T09:00:00Z"),
        scheduledMinutes: 120,
      }),
    ).toBe(T("2026-07-30T11:40:00Z"));
  });
});

describe("closedEntryOverrunMinutes", () => {
  const base = {
    clockInIso: "2026-07-30T09:00:00Z",
    scheduledStartIso: "2026-07-30T09:00:00Z",
    scheduledMinutes: 120,
  };

  it("is 0 within the allotment", () => {
    expect(
      closedEntryOverrunMinutes({
        ...base,
        clockOutIso: "2026-07-30T10:30:00Z",
      }),
    ).toBe(0);
  });

  it("is 0 exactly at the allotment, not 1", () => {
    expect(
      closedEntryOverrunMinutes({
        ...base,
        clockOutIso: "2026-07-30T11:00:00Z",
      }),
    ).toBe(0);
  });

  it("reports whole minutes over", () => {
    expect(
      closedEntryOverrunMinutes({
        ...base,
        clockOutIso: "2026-07-30T12:15:00Z",
      }),
    ).toBe(75);
  });

  it("does not count an early start as overrun", () => {
    expect(
      closedEntryOverrunMinutes({
        clockInIso: "2026-07-30T08:45:00Z",
        clockOutIso: "2026-07-30T11:00:00Z",
        scheduledStartIso: "2026-07-30T09:00:00Z",
        scheduledMinutes: 120,
      }),
    ).toBe(0);
  });

  it("measures a divided team job against the per-person share", () => {
    // 6h two-person job with hours divided = 3h each. Someone who worked the
    // full 6h alone is 3h over, and must not read as on-target.
    expect(
      closedEntryOverrunMinutes({
        clockInIso: "2026-07-30T09:00:00Z",
        clockOutIso: "2026-07-30T15:00:00Z",
        scheduledStartIso: "2026-07-30T09:00:00Z",
        scheduledMinutes: 180,
      }),
    ).toBe(180);
  });

  it("a split-shift segment measured from its OWN start is not an overrun", () => {
    // Production shape: booking b536cc7c (Svit) — scheduled 16:00Z, 240 min,
    // crew of 2, split into two 120-minute segments. Anastasiia holds the
    // SECOND segment (offset 120), so her window is 18:00Z-20:00Z. She
    // clocked in at 15:59:10Z and out at 18:33:31Z — 87 minutes BEFORE her
    // segment was due to end.
    //
    // Anchored to her segment start: 0 over, which is the truth.
    expect(
      closedEntryOverrunMinutes({
        clockInIso: "2026-06-05T15:59:10Z",
        clockOutIso: "2026-06-05T18:33:31Z",
        scheduledStartIso: "2026-06-05T18:00:00Z", // 16:00 + 120min offset
        scheduledMinutes: 120,
      }),
    ).toBe(0);

    // Anchored to the BOOKING's start with duration/crew, which is what the
    // timesheet and /field/hours did, it invents 33 minutes.
    expect(
      closedEntryOverrunMinutes({
        clockInIso: "2026-06-05T15:59:10Z",
        clockOutIso: "2026-06-05T18:33:31Z",
        scheduledStartIso: "2026-06-05T16:00:00Z",
        scheduledMinutes: 120,
      }),
    ).toBe(33);
  });

  it("an asymmetric split is not duration/crew", () => {
    // Production: booking 433caeb1 — 825 minutes, crew 2, real segments of
    // 600 and 225. Dividing by crew would allot 413 to both, which is wrong
    // for each of them in opposite directions.
    expect(
      closedEntryOverrunMinutes({
        clockInIso: "2026-06-01T14:00:00Z",
        clockOutIso: "2026-06-02T00:00:00Z", // 600 min exactly
        scheduledStartIso: "2026-06-01T14:00:00Z",
        scheduledMinutes: 600,
      }),
    ).toBe(0);
    // Same shift judged against 413 minutes would report 187 minutes over.
    expect(
      closedEntryOverrunMinutes({
        clockInIso: "2026-06-01T14:00:00Z",
        clockOutIso: "2026-06-02T00:00:00Z",
        scheduledStartIso: "2026-06-01T14:00:00Z",
        scheduledMinutes: 413,
      }),
    ).toBe(187);
  });

  it("returns 0 rather than guessing when there is nothing to be over", () => {
    expect(
      closedEntryOverrunMinutes({ ...base, clockOutIso: null }),
    ).toBe(0);
    expect(
      closedEntryOverrunMinutes({
        ...base,
        clockOutIso: "2026-07-30T23:00:00Z",
        scheduledMinutes: null,
      }),
    ).toBe(0);
    expect(
      closedEntryOverrunMinutes({
        ...base,
        clockOutIso: "2026-07-30T23:00:00Z",
        scheduledMinutes: 0,
      }),
    ).toBe(0);
  });

  it("falls back to clock-in for a standalone shift with no booking start", () => {
    expect(
      closedEntryOverrunMinutes({
        clockInIso: "2026-07-30T09:00:00Z",
        clockOutIso: "2026-07-30T12:00:00Z",
        scheduledStartIso: null,
        scheduledMinutes: 120,
      }),
    ).toBe(60);
  });
});

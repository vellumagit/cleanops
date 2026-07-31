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

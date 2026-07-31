/**
 * Shift-overrun arithmetic and the per-org thresholds that govern it.
 *
 * Deliberately dependency-free and NOT a "use client" module: the same
 * numbers have to come out on the cleaner's phone (src/app/field/use-elapsed.ts
 * re-exports from here), in the every-30-minutes cron
 * (sendShiftClockOutReminders), and on the office timesheet. When those three
 * disagreed, the alert email said "4.0h over" for a 2-hour overrun — the bug
 * this module exists to make structurally impossible.
 */

/** Expected length for a clock-in with no booking attached. */
export const STANDALONE_SHIFT_MAX_MIN = 12 * 60;

/** What a fresh org gets, and what every org got before this was settable. */
export const DEFAULT_GRACE_MINUTES = 120;
export const DEFAULT_REMINDER_INTERVAL_MINUTES = 30;

/** Thresholds are chosen in 5-minute steps — see resolveClockOutThresholds. */
export const THRESHOLD_STEP_MINUTES = 5;

/**
 * Bounds. The floor is one step: a 0-minute grace would cap a shift the
 * instant it ran a second long. The ceilings stop a typo turning the guard
 * off entirely — 24h of grace is indistinguishable from no guard at all,
 * which is exactly the 68-hour entry this whole subsystem exists to catch.
 */
export const MIN_GRACE_MINUTES = 5;
export const MAX_GRACE_MINUTES = 24 * 60;
export const MIN_REMINDER_INTERVAL_MINUTES = 5;
export const MAX_REMINDER_INTERVAL_MINUTES = 8 * 60;

export type ClockOutThresholds = {
  graceMinutes: number;
  reminderIntervalMinutes: number;
};

/** Round to the nearest 5 and clamp. Invalid/absent input falls back to `fb`. */
function normalize(raw: unknown, fb: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fb;
  const stepped =
    Math.round(n / THRESHOLD_STEP_MINUTES) * THRESHOLD_STEP_MINUTES;
  return Math.min(max, Math.max(min, stepped));
}

/**
 * Read the org's configured thresholds out of the automation_settings blob.
 *
 * Takes the whole settings object rather than one entry so callers can't
 * accidentally read a different automation's config, and so a missing key
 * degrades to the documented defaults instead of throwing.
 */
export function resolveClockOutThresholds(
  automationSettings: Record<string, unknown> | null | undefined,
): ClockOutThresholds {
  const entry = automationSettings?.["shift_clock_out_reminder"];
  const cfg =
    entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
  return {
    graceMinutes: normalize(
      cfg.grace_minutes,
      DEFAULT_GRACE_MINUTES,
      MIN_GRACE_MINUTES,
      MAX_GRACE_MINUTES,
    ),
    reminderIntervalMinutes: normalize(
      cfg.reminder_interval_minutes,
      DEFAULT_REMINDER_INTERVAL_MINUTES,
      MIN_REMINDER_INTERVAL_MINUTES,
      MAX_REMINDER_INTERVAL_MINUTES,
    ),
  };
}

/**
 * When a shift was due to end.
 *
 *     max(scheduledStart, clockIn) + length
 *
 * The max() is load-bearing in both directions. Anchoring to clock-in alone
 * invents an overrun for anyone who starts early — 42% of real entries do —
 * while anchoring to the scheduled start alone would cut short someone who
 * started late. Pass scheduledStartMs === clockInMs for a standalone shift.
 */
export function expectedEndMs({
  clockInMs,
  scheduledStartMs,
  scheduledMinutes,
}: {
  clockInMs: number;
  scheduledStartMs: number;
  scheduledMinutes: number;
}): number {
  return Math.max(clockInMs, scheduledStartMs) + scheduledMinutes * 60_000;
}

/**
 * Whole minutes a shift ran past its expected end, or 0 if it didn't.
 *
 * Whole minutes rather than milliseconds so a label can never read "0m over",
 * and so the office timesheet and the field card round identically.
 */
export function overrunMinutes({
  clockInMs,
  scheduledStartMs,
  scheduledMinutes,
  nowMs,
}: {
  clockInMs: number;
  scheduledStartMs: number;
  scheduledMinutes: number;
  nowMs: number;
}): number {
  const end = expectedEndMs({ clockInMs, scheduledStartMs, scheduledMinutes });
  return Math.max(0, Math.floor((nowMs - end) / 60_000));
}

/**
 * Overrun for a CLOSED entry — the timesheet case. Same arithmetic, but the
 * end of the window is the recorded clock-out rather than "now", so a shift
 * that was capped or corrected reports what it actually recorded.
 *
 * Returns 0 when the booking has no usable length: a job with no duration
 * has no allotment to be over, and guessing one would flag every entry.
 */
export function closedEntryOverrunMinutes({
  clockInIso,
  clockOutIso,
  scheduledStartIso,
  scheduledMinutes,
}: {
  clockInIso: string | null;
  clockOutIso: string | null;
  scheduledStartIso: string | null;
  scheduledMinutes: number | null;
}): number {
  if (!clockInIso || !clockOutIso || !scheduledMinutes || scheduledMinutes <= 0)
    return 0;
  const clockInMs = new Date(clockInIso).getTime();
  const outMs = new Date(clockOutIso).getTime();
  if (!Number.isFinite(clockInMs) || !Number.isFinite(outMs)) return 0;
  // No booking start (standalone shift) → measure from clock-in.
  const startMs = scheduledStartIso
    ? new Date(scheduledStartIso).getTime()
    : clockInMs;
  return overrunMinutes({
    clockInMs,
    scheduledStartMs: Number.isFinite(startMs) ? startMs : clockInMs,
    scheduledMinutes,
    nowMs: outMs,
  });
}

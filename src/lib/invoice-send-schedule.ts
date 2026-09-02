/**
 * WHEN a drafted invoice goes out — the org's sending rhythm.
 *
 * Auto-send used to have one shape: the configured hour on the day after the
 * draft appeared. Good default, but it makes the send time a function of when
 * the job happened to finish, which is nobody's preferred rhythm. An owner who
 * would rather look at the week's invoices once and release them together had
 * no way to say so.
 *
 * Three modes, all landing on the SAME configured hour so the clock time is
 * always predictable and the morning digest always lands first:
 *
 *   next_day      the send hour tomorrow. Unchanged, still the default.
 *   delay_hours   at least N hours of review, then the next time the clock
 *                 reaches the send hour. "48 hours after", in plain terms.
 *   weekday       every Friday (or any day) at the send hour, whatever day
 *                 the draft was raised.
 *
 * Pure: hand it "now" and the settings, get an instant back. No database, no
 * side effects — the money-adjacent decision of when a client hears from you
 * should be testable without one.
 *
 * This governs PER-JOB drafts. Clients on a weekly/biweekly/monthly billing
 * cadence keep their own rhythm; invoice_auto_send_consolidated is their
 * separate opt-out.
 */

import { nextDayAtHourUtc, nextWeekdayAtHourUtc, formatHourLabel } from "@/lib/wall-clock";

export const SEND_MODES = ["next_day", "delay_hours", "weekday"] as const;
export type SendMode = (typeof SEND_MODES)[number];

export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Offered in the settings dropdown. Hours, because "2 days" is ambiguous
 *  about which clock it lands on and this one never is. */
export const DELAY_CHOICES = [24, 48, 72] as const;

/**
 * A weekday slot must be at least this far out. Without it, a draft raised at
 * 4:59 PM on the send day gets a one-minute review window — the opposite of
 * what someone choosing "every Friday" is asking for. An hour is enough to
 * catch a typo; anything longer would push a Friday-morning invoice to the
 * following week, which nobody means either.
 */
export const MIN_REVIEW_MINUTES = 60;

export type SendSchedule = {
  mode: SendMode;
  /** 0–23, org-local. */
  hour: number;
  /** delay_hours mode only. */
  delayHours?: number | null;
  /** weekday mode only. 0=Sunday … 6=Saturday. */
  weekday?: number | null;
};

type NormalizedSchedule = {
  mode: SendMode;
  hour: number;
  delayHours: number;
  weekday: number;
};

/** Fall back to the old behaviour on anything malformed — a bad setting must
 *  never mean "send immediately" or "never send". */
function normalize(schedule: SendSchedule): NormalizedSchedule {
  const hour =
    Number.isInteger(schedule.hour) && schedule.hour >= 0 && schedule.hour <= 23
      ? schedule.hour
      : 17;
  const delayHours =
    Number.isInteger(schedule.delayHours) &&
    (schedule.delayHours as number) >= 1 &&
    (schedule.delayHours as number) <= 168
      ? (schedule.delayHours as number)
      : 24;
  const weekday =
    Number.isInteger(schedule.weekday) &&
    (schedule.weekday as number) >= 0 &&
    (schedule.weekday as number) <= 6
      ? (schedule.weekday as number)
      : 5; // Friday
  const mode = (SEND_MODES as readonly string[]).includes(schedule.mode)
    ? schedule.mode
    : "next_day";
  return { mode, hour, delayHours, weekday };
}

/**
 * The instant this draft should go out, given when it was raised.
 *
 * `from` is normally "now" (a draft is being scheduled) but is a parameter so
 * the settings screen can preview the next slot, and so tests can pin it.
 */
export function computeSendSlot(
  from: Date,
  tz: string,
  schedule: SendSchedule,
): Date {
  const { mode, hour, delayHours, weekday } = normalize(schedule);

  if (mode === "weekday") {
    const earliest = new Date(from.getTime() + MIN_REVIEW_MINUTES * 60_000);
    return nextWeekdayAtHourUtc(earliest, tz, weekday, hour);
  }

  if (mode === "delay_hours") {
    // At least `delayHours` of review, then the next time the clock strikes
    // the send hour. Walking from (from + delay) means a 48-hour setting can
    // land on the third calendar day — correct: it is a review window, not a
    // day count.
    const earliest = new Date(from.getTime() + delayHours * 3_600_000);
    let slot = nextDayAtHourUtc(
      new Date(earliest.getTime() - 24 * 3_600_000),
      tz,
      hour,
    );
    // nextDayAtHourUtc is "tomorrow at hour" relative to its argument, so the
    // line above aims at the day `earliest` falls on. If that slot is already
    // behind `earliest`, take the following day.
    if (slot.getTime() < earliest.getTime()) {
      slot = nextDayAtHourUtc(earliest, tz, hour);
    }
    return slot;
  }

  return nextDayAtHourUtc(from, tz, hour);
}

/** "every Friday at 5:00 PM" — one sentence, used in settings, the digest,
 *  and anywhere else that has to tell someone when their invoices leave. */
export function describeSendSchedule(schedule: SendSchedule): string {
  const { mode, hour, delayHours, weekday } = normalize(schedule);
  const at = formatHourLabel(hour);
  if (mode === "weekday") return `every ${WEEKDAY_LABELS[weekday]} at ${at}`;
  if (mode === "delay_hours") {
    const days = delayHours % 24 === 0 ? delayHours / 24 : null;
    const window =
      days === 1
        ? "24 hours"
        : days
          ? `${delayHours} hours`
          : `${delayHours} hour${delayHours === 1 ? "" : "s"}`;
    return `${window} after drafting, at ${at}`;
  }
  return `the day after drafting, at ${at}`;
}

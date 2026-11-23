/**
 * The rules a company sets for online booking, read from and written to its
 * booking page (migration 20261122030000). Pure, so reading a damaged value
 * and checking what someone typed are tested without a database.
 */
import type { Hours, OpenTimeRules } from "@/lib/open-times";

export const WEEKDAYS = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
] as const;

export const STEP_CHOICES = [15, 30, 60] as const;

export const DEFAULT_RULES: OpenTimeRules = {
  openingHours: {},
  minNoticeHours: 24,
  maxDaysAhead: 60,
  gapMinutes: 30,
  stepMinutes: 30,
};

/** What a new page is offered to start from: weekdays, nine to five. Shown
 *  in the form, saved only when the company presses Save. */
export const SUGGESTED_HOURS: Record<number, Hours[]> = Object.fromEntries(
  [1, 2, 3, 4, 5].map((d) => [d, [{ start: "09:00", end: "17:00" }]]),
);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const int = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** Stored opening hours, with anything unreadable dropped. A day that can't
 *  be read is closed: an unreadable setting must never open a day. */
export function readOpeningHours(raw: unknown): Record<number, Hours[]> {
  const out: Record<number, Hours[]> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const day = Number(key);
    if (!Number.isInteger(day) || day < 0 || day > 6 || !Array.isArray(value)) continue;
    const blocks = value
      .map((b) => (b ?? {}) as { start?: unknown; end?: unknown })
      .filter((b): b is Hours => typeof b.start === "string" && typeof b.end === "string" && HHMM.test(b.start) && HHMM.test(b.end) && b.start < b.end)
      .map((b) => ({ start: b.start, end: b.end }));
    if (blocks.length > 0) out[day] = blocks;
  }
  return out;
}

/** The rules as the engine wants them, from a booking_pages row. */
export function readRules(row: {
  opening_hours?: unknown;
  min_notice_hours?: unknown;
  max_days_ahead?: unknown;
  gap_minutes?: unknown;
  slot_step_minutes?: unknown;
} | null | undefined): OpenTimeRules {
  const step = int(row?.slot_step_minutes, DEFAULT_RULES.stepMinutes, 5, 240);
  return {
    openingHours: readOpeningHours(row?.opening_hours),
    minNoticeHours: int(row?.min_notice_hours, DEFAULT_RULES.minNoticeHours, 0, 720),
    maxDaysAhead: int(row?.max_days_ahead, DEFAULT_RULES.maxDaysAhead, 0, 365),
    gapMinutes: int(row?.gap_minutes, DEFAULT_RULES.gapMinutes, 0, 240),
    stepMinutes: (STEP_CHOICES as readonly number[]).includes(step) ? step : DEFAULT_RULES.stepMinutes,
  };
}

/**
 * What the settings form posted, checked. One stretch per weekday for now:
 * `open_<day>` ticked, with `start_<day>` and `end_<day>`.
 */
export function parseRulesForm(get: (name: string) => string): { ok: true; rules: OpenTimeRules } | { ok: false; error: string } {
  const openingHours: Record<number, Hours[]> = {};
  for (const { day, label } of WEEKDAYS) {
    if (get(`open_${day}`) !== "on") continue;
    const start = get(`start_${day}`).slice(0, 5);
    const end = get(`end_${day}`).slice(0, 5);
    if (!HHMM.test(start) || !HHMM.test(end)) return { ok: false, error: `${label}: set an opening and a closing time, or untick the day.` };
    if (start >= end) return { ok: false, error: `${label}: closing has to be after opening.` };
    openingHours[day] = [{ start, end }];
  }
  const whole = (name: string, label: string, min: number, max: number): number | string => {
    const text = get(name).trim();
    if (!/^\d{1,4}$/.test(text)) return `${label}: type a whole number.`;
    const n = Number(text);
    return n < min || n > max ? `${label}: between ${min} and ${max}.` : n;
  };
  const notice = whole("min_notice_hours", "Notice", 0, 720);
  if (typeof notice === "string") return { ok: false, error: notice };
  const ahead = whole("max_days_ahead", "How far ahead", 0, 365);
  if (typeof ahead === "string") return { ok: false, error: ahead };
  const gap = whole("gap_minutes", "Gap between jobs", 0, 240);
  if (typeof gap === "string") return { ok: false, error: gap };
  const step = Number(get("slot_step_minutes"));
  if (!(STEP_CHOICES as readonly number[]).includes(step)) return { ok: false, error: "Choose how far apart the start times are." };
  return { ok: true, rules: { openingHours, minNoticeHours: notice, maxDaysAhead: ahead, gapMinutes: gap, stepMinutes: step } };
}

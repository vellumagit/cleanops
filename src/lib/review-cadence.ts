/**
 * How often a client may be ASKED for an internal review — Brian: weekly
 * clients were getting "how did we do?" every month forever, and "one
 * person already left a review and she doesn't wanna leave more."
 *
 * Stored beside the toggle it configures:
 * organizations.automation_settings.review_request_after_completion.frequency
 * (same precedent as shift_clock_out_reminder's thresholds). Absent = the
 * legacy 30-day minimum gap, so nothing changes for an org until its owner
 * picks a cadence. Leaving a review voluntarily is never throttled — the
 * portal's per-visit links exist precisely so asking can be rare.
 */

export const REVIEW_ASK_FREQUENCY_OPTIONS = [
  { value: "every_clean", label: "After every clean (30-day minimum gap)", days: 30 },
  { value: "quarterly", label: "4× a year", days: 91 },
  { value: "twice_yearly", label: "2× a year", days: 182 },
  { value: "yearly", label: "Once a year", days: 365 },
] as const;

export type ReviewAskFrequency =
  (typeof REVIEW_ASK_FREQUENCY_OPTIONS)[number]["value"];

export function isReviewAskFrequency(v: string): v is ReviewAskFrequency {
  return REVIEW_ASK_FREQUENCY_OPTIONS.some((o) => o.value === v);
}

/** The org's configured frequency, defaulting to legacy behavior. */
export function reviewAskFrequency(
  automationSettings: unknown,
): ReviewAskFrequency {
  const raw = (
    automationSettings as
      | { review_request_after_completion?: { frequency?: unknown } }
      | null
      | undefined
  )?.review_request_after_completion?.frequency;
  return typeof raw === "string" && isReviewAskFrequency(raw)
    ? raw
    : "every_clean";
}

/** Minimum days between asks (and after a submitted review) per org. */
export function reviewAskGapDays(automationSettings: unknown): number {
  const freq = reviewAskFrequency(automationSettings);
  return (
    REVIEW_ASK_FREQUENCY_OPTIONS.find((o) => o.value === freq)?.days ?? 30
  );
}

/** Same idea for the rebooking nudge — "same thing for rebooking prompt". */
export const REBOOKING_FREQUENCY_OPTIONS = [
  { value: "monthly", label: "Monthly (30-day minimum gap)", days: 30 },
  { value: "quarterly", label: "4× a year", days: 91 },
  { value: "twice_yearly", label: "2× a year", days: 182 },
  { value: "yearly", label: "Once a year", days: 365 },
] as const;

export type RebookingFrequency =
  (typeof REBOOKING_FREQUENCY_OPTIONS)[number]["value"];

export function isRebookingFrequency(v: string): v is RebookingFrequency {
  return REBOOKING_FREQUENCY_OPTIONS.some((o) => o.value === v);
}

export function rebookingGapDays(automationSettings: unknown): number {
  const raw = (
    automationSettings as
      | { rebooking_prompt_email?: { frequency?: unknown } }
      | null
      | undefined
  )?.rebooking_prompt_email?.frequency;
  const freq = typeof raw === "string" && isRebookingFrequency(raw) ? raw : "monthly";
  return REBOOKING_FREQUENCY_OPTIONS.find((o) => o.value === freq)?.days ?? 30;
}

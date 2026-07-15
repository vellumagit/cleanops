/** Length of the free trial, in days. */
export const TRIAL_DAYS = 14;

/**
 * Whole days remaining in an org's free trial, given when the trial started and
 * the current time (ms). Ceil'd, clamped to [0, trialDays].
 *
 * A null/undefined/invalid `trialStartedAt` means no trial clock has been set,
 * so the full trial is available.
 *
 * Pure + dependency-free so it can be unit-tested and shared. Used at checkout
 * to carry only the REMAINING trial onto the Stripe subscription — otherwise a
 * user who subscribes after their local trial would get a second full trial.
 */
export function remainingTrialDays(
  trialStartedAt: string | Date | null | undefined,
  nowMs: number,
  trialDays: number = TRIAL_DAYS,
): number {
  if (!trialStartedAt) return trialDays;
  const startMs = new Date(trialStartedAt).getTime();
  if (!Number.isFinite(startMs)) return trialDays;
  const dayMs = 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((startMs + trialDays * dayMs - nowMs) / dayMs);
  return Math.min(trialDays, Math.max(0, daysLeft));
}

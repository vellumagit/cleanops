/**
 * A job that has not started yet cannot be finished.
 *
 * The old guard rejected pending/confirmed/en_route on a PAST date to catch
 * typos, and was removed because back-filling historical jobs is legitimate
 * and common. The inverse was never added — so a booking two days out could
 * be saved as `completed`, which is not a typo class anyone recovers from by
 * noticing: it also silently swallows the crew's accept prompt, because the
 * field app computes needs_acceptance as
 * `acceptance_status === "pending" && status !== "completed"`
 * (src/app/field/jobs/data.ts:177). The cleaner simply never sees the shift.
 *
 * Observed live: booking a766d848, created 2026-08-03 for 2026-08-05, saved
 * completed, with a pending booking_assignees row Jim was never shown.
 *
 * Back-filling still works — a past date with any status is untouched.
 */
export function futureStatusError(
  scheduledAtIso: string,
  status: string,
): string | null {
  if (status !== "completed" && status !== "in_progress") return null;
  const start = new Date(scheduledAtIso).getTime();
  if (!Number.isFinite(start) || start <= Date.now()) return null;
  return status === "completed"
    ? "This job is scheduled in the future, so it can't be marked completed yet. Save it as Confirmed — it can be completed once it has started."
    : "This job is scheduled in the future, so it can't be marked in progress yet.";
}

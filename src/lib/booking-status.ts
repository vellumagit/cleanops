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

/**
 * How far BEFORE its scheduled start a job may already be running or finished.
 *
 * The first version of this guard rejected `in_progress` on any future date,
 * which contradicts what the rest of the codebase assumes — see the comment at
 * bookings/actions.ts:1372, "a future-dated occurrence can legitimately be
 * in_progress (a cleaner can start early)". That is true and routine: a crew
 * finishes one job early and drives to the next, and the field app clocks them
 * in before the hour on the schedule. It is also possible, on a short job, to
 * finish before the scheduled start.
 *
 * So the invariant is not "not in the future" but "not far in the future". Four
 * hours covers any real early arrival while still catching the case this guard
 * exists for — a766d848 was created fifty hours ahead of its slot — and any
 * drag of a finished job into next week.
 */
export const EARLY_START_GRACE_MINUTES = 240;

export function futureStatusError(
  scheduledAtIso: string,
  status: string,
  now: number = Date.now(),
): string | null {
  if (status !== "completed" && status !== "in_progress") return null;
  const start = new Date(scheduledAtIso).getTime();
  if (!Number.isFinite(start)) return null;
  if (start <= now + EARLY_START_GRACE_MINUTES * 60_000) return null;
  return status === "completed"
    ? "This job is scheduled too far in the future to be marked completed. Save it as Confirmed — it can be completed once it has started."
    : "This job is scheduled too far in the future to be marked in progress.";
}

/**
 * The statuses the application actually writes.
 *
 * `en_route` is still in the Postgres enum — Postgres cannot drop enum values —
 * but 1081c28 retired it and nothing has produced one since. `pending` was
 * retired in the same commit and then quietly came back: the estimate-to-booking
 * conversion (automations.ts) and Duplicate (bookings/actions.ts) both create
 * pending bookings today. It is now selectable in the form as well.
 *
 * Kept here because the two /api/v1 routes had each grown their own copy of
 * this list, plus a third copy inside their error strings.
 */
export const WRITABLE_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export type WritableBookingStatus = (typeof WRITABLE_BOOKING_STATUSES)[number];

/** "pending, confirmed, in_progress, completed, cancelled" — for 400 bodies. */
export const WRITABLE_BOOKING_STATUS_LIST =
  WRITABLE_BOOKING_STATUSES.join(", ");

/**
 * Forward+cancel transitions the bookings-list status dropdown offers, keyed by
 * current status. Terminal statuses (completed, cancelled) have no entry and
 * render as a static badge instead.
 *
 * Lives here rather than beside the server action because the dropdown
 * component needs the same table to build its option list, and the action file
 * is "use server" — it can only export async functions. The two were separate
 * literals whose docstrings promised they matched; one gaining a `pending` key
 * without the other is a silent dead end, which is exactly what shipped.
 */
export const BOOKING_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  // Pending is the earliest state: confirm it or kill it. Deliberately not
  // → completed, which auto-invoices — one click should not bill a client for
  // a job that was never confirmed.
  pending: ["confirmed", "cancelled"],
  confirmed: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
};

/** What the dropdown shows for a booking at `status`: itself, then where it
 *  can go. Empty for a terminal status, which renders as a plain badge. */
export function statusDropdownOptions(status: string): readonly string[] {
  const next = BOOKING_STATUS_TRANSITIONS[status];
  return next ? [status, ...next] : [];
}

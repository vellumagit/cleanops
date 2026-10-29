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
  // Completed is no longer a locked door. Svitlana's July 17: the cleaner was
  // sick, nobody went, auto-complete marked it done anyway — and there was no
  // way back, so the books said a cancelled visit happened. Worse since
  // anchored billing: a phantom "completed" job is exactly what the catch-all
  // sweep bills next period. The ACTION still refuses when an invoice already
  // bills the job — undo the money first, then the status. Cancelled stays
  // terminal: nothing ever un-cancels silently.
  completed: ["cancelled"],
};

/**
 * The states a job can be in BEFORE anyone has worked it. Nothing here has
 * touched money or told a client a job is finished, so moving between them
 * costs nothing to undo.
 */
const PRE_WORK_STATUSES = ["pending", "confirmed", "cancelled"] as const;

/** Far enough ahead that the job plainly has not happened yet — the same
 *  threshold futureStatusError uses, so "in the future" means one thing. */
function isFutureDated(
  scheduledAtIso: string | null | undefined,
  now: number,
): boolean {
  if (!scheduledAtIso) return false;
  const start = new Date(scheduledAtIso).getTime();
  if (!Number.isFinite(start)) return false;
  return start > now + EARLY_START_GRACE_MINUTES * 60_000;
}

/**
 * Where a booking may go, given WHEN it is scheduled.
 *
 * The forward-only table above is right about history: you do not un-complete
 * a job an invoice bills, and you do not resurrect a cancelled visit the
 * client was told is off. But it was applied to the future as well, where
 * none of that reasoning holds — a job scheduled for tomorrow is a plan, not
 * a record. Svitlana moved a booking to tomorrow and could not put it back to
 * Pending to say "the client hasn't agreed to the new time yet", which
 * matters: the "your job is tomorrow" reminder fires for CONFIRMED only, and
 * a reschedule re-arms it. The rule left her one choice — leave it confirmed
 * and let the client be told a time they never agreed to.
 *
 * So: a future-dated booking can be set to any pre-work status. A past-dated
 * one keeps the strict ladder. The money guard on leaving `completed` lives
 * in the actions and applies either way.
 */
export function allowedTransitionsFor(
  status: string,
  scheduledAtIso: string | null | undefined,
  now: number = Date.now(),
): readonly string[] {
  const base = BOOKING_STATUS_TRANSITIONS[status] ?? [];
  // Only statuses the app still writes get the future-date freedom. A legacy
  // `en_route` row would otherwise gain a live dropdown whose first option is
  // its own current value — which the writer rejects as invalid. Retired and
  // unknown statuses keep rendering as a plain badge, exactly as before.
  if (!(WRITABLE_BOOKING_STATUSES as readonly string[]).includes(status)) {
    return base;
  }
  if (!isFutureDated(scheduledAtIso, now)) return base;
  // Exactly the pre-work statuses — which also REMOVES `completed` and
  // `in_progress` from the list. The strict table offered them on a job
  // scheduled for next week, and futureStatusError then refused the save;
  // an option that can only be rejected is worse than no option. The form's
  // status <select> already hides them past the same grace, so the two
  // surfaces now agree.
  return PRE_WORK_STATUSES.filter((s) => s !== status);
}

/** What the dropdown shows for a booking at `status`: itself, then where it
 *  can go. Empty for a terminal status, which renders as a plain badge. */
export function statusDropdownOptions(
  status: string,
  scheduledAtIso?: string | null,
): readonly string[] {
  const next = allowedTransitionsFor(status, scheduledAtIso);
  return next.length > 0 ? [status, ...next] : [];
}

/**
 * Should the row show a static badge instead of a working dropdown?
 *
 * This lives here, next to the option list, because the component got it
 * wrong on its own. It used to read `const options = OPTIONS[status]` and
 * guard on `!options` — correct while a terminal status yielded `undefined`.
 * The refactor that moved the table into this file (77aefda) swapped that for
 * `statusDropdownOptions`, which returns `[]`. An empty array is truthy, so
 * the guard stopped firing and completed/cancelled bookings rendered an empty
 * dropdown: a control with nothing in it, where a badge belongs.
 *
 * The pure option list was tested and correct throughout — the defect was
 * entirely in how its result was interpreted. So the interpretation is a
 * function now, and it has tests.
 */
export function rendersAsStaticBadge(
  status: string,
  canEdit: boolean,
  scheduledAtIso?: string | null,
): boolean {
  return !canEdit || statusDropdownOptions(status, scheduledAtIso).length === 0;
}

/**
 * Does this edit call for the draft invoice? Two moments do: the job
 * becoming completed (every status writer already asks), and a job that
 * was completed with no price getting one. The second was missing: the
 * draft is only attempted the moment a job completes, and a job with no
 * price is skipped then (nothing to bill, and auto-send would mail a $0
 * invoice). The manager answers "needs a price", sets it, and until now
 * nothing happened — the invoice had to be made by hand.
 *
 * Marking it free is not a price: the "needs a price" flag clears, and no
 * invoice is drafted, for the same $0 reason.
 */
export function invoiceDraftDueOnEdit(
  before: { status: string | null | undefined; total_cents: number | null | undefined },
  after: { status: string; total_cents: number | null | undefined },
): boolean {
  if (after.status !== "completed") return false;
  if (before.status !== "completed") return true;
  return (before.total_cents ?? 0) <= 0 && (after.total_cents ?? 0) > 0;
}

/** The hours and price facts an edit can change, as stored on the row. */
export type BookingTerms = {
  duration_minutes: number | null | undefined;
  total_cents: number | null | undefined;
  is_free: boolean | null | undefined;
};

/**
 * What an edit changed about a job's hours or price, as before/after pairs
 * holding only the fields that moved — or null when none did.
 *
 * Only status changes reached the job's history. Oliver Little, 2026-10-28:
 * the job was 12 hours when three cleaners were alerted at 2:30 PM for
 * running past their 4-hour shares, and 18 when it was priced at 5:27 —
 * and nothing anywhere said who changed it or when, so the alert looked
 * wrong after the fact. The hours are what every share, "past her hours"
 * alert and attendance mark is measured against; a change to them is
 * part of the job's story.
 */
export function bookingTermsChange(
  before: BookingTerms,
  after: BookingTerms,
): { before: Partial<BookingTerms>; after: Partial<BookingTerms> } | null {
  const b: Partial<BookingTerms> = {};
  const a: Partial<BookingTerms> = {};
  const norm = (k: keyof BookingTerms, v: BookingTerms[keyof BookingTerms]) =>
    k === "is_free" ? v === true : (v ?? null);
  for (const k of ["duration_minutes", "total_cents", "is_free"] as const) {
    const was = norm(k, before[k]);
    const now = norm(k, after[k]);
    if (was === now) continue;
    (b as Record<string, unknown>)[k] = was;
    (a as Record<string, unknown>)[k] = now;
  }
  return Object.keys(a).length === 0 ? null : { before: b, after: a };
}

/**
 * The timeline line for a terms change, e.g. "Hours 12h → 18h, price
 * $1,015.00 by Svitlana". Formatting comes from the caller so this stays
 * free of locale and currency choices.
 */
export function describeTermsChange(
  before: Partial<BookingTerms>,
  after: Partial<BookingTerms>,
  fmt: { hours: (minutes: number) => string; money: (cents: number) => string },
): string {
  const parts: string[] = [];
  if ("duration_minutes" in after) {
    const was = before.duration_minutes;
    const now = after.duration_minutes;
    parts.push(
      `hours ${was == null ? "none" : fmt.hours(was)} → ${now == null ? "none" : fmt.hours(now)}`,
    );
  }
  if ("is_free" in after && after.is_free === true) {
    parts.push("marked free");
  } else if ("total_cents" in after) {
    const was = before.total_cents ?? 0;
    const now = after.total_cents ?? 0;
    parts.push(
      was > 0 ? `price ${fmt.money(was)} → ${fmt.money(now)}` : `priced at ${fmt.money(now)}`,
    );
  } else if ("is_free" in after) {
    parts.push("no longer free");
  }
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

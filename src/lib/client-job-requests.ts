/**
 * What a portal client is allowed to ask about a booking, and what happens
 * when they do.
 *
 * Pure and dependency-free so the portal (deciding what buttons to show), the
 * server action (deciding whether to honour the request), and any test can all
 * read the same rules. A button the UI offers and the server then refuses is
 * the worst of both — it looks like the app is broken rather than that the
 * answer is no.
 */

/**
 * How far ahead a skip stops being self-service.
 *
 * Beyond this the visit is cancelled outright and the office is simply told.
 * Inside it the crew is already committed, the slot is hard to refill, and
 * someone may already be driving — so it becomes a request a human answers.
 *
 * Deliberately the same shape of rule as EARLY_START_GRACE_MINUTES in
 * booking-status.ts: a window, not a hard "future or not", because the honest
 * question is never "is this in the future" but "is there still time to react".
 */
export const SKIP_AUTO_APPLY_HOURS = 48;

/** Statuses where a client can still say something useful about the visit. */
const ACTIONABLE = new Set(["pending", "confirmed"]);

export type ClientBookingActionState = {
  /** Leave a note for this visit. */
  canNote: boolean;
  /** Ask to skip. */
  canSkip: boolean;
  /** True when a skip would take effect immediately rather than queue. */
  skipAutoApplies: boolean;
  /** Why not, when something is unavailable — shown to the client verbatim. */
  reason: string | null;
};

/**
 * What this client can do to this booking, right now.
 *
 * A job that has started, finished, or been cancelled is not something to
 * negotiate through a portal — by then the honest answer is a phone call, and
 * pretending otherwise sends a request nobody will action in time.
 */
export function clientBookingActions(
  booking: {
    scheduled_at: string;
    status: string;
    archived_at?: string | null;
  },
  now: number = Date.now(),
): ClientBookingActionState {
  const none = { canNote: false, canSkip: false, skipAutoApplies: false };

  if (booking.archived_at) {
    return { ...none, reason: "This visit is no longer active." };
  }
  if (booking.status === "cancelled") {
    return { ...none, reason: "This visit was cancelled." };
  }
  if (booking.status === "completed") {
    return { ...none, reason: "This visit is finished." };
  }
  if (booking.status === "in_progress") {
    return {
      ...none,
      reason:
        "Your cleaner has already started. Call the office if you need to change something now.",
    };
  }
  if (!ACTIONABLE.has(booking.status)) {
    return { ...none, reason: "This visit can't be changed here." };
  }

  const start = new Date(booking.scheduled_at).getTime();
  if (!Number.isFinite(start)) {
    return { ...none, reason: "This visit can't be changed here." };
  }
  if (start <= now) {
    return { ...none, reason: "This visit has already passed." };
  }

  const hoursAway = (start - now) / 3_600_000;
  return {
    canNote: true,
    canSkip: true,
    skipAutoApplies: hoursAway >= SKIP_AUTO_APPLY_HOURS,
    reason: null,
  };
}

/**
 * The org-local calendar date of a visit, as YYYY-MM-DD.
 *
 * This is the key `booking_series.skip_dates` uses and the one
 * `recurrence.isSkipped` compares against. Slicing the UTC ISO string instead
 * is a bug that has already been fixed once here: for an evening booking in a
 * negative-offset timezone it yields the NEXT day, never matches, and the
 * nightly cron keeps regenerating the visit the client asked to skip.
 */
export function occurrenceDate(scheduledAtIso: string, tz: string): string {
  return new Date(scheduledAtIso).toLocaleDateString("en-CA", { timeZone: tz });
}

/** Copy for the confirm step, so the client knows which of the two they get. */
export function skipConfirmCopy(autoApplies: boolean): {
  title: string;
  body: string;
  cta: string;
} {
  return autoApplies
    ? {
        title: "Skip this cleaning?",
        body: "We'll cancel this visit and let the office know. Your regular schedule carries on as normal afterwards.",
        cta: "Skip this visit",
      }
    : {
        title: "Ask to skip this cleaning?",
        body: "This one is close enough that someone needs to confirm it — your cleaner may already be scheduled. We'll pass it on straight away and the office will come back to you.",
        cta: "Send the request",
      };
}

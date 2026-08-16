/**
 * Watching a job for the thing nobody was watching: silence.
 *
 * Sollos already notices a job nobody was ASSIGNED to (unstaffed_past_booking)
 * and a shift somebody never clocked OUT of (shift_clock_out_reminder). The
 * hole between them is the job that was assigned, came and went, and produced
 * no evidence at all that anyone did it — no clock-in, no status change, no
 * human touch. That job auto-completes on schedule and drafts an invoice, and
 * the first person to learn nothing happened is the client reading a bill.
 *
 * Two moments are worth a word, and they are different words:
 *
 *   LATE START — the job's start time has passed, the cleaner hasn't clocked
 *   in, and the window is still open. This is recoverable: nudge the person
 *   who is supposed to be there, while being there is still possible.
 *
 *   NO CLOCK-IN — the whole window has passed with no clock-in. Nothing can
 *   be recovered; the office needs to decide whether it happened before the
 *   money moves. This is a question for a human, not a status flip.
 *
 * A job somebody MARKED complete is deliberately never flagged: a human
 * asserting the work happened is exactly the evidence this module looks for.
 * Nor is an unstaffed job — that is the other watcher's job, and two alerts
 * for one problem trains people to ignore both.
 */

/** How late a start has to be before nudging the cleaner. */
export const LATE_START_NUDGE_MINUTES = 15;

/** Grace after the job's expected end before the office is asked about it. */
export const NO_CLOCK_IN_GRACE_MINUTES = 30;

/** Statuses where a human has already spoken; silence is not suspicious. */
const TERMINAL = new Set(["completed", "cancelled"]);

export type JobWatchInput = {
  scheduledAtMs: number;
  durationMinutes: number | null;
  status: string;
  /** Assigned member, crew, or a claimed offer — the shared coverage rule. */
  staffed: boolean;
  /** Any time entry against this booking, open or closed. */
  hasClockIn: boolean;
  nowMs: number;
  /** Dedup stamps; a non-null value means that word was already said. */
  nudgedAtMs: number | null;
  flaggedAtMs: number | null;
};

export type JobWatchVerdict =
  | { kind: "none" }
  | { kind: "late_start"; minutesLate: number }
  | { kind: "no_clock_in"; minutesPastEnd: number };

/**
 * What (if anything) to say about one job right now.
 *
 * Order matters: the terminal/staffing/clock-in exits come first because each
 * is a reason this module has nothing to add, and checking them up front is
 * what keeps this from becoming the third alert about the same booking.
 */
export function classifyJob(input: JobWatchInput): JobWatchVerdict {
  const {
    scheduledAtMs,
    durationMinutes,
    status,
    staffed,
    hasClockIn,
    nowMs,
    nudgedAtMs,
    flaggedAtMs,
  } = input;

  // Someone said what happened. Believe them.
  if (TERMINAL.has(status)) return { kind: "none" };
  // Pending is the office's own loose end, and unstaffed has its own watcher.
  if (status === "pending") return { kind: "none" };
  if (!staffed) return { kind: "none" };
  // A clock-in is the evidence this module exists to look for. Once it's
  // there, the clock-OUT guardrail owns the rest of the shift.
  if (hasClockIn) return { kind: "none" };

  const endMs = scheduledAtMs + (durationMinutes ?? 0) * 60_000;
  const pastEndMs = nowMs - endMs;

  // Window fully gone: a question for the office, asked once.
  if (pastEndMs >= NO_CLOCK_IN_GRACE_MINUTES * 60_000) {
    if (flaggedAtMs != null) return { kind: "none" };
    return {
      kind: "no_clock_in",
      minutesPastEnd: Math.floor(pastEndMs / 60_000),
    };
  }

  // Still inside the window: nudge the person who can still fix it, once.
  const lateMs = nowMs - scheduledAtMs;
  if (lateMs >= LATE_START_NUDGE_MINUTES * 60_000) {
    if (nudgedAtMs != null) return { kind: "none" };
    return { kind: "late_start", minutesLate: Math.floor(lateMs / 60_000) };
  }

  return { kind: "none" };
}

/**
 * Does this org actually use clock-in?
 *
 * An org that runs on paper would get one of these alerts for every job it
 * ever books, and "a badge that is always on is invisible" (booking-warnings
 * says it best). Recent clock-in activity is the honest test of whether the
 * absence of a clock-in means anything here.
 */
export function orgUsesClockIn(recentEntryCount: number): boolean {
  return recentEntryCount > 0;
}

/**
 * One person's work on one job on one day, however many times they clocked
 * in and out of it.
 *
 * Clocking in and out of a job as often as the day needs is allowed (break,
 * a run to the car, a mistaken tap). Every punch is still its own
 * time_entries row — that is what pay is built from and it stays exact — but
 * READING them one row per punch told a false story. Brian clocked in and out
 * of one 15-minute job four times on 2026-11-14 and the timesheet showed four
 * shifts, three of them "late" (each resume was measured against the job's
 * start), each "10m faster" than a 15-minute job, and the person's header
 * read "4 shifts · 3 late". The truth was one job, 15 minutes worked, on time,
 * with 9 minutes of breaks.
 *
 * So a visit judges the WHOLE of the work:
 *   - arrival is the first clock-in, nothing else,
 *   - speed is the summed minutes against the allotment,
 *   - break time is the gaps between one clock-out and the next clock-in,
 *   - over-allotted counts every punch's minutes against ONE allotment —
 *     per punch, each resume got the whole allotment again, so four 1-hour
 *     punches on a 2-hour job never flagged.
 *
 * Pure and dependency-free so it can be tested without a database.
 */

export type Punctuality = "early" | "on_time" | "late";
export type Completion = "under" | "on_target" | "over";

/** Within this many minutes of the target counts as on time / on target. */
export const JUDGEMENT_SLACK_MINUTES = 5;

/** Speed against the allotment — the one rule the page and visits share. */
export function judgeCompletion(
  actualMinutes: number,
  estimatedMinutes: number | null,
): { completion: Completion | null; diffMinutes: number } {
  if (!estimatedMinutes || actualMinutes <= 0) {
    return { completion: null, diffMinutes: 0 };
  }
  const diff = actualMinutes - estimatedMinutes;
  if (diff < -JUDGEMENT_SLACK_MINUTES) {
    return { completion: "under", diffMinutes: Math.abs(diff) };
  }
  if (diff > JUDGEMENT_SLACK_MINUTES) {
    return { completion: "over", diffMinutes: diff };
  }
  return { completion: "on_target", diffMinutes: 0 };
}

/** The fields of a timesheet punch a visit needs. */
export type VisitEntry = {
  id: string;
  employee_id: string;
  booking_id: string | null;
  clock_in_at: string;
  clock_out_at: string | null;
  actual_minutes: number;
  is_open: boolean;
  earned_cents: number;
  estimated_minutes: number | null;
  punctuality: Punctuality | null;
  punctuality_minutes: number;
  needs_review: boolean;
  /** This punch's own over-allotted minutes, already 0 when confirmed. */
  over_allotted_minutes: number;
  /** An owner confirmed this punch's hours ("Looks good"). */
  over_confirmed: boolean;
  /** When this person's window on the job opened: the booking's start,
   *  moved by their split-shift offset. Null for off-job time. */
  shift_start_at: string | null;
};

export type JobVisit<E extends VisitEntry> = {
  key: string;
  /** Oldest first — the order the day happened in. */
  entries: E[];
  employee_id: string;
  booking_id: string | null;
  /** First clock-in. */
  clock_in_at: string;
  /** Last clock-out; null while any punch is still open. */
  clock_out_at: string | null;
  is_open: boolean;
  punch_count: number;
  /** Minutes actually on the clock, summed across punches. */
  worked_minutes: number;
  /** Minutes between a clock-out and the next clock-in. */
  break_minutes: number;
  estimated_minutes: number | null;
  punctuality: Punctuality | null;
  punctuality_minutes: number;
  completion: Completion | null;
  completion_diff_minutes: number;
  earned_cents: number;
  needs_review: boolean;
  over_allotted_minutes: number;
};

const ms = (iso: string) => new Date(iso).getTime();

/**
 * Whole minutes the visit ran past this person's allotment, counting every
 * closed punch's time from the moment their window opened. For a single
 * punch this is exactly closedEntryOverrunMinutes — max(start, clock-in) +
 * allotment against the clock-out — so nothing changes for the normal case.
 */
function visitOverrunMinutes<E extends VisitEntry>(entries: E[]): number {
  if (entries.length === 1) return entries[0].over_allotted_minutes;
  const closed = entries.filter((e) => e.clock_out_at);
  if (closed.length === 0) return 0;
  // Confirmed means confirmed: once every punch has been looked at, the
  // alarm is acknowledged. A punch added afterwards raises it again.
  if (closed.every((e) => e.over_confirmed)) return 0;
  const allotted = entries[0].estimated_minutes;
  const start = entries[0].shift_start_at;
  if (!allotted || allotted <= 0 || !start) return 0;
  const startMs = ms(start);
  let countedMs = 0;
  for (const e of closed) {
    const from = Math.max(ms(e.clock_in_at), startMs);
    countedMs += Math.max(0, ms(e.clock_out_at!) - from);
  }
  return Math.max(0, Math.floor(countedMs / 60_000 - allotted));
}

/**
 * Group punches into visits: same person, same job, same calendar day
 * (`dayOf` decides the day — pass the org's wall clock). Off-job punches
 * have no job to belong to and stay one visit each.
 *
 * Visits come back newest first, matching the timesheet's order.
 */
export function groupIntoVisits<E extends VisitEntry>(
  entries: E[],
  dayOf: (iso: string) => string,
): JobVisit<E>[] {
  const groups = new Map<string, E[]>();
  for (const e of entries) {
    const key = e.booking_id
      ? `${e.employee_id}:${e.booking_id}:${dayOf(e.clock_in_at)}`
      : `entry:${e.id}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }

  const visits: JobVisit<E>[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => ms(a.clock_in_at) - ms(b.clock_in_at));
    const first = sorted[0];
    const isOpen = sorted.some((e) => e.is_open);

    let worked = 0;
    let earned = 0;
    for (const e of sorted) {
      worked += e.is_open ? 0 : e.actual_minutes;
      earned += e.earned_cents;
    }

    // Gaps between consecutive punches. Overlapping punches (a double tap,
    // a hand-entered duplicate) give a negative gap, which is not a break.
    let breakMs = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prevOut = sorted[i - 1].clock_out_at;
      if (!prevOut) continue;
      breakMs += Math.max(0, ms(sorted[i].clock_in_at) - ms(prevOut));
    }

    let lastOut: string | null = null;
    if (!isOpen) {
      for (const e of sorted) {
        if (e.clock_out_at && (!lastOut || ms(e.clock_out_at) > ms(lastOut))) {
          lastOut = e.clock_out_at;
        }
      }
    }

    // Still on the clock: the total is still moving, so don't judge speed.
    const judged = isOpen
      ? { completion: null, diffMinutes: 0 }
      : judgeCompletion(worked, first.estimated_minutes);

    visits.push({
      key,
      entries: sorted,
      employee_id: first.employee_id,
      booking_id: first.booking_id,
      clock_in_at: first.clock_in_at,
      clock_out_at: lastOut,
      is_open: isOpen,
      punch_count: sorted.length,
      worked_minutes: worked,
      break_minutes: Math.round(breakMs / 60_000),
      estimated_minutes: first.estimated_minutes,
      punctuality: first.punctuality,
      punctuality_minutes: first.punctuality_minutes,
      completion: judged.completion,
      completion_diff_minutes: judged.diffMinutes,
      earned_cents: earned,
      needs_review: sorted.some((e) => e.needs_review),
      over_allotted_minutes: visitOverrunMinutes(sorted),
    });
  }

  return visits.sort((a, b) => ms(b.clock_in_at) - ms(a.clock_in_at));
}

/**
 * Does this booking have to stay open after one cleaner taps Complete?
 *
 * Pulled out of the completeJob action so the rule can be tested without a
 * database. The action supplies the rows; this decides.
 *
 * History worth keeping: the guard used to engage only when 2+ assignees had
 * `split_duration_minutes` set, i.e. only on a Split-shift hand-off. That
 * missed the ordinary case of a crew arriving and leaving at different times,
 * which the owner currently cannot record at all (Split shift forces strictly
 * back-to-back segments). On 2026-10-02 a 16-hour three-person job carried no
 * split data, so the guard was off: the first Complete would have ended the
 * job for all three and shown the other two "Job complete. Nice work." with no
 * Start button.
 *
 * Crew size is the right test. A job with more than one person on it is not
 * over because one of them is done.
 */
export type CrewCompletionRow = {
  membership_id: string;
  /** Set when that cleaner has tapped Complete for their own part. */
  completed_at: string | null;
};

export function crewStillWorking({
  assignees,
  workedIds,
  onClockIds,
  callerId,
  jobWindowOver = true,
}: {
  assignees: CrewCompletionRow[];
  /** Memberships with any time entry on this booking — i.e. who showed up. */
  workedIds: Iterable<string>;
  /**
   * Memberships with an OPEN time entry on this booking — who is on the
   * clock right now. When given, this decides who is still working, not
   * `completed_at`: a cleaner's clock is the one thing she says about her
   * own shift, and "I'm done" and "stop my clock" both stop it. Someone who
   * stopped her clock from the Clock page never got a completed_at, and
   * until 2026-10-28 that alone held the job open for the last finisher.
   * Omitted (older callers), the completed_at mark decides as before.
   */
  onClockIds?: Iterable<string>;
  /** The cleaner tapping Complete right now. */
  callerId: string;
  /**
   * Has the job's window passed? Until it has, someone who hasn't clocked
   * in yet is still coming, not a no-show. (The caller measures the window
   * the way src/lib/job-state.ts does: the crew's shared hours.)
   */
  jobWindowOver?: boolean;
}): boolean {
  // Solo job (or an empty crew list): finishing it finishes it.
  if (assignees.length < 2) return false;

  const worked = workedIds instanceof Set ? workedIds : new Set(workedIds);
  const onClock =
    onClockIds == null
      ? null
      : onClockIds instanceof Set
        ? onClockIds
        : new Set(onClockIds);

  return assignees.some((r) => {
    // The caller just finished — their row may not reflect the write yet, so
    // trust the call over the row.
    if (r.membership_id === callerId) return false;
    // Rostered but not clocked in. Once the job's window is over they're a
    // no-show and must not strand the booking in `in_progress` forever (that
    // also withholds the draft invoice, so the org goes silently unpaid for
    // work that did happen). But BEFORE then they simply haven't started:
    // on 2026-10-26 Olha clocked in first on a four-person job and tapped
    // Finish six minutes later; the other three hadn't clocked in yet, so all
    // three counted as no-shows, the job closed, and none of them could
    // clock in.
    if (!worked.has(r.membership_id)) return !jobWindowOver;
    if (onClock) return onClock.has(r.membership_id);
    return r.completed_at == null;
  });
}

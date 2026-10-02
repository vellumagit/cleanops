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
  callerId,
}: {
  assignees: CrewCompletionRow[];
  /** Memberships with any time entry on this booking — i.e. who showed up. */
  workedIds: Iterable<string>;
  /** The cleaner tapping Complete right now. */
  callerId: string;
}): boolean {
  // Solo job (or an empty crew list): finishing it finishes it.
  if (assignees.length < 2) return false;

  const worked = workedIds instanceof Set ? workedIds : new Set(workedIds);

  return assignees.some((r) => {
    // The caller just finished — their row may not reflect the write yet, so
    // trust the call over the row.
    if (r.membership_id === callerId) return false;
    // Rostered but never clocked in. They must not strand the booking in
    // `in_progress` forever: that also withholds the draft invoice, so the org
    // goes silently unpaid for work that did happen.
    if (!worked.has(r.membership_id)) return false;
    return r.completed_at == null;
  });
}

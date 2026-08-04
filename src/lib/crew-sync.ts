/**
 * Carrying a crew member's lifecycle across a booking save.
 *
 * booking_assignees rows are rebuilt from the form on every edit — deleted
 * and re-inserted — because the form is the source of truth for WHO is on a
 * job. But three columns on those rows are not the form's to own:
 *
 *   acceptance_status  the cleaner said yes
 *   responded_at       when they said it
 *   completed_at       they finished their segment
 *
 * Those belong to the person-on-the-job, and a rebuild used to reset them.
 * Changing a booking's price re-asked eleven Svit cleaners to confirm shifts
 * they had already accepted, and erased the record that someone had finished.
 *
 * Keyed by booking AND membership so the same helper serves the single-booking
 * save and the "this and future" series save, which rewrites many bookings at
 * once.
 */

export type AssigneeLifecycle = {
  acceptance_status: unknown;
  responded_at: unknown;
  completed_at: unknown;
};

export type AssigneeKeyed = {
  booking_id?: unknown;
  membership_id?: unknown;
};

/** `${booking_id}:${membership_id}` — stable across the delete/insert. */
export function assigneeKey(row: AssigneeKeyed): string {
  return `${String(row.booking_id ?? "")}:${String(row.membership_id ?? "")}`;
}

/** Index the rows that existed before the rebuild. */
export function lifecycleByAssignee(
  priorRows: Array<Record<string, unknown>> | null | undefined,
): Map<string, AssigneeLifecycle> {
  const out = new Map<string, AssigneeLifecycle>();
  for (const r of priorRows ?? []) {
    if (!r || !r.membership_id) continue;
    out.set(assigneeKey(r), {
      acceptance_status: r.acceptance_status,
      responded_at: r.responded_at,
      completed_at: r.completed_at,
    });
  }
  return out;
}

/**
 * Merge prior lifecycle onto a freshly-built row.
 *
 * Someone already on the job keeps their state; someone genuinely new starts
 * clean (the column defaults apply); someone removed simply has no row. The
 * structural fields — is_primary, split offsets — always come from the new
 * row, because those ARE the form's to decide.
 */
export function withPriorLifecycle<T extends AssigneeKeyed>(
  row: T,
  prior: Map<string, AssigneeLifecycle>,
): T & Partial<AssigneeLifecycle> {
  const found = prior.get(assigneeKey(row));
  return found ? { ...row, ...found } : row;
}

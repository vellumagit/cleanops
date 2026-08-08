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

/** What a person who has never been asked about this job looks like. */
const FRESH: AssigneeLifecycle = {
  acceptance_status: "pending",
  responded_at: null,
  completed_at: null,
};

/**
 * Merge prior lifecycle onto a freshly-built row.
 *
 * Someone already on the job keeps their state; someone genuinely new starts
 * pending. The structural fields — is_primary, split offsets — always come
 * from the new row, because those ARE the form's to decide.
 *
 * EVERY row carries all three keys, always. That is not tidiness, it is the
 * whole point.
 *
 * This used to spread the prior lifecycle when there was one and return the
 * row untouched when there wasn't, on the reasoning that a new person should
 * "let the column defaults apply". A column default only applies when the
 * column is absent from the entire INSERT — and these rows go in as one array.
 * PostgREST unifies the column list across every row in that array, so the
 * moment ONE row supplied acceptance_status, every row that didn't got an
 * explicit NULL instead of the default, and the insert died on the NOT NULL
 * constraint:
 *
 *   null value in column "acceptance_status" of relation "booking_assignees"
 *   violates not-null constraint
 *
 * Which meant adding a crew member to a job that already had one — the most
 * ordinary edit there is — failed every time, while adding one to an empty
 * job worked fine. Uniform keys make the array homogeneous and the defaults
 * irrelevant.
 */
export function withPriorLifecycle<T extends AssigneeKeyed>(
  row: T,
  prior: Map<string, AssigneeLifecycle>,
): T & AssigneeLifecycle {
  const found = prior.get(assigneeKey(row));
  return {
    ...row,
    acceptance_status: found?.acceptance_status ?? FRESH.acceptance_status,
    responded_at: found?.responded_at ?? FRESH.responded_at,
    completed_at: found?.completed_at ?? FRESH.completed_at,
  };
}

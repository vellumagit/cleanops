/**
 * "Diana is covering for Olha" — what a claimed offer does to the crew when
 * the offer was posted to REPLACE someone.
 *
 * Without this, claiming only ever ADDED the claimer. The person who was out
 * stayed on the job until someone remembered to take them off by hand: still
 * on the board, still on their calendar, still expected. Svit hit it on
 * 2026-10-15 (Olha's child was sick; Diana claimed at 7:36) and Svitlana
 * asked how to make the swap happen.
 *
 * Rules:
 *   - Only the FIRST claim on an offer swaps. One claim covers one person;
 *     a two-spot offer replacing Olha shouldn't remove her twice.
 *   - The claimer takes the replaced person's crew row when they can — same
 *     lead flag, same split-shift times — so the job looks exactly as it did
 *     with a different name on it.
 *   - Never once the job is under way or the replaced person has clocked in
 *     on it: then they evidently came, and removing them would wipe a real
 *     shift. Managers are told instead.
 */

export type CrewRow = { membership_id: string; is_primary: boolean };

export type SwapPlan =
  | { kind: "none" }
  | { kind: "blocked"; reason: "started" | "clocked_in" }
  | {
      kind: "swap";
      /** Move the replaced person's crew row to the claimer (keeps lead flag
       *  and split times). */
      reassignRow: boolean;
      /** Delete the replaced person's crew row outright. */
      deleteRow: boolean;
      /** The claimer still needs a crew row of their own (insert as usual). */
      insertClaimer: boolean;
      /** New bookings.assigned_to, or undefined to leave it alone. */
      assignedTo: string | null | undefined;
      /** Whose row becomes is_primary, when the lead changed and the row
       *  wasn't simply reassigned. */
      newPrimary: string | null;
      /** Everyone on the job afterwards — for calendars. */
      crewAfter: string[];
    };

export function planOfferSwap({
  replacedId,
  claimerMembershipId,
  isFirstClaim,
  crew,
  assignedTo,
  bookingStatus,
  replacedClockedIn,
}: {
  replacedId: string | null;
  /** null when an on-call freelancer (not a member) claimed. */
  claimerMembershipId: string | null;
  isFirstClaim: boolean;
  crew: CrewRow[];
  assignedTo: string | null;
  bookingStatus: string;
  replacedClockedIn: boolean;
}): SwapPlan {
  if (!replacedId || !isFirstClaim) return { kind: "none" };
  if (replacedId === claimerMembershipId) return { kind: "none" };

  const replacedHasRow = crew.some((r) => r.membership_id === replacedId);
  const replacedOnJob = replacedHasRow || assignedTo === replacedId;
  // Already off the job (taken off by hand before anyone claimed): nothing
  // to swap; the claim adds the claimer as it always has.
  if (!replacedOnJob) return { kind: "none" };

  if (!["pending", "confirmed"].includes(bookingStatus)) {
    return { kind: "blocked", reason: "started" };
  }
  if (replacedClockedIn) return { kind: "blocked", reason: "clocked_in" };

  const claimerOn =
    claimerMembershipId != null &&
    (assignedTo === claimerMembershipId ||
      crew.some((r) => r.membership_id === claimerMembershipId));

  const reassignRow = claimerMembershipId != null && !claimerOn && replacedHasRow;
  const insertClaimer =
    claimerMembershipId != null && !claimerOn && !replacedHasRow;
  const deleteRow = replacedHasRow && !reassignRow;

  const crewAfter = [
    ...new Set(
      [
        ...crew.map((r) => r.membership_id),
        ...(assignedTo ? [assignedTo] : []),
        ...(claimerMembershipId ? [claimerMembershipId] : []),
      ].filter((id) => id !== replacedId),
    ),
  ];

  let assignedToNext: string | null | undefined = undefined;
  let newPrimary: string | null = null;
  if (assignedTo === replacedId) {
    // The lead was the person who's out. A member who claimed takes over;
    // otherwise whoever else is on the job, preferring the current primary.
    const others = crew.filter((r) => r.membership_id !== replacedId);
    assignedToNext =
      claimerMembershipId ??
      others.find((r) => r.is_primary)?.membership_id ??
      others[0]?.membership_id ??
      null;
    // A reassigned row carries is_primary across by itself.
    newPrimary = reassignRow ? null : assignedToNext;
  }

  return {
    kind: "swap",
    reassignRow,
    deleteRow,
    insertClaimer,
    assignedTo: assignedToNext,
    newPrimary,
    crewAfter,
  };
}

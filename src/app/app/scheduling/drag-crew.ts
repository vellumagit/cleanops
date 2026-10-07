/**
 * What a drag on the scheduler does to a job's crew.
 *
 * A team job's card appears in EVERY crew member's lane, but the reschedule
 * action used to compare the drop lane against bookings.assigned_to — the
 * first person only. So grabbing Amanda DeGroot's card from Uliana's lane and
 * moving it to Thursday, still in Uliana's lane, looked like "the primary
 * changed from Anna to Uliana": the action deleted the whole crew and put
 * back only Uliana. Anna was silently taken off the job. Same-lane TIME drags
 * had been patched for this once already; any drag from a non-lead's lane
 * still wiped the crew. Svit drags roughly 243 bookings a week.
 *
 * The fix is to know whose card moved. Then:
 *   - same person, new day/time  → reschedule only, crew untouched
 *   - into another person's lane → swap that one person, keep everyone else
 *   - onto the unassigned tray   → take that one person off; the job is only
 *                                   unassigned if nobody is left
 *   - into the lane of someone ALREADY on the job → refuse. It reads as either
 *     "remove this person" or a mis-drop, and silently removing someone is the
 *     exact failure this replaces.
 */

/**
 * Identity of one dragged card. The same booking renders once per crew
 * member, so the booking id alone is not unique — every copy used to share
 * it, which the drag library doesn't support and which left "whose card
 * moved" unknowable. Each copy now carries its own id and its lane.
 */
export type DragInfo = { bookingId: string; fromMember: string | null };

export function dragIdFor(bookingId: string, fromMember: string | null): string {
  return `${bookingId}@${fromMember ?? "tray"}`;
}

/** Read a card's identity back from the drag library's `active`. */
export function readDragInfo(active: {
  id: string | number;
  data: { current?: unknown };
}): DragInfo {
  const d = active.data.current as Partial<DragInfo> | undefined;
  if (d && typeof d.bookingId === "string") {
    return { bookingId: d.bookingId, fromMember: d.fromMember ?? null };
  }
  // Defensive fallback: an id without data. Treat as the old shape.
  const [bookingId] = String(active.id).split("@");
  return { bookingId, fromMember: null };
}

export type CrewMovePlan =
  | { kind: "unchanged" }
  | { kind: "already_on"; target: string }
  | {
      kind: "changed";
      crew: string[];
      /** New value for bookings.assigned_to while that column is phased out. */
      lead: string | null;
      removed: string | null;
      added: string | null;
    };

export function planCrewMove({
  crew,
  lead,
  mover,
  target,
}: {
  /** Everyone currently on the job. */
  crew: string[];
  /** Current bookings.assigned_to. */
  lead: string | null;
  /**
   * Whose card was dragged. null = from the unassigned tray (no person).
   * Callers that can't say (an older open tab) pass the lead, which turns the
   * old wipe-and-replace into a one-person swap — strictly safer.
   */
  mover: string | null;
  /** Lane it was dropped in. null = the unassigned tray. */
  target: string | null;
}): CrewMovePlan {
  if (mover === target) return { kind: "unchanged" };
  if (target && crew.includes(target)) return { kind: "already_on", target };

  const removed = mover && crew.includes(mover) ? mover : null;
  const next = crew.filter((id) => id !== removed);
  const added = target ?? null;
  if (added) next.push(added);

  if (!removed && !added) return { kind: "unchanged" };

  // Keep the current first person if they're still on the job; otherwise the
  // person just dropped in, otherwise whoever is left.
  const nextLead =
    lead && next.includes(lead) ? lead : (added ?? next[0] ?? null);

  return { kind: "changed", crew: next, lead: nextLead, removed, added };
}

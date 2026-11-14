/**
 * Who may be on a job's crew when it is saved.
 *
 *  - Everyone has to belong to this company. (The original reason for the
 *    check: an owner with memberships in two companies must not be able to
 *    plant one company's cleaner on another's job by editing the form.)
 *  - Everyone has to be active. The database's own save function
 *    (update_booking_assignments_v2) refuses an inactive person too, so
 *    this is the same rule said earlier and in words.
 *
 * What changed on 2026-11-14 is what the refusal says and what the form
 * shows. It used to read "One or more selected cleaners are no longer
 * active in this workspace. Refresh and try again." The edit form only
 * drew active people, so a job that still carried a cleaner who had left
 * could not be saved at all: she was invisible, could not be taken off,
 * and refreshing changed nothing. Svit hit it on a recurring series whose
 * 52 upcoming visits named a placeholder deactivated in May. The refusal
 * now names the person and says what to do, and the form shows her (see
 * crew-picker.tsx and the edit page).
 *
 * Still true, and a decision rather than a bug: a job that has already
 * happened can't be saved while it names someone who has left, so editing
 * it means taking her off its crew (her logged hours stay). Letting her
 * stay needs the database function changed.
 */

export type CrewCandidate = {
  id: string;
  /** memberships.status */
  status: string;
  name: string;
};

export type CrewEligibility = { ok: true } | { ok: false; error: string };

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function crewEligibility({
  submitted,
  members,
}: {
  /** Every membership id the save names. */
  submitted: Iterable<string>;
  /** The ones found in THIS company, whatever their status. */
  members: CrewCandidate[];
}): CrewEligibility {
  const byId = new Map(members.map((m) => [m.id, m]));

  for (const id of submitted) {
    if (!byId.has(id)) {
      return {
        ok: false,
        error:
          "Someone picked for this job isn't part of this company. Reload the page and pick the crew again.",
      };
    }
  }

  const blocked: string[] = [];
  for (const id of new Set(submitted)) {
    const m = byId.get(id)!;
    if (m.status !== "active") blocked.push(m.name);
  }
  if (blocked.length > 0) {
    const who = listNames(blocked);
    return {
      ok: false,
      error: `${who} ${blocked.length === 1 ? "is" : "are"} no longer active here, so can't be on a job's crew. Take ${blocked.length === 1 ? "that name" : "those names"} off the crew, then save.`,
    };
  }
  return { ok: true };
}

/**
 * The people a series may put on a NEW visit: its crew minus anyone who is
 * no longer active. A template keeps the name of whoever was on it the day
 * it was saved; without this, every batch of new visits brought a departed
 * cleaner back onto the schedule.
 */
export function activeCrewOnly<T extends { membership_id: string }>(
  crew: T[],
  activeIds: ReadonlySet<string>,
): T[] {
  return crew.filter((m) => activeIds.has(m.membership_id));
}

/**
 * A series template with one person taken off it, or null when she was not
 * on it. Deactivating someone removed her from her upcoming visits and left
 * every template that named her untouched, so the next batch of visits
 * came out with her on them again.
 *
 * `crew` is the template's jsonb as stored (entries carry `membership_id`
 * and optional times); entries are kept as they are, only hers go. The
 * single-cleaner column moves to whoever is left first, or to nobody.
 */
export function seriesWithoutMember(
  series: { assigned_to: string | null; crew?: unknown },
  membershipId: string,
): { assigned_to: string | null; crew: unknown[] | null } | null {
  const stored = Array.isArray(series.crew) ? (series.crew as unknown[]) : null;
  const idOf = (entry: unknown): string | null =>
    entry && typeof entry === "object" && typeof (entry as { membership_id?: unknown }).membership_id === "string"
      ? ((entry as { membership_id: string }).membership_id)
      : null;
  const inCrew = (stored ?? []).some((e) => idOf(e) === membershipId);
  if (series.assigned_to !== membershipId && !inCrew) return null;

  const crew = stored ? stored.filter((e) => idOf(e) !== membershipId) : null;
  const firstLeft = (crew ?? []).map(idOf).find((id): id is string => !!id) ?? null;
  return {
    assigned_to: series.assigned_to === membershipId ? firstLeft : series.assigned_to,
    // An emptied crew is stored as null, the same as a template that never
    // had one, so generation falls back to assigned_to (now nobody).
    crew: crew && crew.length > 0 ? crew : null,
  };
}

/** A job that is still to be done: the only kind worth warning about. A
 *  finished or cancelled job naming someone who has since left is history. */
export function jobStillOpen(status: string): boolean {
  return status !== "completed" && status !== "cancelled";
}

/**
 * What the warning sign beside a booking's crew says when someone on it has
 * been deactivated, or null when nobody has.
 *
 * Before 2026-11-14 the bookings list showed a deactivated cleaner's name
 * like anyone else's: the job looked staffed, and nothing said the person
 * on it could not turn up. For a recurring booking the fix has to reach the
 * series, or the next visit is the same again, so the text says that.
 */
export function inactiveCrewWarning(names: string[], isSeries: boolean): string | null {
  if (names.length === 0) return null;
  const who = listNames(names);
  const one = names.length === 1;
  const lead = `${who} ${one ? "is" : "are"} deactivated and can't do this job.`;
  return isSeries
    ? `${lead} Change the crew, and choose "all future bookings" when you save so the rest of this recurring series is updated too.`
    : `${lead} Change the crew to someone active.`;
}

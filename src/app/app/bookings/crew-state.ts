import { resolveSegmentWindows, type SegmentInput } from "@/lib/booking-segments";

/**
 * The booking form's single crew picker: who is on the job, and — optionally —
 * when each of them is there.
 *
 * It replaced three controls that each chose people: a "Primary assignee"
 * dropdown, "Additional crew" pills, and, with per-cleaner times on, a person
 * dropdown on every time row. With times on you picked the same crew twice,
 * and the server used only one of the two picks — the splits rows decided who
 * was on the job, while the primary you had chosen above was silently left
 * off unless you'd named them again below.
 *
 * Everyone picked is equal. The server contract is unchanged, so nothing on
 * the server had to move: the first person is still sent as `assigned_to`
 * (that column is being phased out), the rest as `additional_assignees`, and
 * per-person times as `splits`.
 */

export type CrewWindow = {
  /** Minutes after the visit's start. */
  start_offset_minutes: number;
  duration_minutes: number;
};

export type CrewState = {
  /** Selected membership ids, in the order they were picked. */
  crew: string[];
  /** Whether each person has their own start and length. */
  timesOn: boolean;
  /** Per-person window, keyed by membership id. */
  windows: Record<string, CrewWindow>;
};

/** Whole-visit window, used for anyone who has no window of their own yet. */
export function wholeVisit(jobMinutes: number): CrewWindow {
  return { start_offset_minutes: 0, duration_minutes: jobMinutes > 0 ? jobMinutes : 120 };
}

/**
 * Rebuild the picker from what a saved booking holds.
 *
 * With saved per-person times, the crew is everyone named in them (resolved
 * through the same helper the server uses, so pre-2026-10 end-to-end splits
 * open with the windows they really have), followed by any additional crew
 * not in a window. Otherwise it is the selected cleaner plus additional crew.
 *
 * A person can hold only ONE window: the database keeps one crew row per
 * person per job and the server dedupes before writing, so a second window
 * for the same person was never actually stored. The first one wins here,
 * matching what was saved.
 */
export function initialCrewState({
  assignedTo,
  additional,
  splits,
}: {
  assignedTo: string | null | undefined;
  additional: string[] | null | undefined;
  splits: SegmentInput[] | null | undefined;
}): CrewState {
  const crew: string[] = [];
  const windows: Record<string, CrewWindow> = {};
  const add = (id: string | null | undefined) => {
    if (!id || crew.includes(id)) return false;
    crew.push(id);
    return true;
  };

  const segs = (splits ?? []).filter((s) => s.assigned_to);
  if (segs.length > 0) {
    for (const s of resolveSegmentWindows(splits ?? [])) {
      if (add(s.assigned_to)) {
        windows[s.assigned_to as string] = {
          start_offset_minutes: s.start_offset_minutes,
          duration_minutes: s.duration_minutes,
        };
      }
    }
    for (const id of additional ?? []) add(id);
    return { crew, timesOn: true, windows };
  }

  add(assignedTo);
  for (const id of additional ?? []) add(id);
  return { crew, timesOn: false, windows };
}

/**
 * What the form submits. Per-person times only go out when there are at least
 * two people to differ — one person "with their own times" is just the visit,
 * and the server's splits validation rejects a single segment anyway.
 */
export function crewFormFields(
  state: CrewState,
  jobMinutes: number,
): { assignedTo: string; additional: string[]; splits: string | null } {
  const withTimes = state.timesOn && state.crew.length >= 2;
  return {
    assignedTo: state.crew[0] ?? "",
    additional: state.crew.slice(1),
    splits: withTimes
      ? JSON.stringify(
          state.crew.map((id) => {
            const w = state.windows[id] ?? wholeVisit(jobMinutes);
            return {
              id,
              assigned_to: id,
              start_offset_minutes: w.start_offset_minutes,
              duration_minutes: w.duration_minutes,
            };
          }),
        )
      : null,
  };
}

/** Add or remove a person. Order of picking is kept; nobody outranks anyone. */
export function toggleCrewMember(state: CrewState, id: string): CrewState {
  return state.crew.includes(id)
    ? { ...state, crew: state.crew.filter((m) => m !== id) }
    : { ...state, crew: [...state.crew, id] };
}

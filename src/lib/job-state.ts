/**
 * What state a job is in, computed from the crew's shifts and the schedule.
 *
 * The job is the source of truth; cleaners are tracked around it. A cleaner's
 * tap only ever says something about her own shift (I'm here, I'm done). What
 * that means for the job is decided HERE, in one place, from all the shifts
 * together — never by the tap itself.
 *
 * Until 2026-10-27 the booking's status was written directly by whichever
 * tap or click came last, and every rule about crews was a patch on what one
 * person's tap should mean for everyone: an early Finish closed a job on
 * three people still coming; a no-show held another open all afternoon; the
 * "divide hours" share nearly clocked a crew out mid-clean. Each patch was
 * right about one case and wrong about the next, because the question
 * ("is this job over?") was being answered by the wrong party.
 *
 * Pure: no database, no clock. Everything comes in as arguments so the same
 * rules can be run over months of history (scripts/replay-job-state.ts) and
 * tested without a database. `syncJob` in job-sync.ts is the only caller that
 * acts on the answer.
 */

export type JobPhase =
  | "cancelled"
  /** Nobody has clocked in. */
  | "not_started"
  /** Someone is on the clock. */
  | "in_progress"
  /** Everyone who clocked in has clocked out, but the job isn't over: a
   *  rostered person hasn't arrived and the window hasn't passed. */
  | "finished_on_site"
  /** Over. Closed by a person, or by the rules. */
  | "done";

/** What a job needs from a human before it can rest. */
export type JobNeed =
  /** Done (or finishing) with no price and not marked free — nothing to invoice. */
  | "price"
  /** Finished on site; someone rostered never clocked in. Close it, or wait? */
  | "no_show_decision"
  /** Past its window with no shifts and no one assigned. */
  | "crew";

export type JobStateBooking = {
  status: string;
  scheduled_at: string;
  duration_minutes: number;
  total_cents: number | null;
  hourly_rate_cents: number | null;
  is_free: boolean | null;
  /** A manager declared it over. */
  closed_at: string | null;
  /**
   * "Divide hours evenly" is on for this job (its own flag, or the org
   * default). The hours entered are the one-person estimate and the crew
   * shares them: 18 hours for four people is a 4.5-hour job.
   */
  divides_hours?: boolean;
};

export type JobStateCrewRow = {
  membership_id: string;
  split_start_offset_minutes?: number | null;
  split_duration_minutes?: number | null;
};

export type JobStateShift = {
  employee_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
};

export type JobStateInput = {
  booking: JobStateBooking;
  crew: JobStateCrewRow[];
  shifts: JobStateShift[];
  now: number;
  /**
   * The org's "auto-complete past jobs" setting: how long after the window
   * ends a staffed job with NO shifts counts as done anyway (someone went
   * and nobody tapped). Null when the org has it off — those jobs wait for
   * a human.
   */
  autoCompleteAfterMinutes: number | null;
};

export type JobState = {
  phase: JobPhase;
  /** What bookings.status should read for this phase. */
  status: "pending" | "confirmed" | "in_progress" | "completed" | "cancelled";
  /** Membership ids currently on the clock. */
  onSite: string[];
  /** Clocked in and back out. */
  finished: string[];
  /** Rostered, not clocked in, and the window hasn't passed — still coming. */
  waitingOn: string[];
  /** Rostered, never clocked in, window over. */
  noShows: string[];
  /** When the window ends: scheduled start + the time the crew together
   *  should take (see teamMinutes), or later if someone has her own
   *  later segment. */
  windowEndMs: number;
  /** When the job will close itself if nothing else happens, or null. */
  closesAtMs: number | null;
  needs: JobNeed[];
};

/**
 * How long the job should take the crew together.
 *
 * The hours on a booking are the estimate for ONE person (that's the
 * number the office knows: "this house is 18 hours"). When the job
 * divides hours and two or more are rostered, the crew shares them, so
 * four people finish an 18-hour house in 4.5. That shared length is what
 * "finished" means for the job — when a no-show stops being "still
 * coming", when the office is asked about silence, when the job can close
 * itself. Lori Moeller, 2026-10-27: measured against 18 hours the job
 * would have waited for Ivanna until 3 AM; the crew was done at 12:30.
 *
 * Deliberately NOT what caps a cleaner's own clock. A share is arithmetic,
 * not a promise about one person's day, and a cleaner still working must
 * never be clocked out by it (clockOutWindowMinutes in shift-overrun.ts).
 */
export function teamMinutes(
  b: Pick<JobStateBooking, "duration_minutes" | "divides_hours">,
  crewCount: number,
): number {
  const full = b.duration_minutes ?? 0;
  if (!b.divides_hours || crewCount < 2 || full <= 0) return full;
  return Math.max(1, Math.round(full / crewCount));
}

function windowEnd(b: JobStateBooking, crew: JobStateCrewRow[]): number {
  const start = new Date(b.scheduled_at).getTime();
  // A person with her own arrival and length can end later than the job's
  // own length. The window is the latest of all of them.
  let end = start + teamMinutes(b, crew.length) * 60_000;
  for (const c of crew) {
    if (c.split_start_offset_minutes != null && c.split_duration_minutes) {
      end = Math.max(
        end,
        start +
          (c.split_start_offset_minutes + c.split_duration_minutes) * 60_000,
      );
    }
  }
  return end;
}

function hasPrice(b: JobStateBooking): boolean {
  if (b.is_free) return true;
  return (b.total_cents ?? 0) > 0 || (b.hourly_rate_cents ?? 0) > 0;
}

export function deriveJobState(input: JobStateInput): JobState {
  const { booking, crew, shifts, now, autoCompleteAfterMinutes } = input;
  const windowEndMs = windowEnd(booking, crew);
  const windowOver = now >= windowEndMs;

  const onSite = new Set<string>();
  const worked = new Set<string>();
  for (const s of shifts) {
    worked.add(s.employee_id);
    if (s.clock_out_at == null) onSite.add(s.employee_id);
  }
  const finished = [...worked].filter((id) => !onSite.has(id));
  const notArrived = crew
    .map((c) => c.membership_id)
    .filter((id) => !worked.has(id));

  const base = {
    onSite: [...onSite],
    finished,
    waitingOn: windowOver ? [] : notArrived,
    noShows: windowOver ? notArrived : [],
    windowEndMs,
  };
  const needs: JobNeed[] = [];
  const priceNeed = () => {
    if (!hasPrice(booking)) needs.push("price");
  };

  if (booking.status === "cancelled") {
    return {
      ...base,
      phase: "cancelled",
      status: "cancelled",
      closesAtMs: null,
      needs,
    };
  }

  // A person said it's over. That is the one input the rules never
  // overrule — but they still say what it needs.
  if (booking.closed_at) {
    priceNeed();
    return { ...base, phase: "done", status: "completed", closesAtMs: null, needs };
  }

  if (onSite.size > 0) {
    return {
      ...base,
      phase: "in_progress",
      status: "in_progress",
      // Someone's still working, so the window end is a forecast, not a
      // deadline: the job closes when they clock out, or at the end of the
      // window if that's later.
      closesAtMs: Math.max(windowEndMs, now),
      needs,
    };
  }

  if (worked.size > 0) {
    // Everyone who came has gone. Over, unless someone rostered is still
    // on her way — and "on her way" ends with the window. A no-show must
    // not strand the job (2026-10-27: Ivanna never clocked in; Lori
    // Moeller sat in progress from 12:30 to 10 PM), and an early finisher
    // must not close it on people still coming (2026-10-26: Olha tapped
    // Finish six minutes in; the other three were locked out).
    if (!windowOver && notArrived.length > 0) {
      needs.push("no_show_decision");
      return {
        ...base,
        phase: "finished_on_site",
        status: "in_progress",
        closesAtMs: windowEndMs,
        needs,
      };
    }
    priceNeed();
    return { ...base, phase: "done", status: "completed", closesAtMs: null, needs };
  }

  // Nobody has clocked in.
  if (windowOver && crew.length === 0) {
    needs.push("crew");
  }
  if (
    windowOver &&
    crew.length > 0 &&
    autoCompleteAfterMinutes != null &&
    now >= windowEndMs + autoCompleteAfterMinutes * 60_000
  ) {
    // Staffed, long past, and nobody ever tapped. The org asked for these
    // to be treated as done rather than left for a human.
    priceNeed();
    return { ...base, phase: "done", status: "completed", closesAtMs: null, needs };
  }
  const keep = booking.status === "pending" ? "pending" : "confirmed";
  return {
    ...base,
    phase: "not_started",
    status: keep,
    closesAtMs:
      crew.length > 0 && autoCompleteAfterMinutes != null
        ? windowEndMs + autoCompleteAfterMinutes * 60_000
        : null,
    needs,
  };
}

/**
 * The one line a manager reads instead of a status badge. Names come from
 * the caller so this stays free of lookups.
 */
export function describeJobState(
  state: JobState,
  opts: {
    nameOf: (membershipId: string) => string;
    formatTime: (ms: number) => string;
    crewSize: number;
  },
): string {
  const { nameOf, formatTime, crewSize } = opts;
  const list = (ids: string[]) => ids.map(nameOf).join(", ");
  const parts: string[] = [];

  switch (state.phase) {
    case "cancelled":
      return "Cancelled";
    case "not_started":
      if (state.noShows.length > 0 && crewSize > 0) {
        parts.push(`Nobody clocked in · window ended ${formatTime(state.windowEndMs)}`);
      } else if (crewSize === 0) {
        parts.push("Nobody assigned");
      } else {
        parts.push("Not started");
      }
      if (state.closesAtMs) parts.push(`closes itself ${formatTime(state.closesAtMs)}`);
      break;
    case "in_progress":
      parts.push(
        crewSize > 1
          ? `${state.onSite.length} of ${crewSize} on site`
          : "On site",
      );
      if (state.finished.length > 0) parts.push(`${list(state.finished)} finished`);
      if (state.waitingOn.length > 0) parts.push(`waiting on ${list(state.waitingOn)}`);
      if (state.noShows.length > 0) parts.push(`${list(state.noShows)} never clocked in`);
      break;
    case "finished_on_site":
      parts.push("Finished on site");
      parts.push(`waiting on ${list(state.waitingOn)}`);
      if (state.closesAtMs) parts.push(`closes itself ${formatTime(state.closesAtMs)}`);
      break;
    case "done":
      parts.push("Done");
      if (state.noShows.length > 0) parts.push(`${list(state.noShows)} never clocked in`);
      break;
  }
  if (state.needs.includes("price")) parts.push("needs a price");
  return parts.join(" · ");
}

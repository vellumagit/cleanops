import { formatDateTime } from "@/lib/format";

/**
 * The words for a double-booking refusal, and the times a proposed crew
 * would occupy. Pure, so both are tested without a database; the lookup
 * that feeds them is src/lib/crew-clashes.ts.
 *
 * The refusal used to be the database's own sentence, "A cleaner already
 * has an overlapping booking": no name, no date, no other job. On
 * 2026-11-14 Svitlana set up a fortnightly series for a new client (52
 * visits over two years). The cleaner she wanted was free on the first
 * visit and booked on four others, months out. The save was refused, she
 * tried again, it was refused again, and nothing on screen said which
 * dates. She saved the series with nobody on it and gave up on assigning.
 */

export type ProposedCrew = {
  membershipId: string;
  /** Their own start, in minutes after the visit starts. Null: the visit's. */
  startOffsetMinutes?: number | null;
  /** Their own length. Null: the crew's shared length. */
  durationMinutes?: number | null;
};

export type ProposedVisit = {
  /** Null for a visit that does not exist yet. */
  bookingId: string | null;
  scheduledAt: string;
  durationMinutes: number;
  /** This job's hours are shared across its crew (the booking's flag, or
   *  the company's setting). */
  dividesHours: boolean;
  crew: ProposedCrew[];
};

export type MemberWindow = { start_at: string; end_at: string };

/**
 * When each person would be on the job, per person, across every visit.
 *
 * The same arithmetic as the database's booking_member_windows (migration
 * 20261108060000), for a crew that is proposed rather than saved: shared
 * hours give each of N people duration ÷ N, and anyone with their own
 * start or length keeps it.
 */
export function proposedWindows(visits: ProposedVisit[]): Map<string, MemberWindow[]> {
  const out = new Map<string, MemberWindow[]>();
  for (const v of visits) {
    const start = new Date(v.scheduledAt).getTime();
    if (Number.isNaN(start)) continue;
    const members = new Map<string, ProposedCrew>();
    for (const c of v.crew) if (c.membershipId && !members.has(c.membershipId)) members.set(c.membershipId, c);
    const crewCount = members.size;
    if (crewCount === 0) continue;
    const full = Math.max(0, v.durationMinutes ?? 0);
    const teamMinutes = v.dividesHours && crewCount >= 2 && full > 0 ? Math.max(1, Math.round(full / crewCount)) : full;
    const hasSplit = [...members.values()].some((c) => c.startOffsetMinutes != null || c.durationMinutes != null);
    for (const c of members.values()) {
      const offset = hasSplit ? Math.max(0, c.startOffsetMinutes ?? 0) : 0;
      const minutes = hasSplit && c.durationMinutes != null ? Math.max(0, c.durationMinutes) : teamMinutes;
      if (minutes <= 0) continue;
      const list = out.get(c.membershipId) ?? [];
      list.push({
        start_at: new Date(start + offset * 60_000).toISOString(),
        end_at: new Date(start + (offset + minutes) * 60_000).toISOString(),
      });
      out.set(c.membershipId, list);
    }
  }
  return out;
}

export type CrewClash = {
  memberId: string;
  memberName: string;
  /** The job they are already on. */
  bookingId: string;
  clientName: string;
  scheduledAt: string;
};

/** How many clashing jobs are spelled out per person before "and N more". */
const LISTED_PER_PERSON = 4;
const LISTED_PEOPLE = 3;

/**
 * The refusal, in words: who is already booked, on which job, when. Null
 * when there is nothing to name, so the caller keeps its plain sentence.
 */
export function clashMessage(
  clashes: CrewClash[],
  opts: {
    tz: string;
    visitCount: number;
    /** An owner or admin saving one visit: they may keep the overlap and
     *  sort it out later ("Book anyway", migration 20261124020000). */
    canBookAnyway?: boolean;
  },
): string | null {
  if (clashes.length === 0) return null;
  const byMember = new Map<string, CrewClash[]>();
  for (const c of clashes) byMember.set(c.memberId, [...(byMember.get(c.memberId) ?? []), c]);
  const people = [...byMember.values()].map((list) =>
    [...list].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
  );
  const job = (c: CrewClash) => `${c.clientName}, ${formatDateTime(c.scheduledAt, opts.tz)}`;

  const sentences = people.slice(0, LISTED_PEOPLE).map((list) => {
    const name = list[0].memberName;
    const shown = list.slice(0, LISTED_PER_PERSON).map(job).join("; ");
    const more = list.length > LISTED_PER_PERSON ? `; and ${list.length - LISTED_PER_PERSON} more` : "";
    return list.length === 1
      ? `${name} is already booked then: ${shown}.`
      : `${name} is already booked on ${list.length} of these dates: ${shown}${more}.`;
  });
  if (people.length > LISTED_PEOPLE) {
    const rest = people.length - LISTED_PEOPLE;
    sentences.push(`${rest} more ${rest === 1 ? "person has" : "people have"} clashes too.`);
  }

  const next =
    opts.visitCount > 1
      ? "Nothing was changed. Choose someone who is free on every date, or put this crew on single visits and skip those dates."
      : opts.canBookAnyway
        ? "Nothing was changed. Pick someone else or another time, move that job first, or press Book anyway to keep both and sort it out later."
        : "Nothing was changed. Pick someone else or another time, or move that job first.";
  return `${sentences.join(" ")} ${next}`;
}

/**
 * What a "Book anyway" press agrees to: these people on these other jobs.
 * Posted back with the save; a save whose clashes have changed since (a
 * different time, someone else on the crew, the other job moved) no longer
 * matches and is asked again.
 */
export function clashKey(clashes: CrewClash[]): string {
  return [...new Set(clashes.map((c) => `${c.memberId}:${c.bookingId}`))].sort().join(",");
}

/** Postgres exclusion_violation, which the overlap guard raises. */
const DOUBLE_BOOKING_CODE = "23P01";

/**
 * True for the database's double-booking refusal, however it reached us.
 *
 * For an error that has already come back as a value: from an rpc (the
 * query guard leaves those alone) or from a query wrapped in
 * allowDbErrors(["23P01"], …). Inside the fail-closed scope an unwrapped
 * query throws before any branch can read its code, which is what
 * test/expected-db-errors.test.ts checks at each call site.
 */
export function isDoubleBookingError(
  err: { code?: string | null; message?: string | null; hint?: string | null } | null | undefined,
): boolean {
  if (!err) return false;
  // Same code, different refusal: its own sentence already says who and
  // when, and there is no other job to name. Callers fall through to the
  // database's message. Callers asking "is this slot free?" test the code
  // itself, so they still read it as not free.
  if (isLastWorkingDayError(err)) return false;
  return (err.code ?? "") === DOUBLE_BOOKING_CODE || /overlapping booking/i.test(err.message ?? "");
}

/**
 * The guard refusing someone on a visit after their last working day
 * (migration 20261124010000). It reuses the overlap code, 23P01, and says
 * "<name>'s last working day is <date>, so <name> can't be on a visit
 * after that."
 */
export function isLastWorkingDayError(
  err: { message?: string | null; hint?: string | null } | null | undefined,
): boolean {
  if (!err) return false;
  return (err.hint ?? "") === "last_working_day" || /last working day/i.test(err.message ?? "");
}

/**
 * A saved visit whose crew is also on another job at the time ("Book
 * anyway", or from before the guard), in words for the visit's page:
 * "Olha is also on Leslie Saumer's job then (Dec 7, 2026 · 9:00 AM)."
 * Null when there is nothing to say.
 */
export function alsoBookedSentence(clashes: CrewClash[], tz: string): string | null {
  if (clashes.length === 0) return null;
  const byMember = new Map<string, CrewClash[]>();
  for (const c of clashes) byMember.set(c.memberId, [...(byMember.get(c.memberId) ?? []), c]);
  return [...byMember.values()]
    .map((list) => {
      const jobs = [...list]
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
        .map((c) => `${c.clientName}'s job (${formatDateTime(c.scheduledAt, tz)})`);
      const named = jobs.length === 1 ? jobs[0] : `${jobs.slice(0, -1).join(", ")} and ${jobs[jobs.length - 1]}`;
      return `${list[0].memberName} is also on ${named} at the same time.`;
    })
    .join(" ");
}

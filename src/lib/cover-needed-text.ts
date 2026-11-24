/**
 * The words for "this visit needs cover": a recurring series' crew was put
 * on every visit they were free for, and someone with another job at that
 * time was left off that one visit (migration 20261119040000). Pure, so the
 * wording is tested without a database; the lookup is lib/cover-needed.ts.
 */

export type CoverPerson = {
  membershipId: string;
  name: string;
  /** The job they were on instead, when it can still be named. */
  otherClient: string | null;
  otherAt: string | null;
  /** Set when they were left off because the visit falls after their last
   *  working day (YYYY-MM-DD), not for another job. */
  finishedOn?: string | null;
};

/** "Fri, Dec 18" for a YYYY-MM-DD calendar date. */
const calendarDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export type CoverVisit = {
  bookingId: string;
  scheduledAt: string;
  clientName: string;
  people: CoverPerson[];
};

const LISTED_DATES = 6;

const day = (iso: string, tz: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });
const clock = (iso: string, tz: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });

/** "Anna Cleaner is on another job then (Smith, 9:00 AM)": one visit's reason. */
export function coverReason(visit: CoverVisit, tz: string): string {
  return visit.people
    .map((p) => {
      if (p.finishedOn) return `${p.name}'s last working day is ${calendarDay(p.finishedOn)}`;
      if (p.finishedOn === "") return `${p.name} was left off this visit`;
      const where = p.otherClient ? ` (${p.otherClient}${p.otherAt ? `, ${clock(p.otherAt, tz)}` : ""})` : "";
      return `${p.name} is on another job then${where}`;
    })
    .join("; ");
}

/**
 * The "why" sentence for a visit marked as needing cover, without the
 * "pick someone else" that each place words its own way. A reason from a
 * series' crew save ("X is on another job then") gets how it happened; a
 * last working day stands on its own (it takes someone off however the
 * crew was set, so "when the series' crew was set" would be untrue).
 */
export function leftOffSentence(reason: string): string {
  if (/last working day|was left off this visit/.test(reason)) return `${reason.replace(/; /g, ". ")}.`;
  return `${reason}, so they were left off this visit when the series' crew was set.`;
}

/**
 * What a series save says when it left people off some visits, or null when
 * it left nobody off. Per person: how many visits, and which dates.
 */
export function coverSummary(visits: CoverVisit[], tz: string, totalVisits?: number): string | null {
  if (visits.length === 0) return null;
  // Keyed by person and reason: someone busy on one date and finished by
  // another gets a sentence for each.
  const byPerson = new Map<string, { name: string; finishedOn: string | null; dates: string[] }>();
  for (const v of [...visits].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
    for (const p of v.people) {
      const key = `${p.membershipId}|${p.finishedOn ?? ""}`;
      const entry = byPerson.get(key) ?? { name: p.name, finishedOn: p.finishedOn ?? null, dates: [] };
      entry.dates.push(day(v.scheduledAt, tz));
      byPerson.set(key, entry);
    }
  }
  const of = totalVisits && totalVisits > 0 ? ` of the ${totalVisits}` : "";
  const parts = [...byPerson.values()].map(({ name, finishedOn, dates }) => {
    const listed = dates.slice(0, LISTED_DATES).join(", ");
    const more = dates.length > LISTED_DATES ? `, and ${dates.length - LISTED_DATES} more` : "";
    const visitWord = `visit${dates.length === 1 && !of ? "" : "s"}`;
    const them = dates.length === 1 ? "it" : "them";
    if (finishedOn) {
      return `${name}'s last working day is ${calendarDay(finishedOn)}, so ${name} was left off ${dates.length}${of} ${visitWord} after it (${listed}${more}).`;
    }
    return `${name} is on another job on ${dates.length}${of} ${visitWord} (${listed}${more}) and was left off ${them}.`;
  });
  const n = visits.length;
  return `${parts.join(" ")} ${n === 1 ? "That visit is" : `Those ${n} visits are`} marked "Needs cover": open ${n === 1 ? "it" : "each one"} and pick someone else.`;
}

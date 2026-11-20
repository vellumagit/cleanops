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
};

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
      const where = p.otherClient ? ` (${p.otherClient}${p.otherAt ? `, ${clock(p.otherAt, tz)}` : ""})` : "";
      return `${p.name} is on another job then${where}`;
    })
    .join("; ");
}

/**
 * What a series save says when it left people off some visits, or null when
 * it left nobody off. Per person: how many visits, and which dates.
 */
export function coverSummary(visits: CoverVisit[], tz: string, totalVisits?: number): string | null {
  if (visits.length === 0) return null;
  const byPerson = new Map<string, { name: string; dates: string[] }>();
  for (const v of [...visits].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
    for (const p of v.people) {
      const entry = byPerson.get(p.membershipId) ?? { name: p.name, dates: [] };
      entry.dates.push(day(v.scheduledAt, tz));
      byPerson.set(p.membershipId, entry);
    }
  }
  const of = totalVisits && totalVisits > 0 ? ` of the ${totalVisits}` : "";
  const parts = [...byPerson.values()].map(({ name, dates }) => {
    const listed = dates.slice(0, LISTED_DATES).join(", ");
    const more = dates.length > LISTED_DATES ? `, and ${dates.length - LISTED_DATES} more` : "";
    return `${name} is on another job on ${dates.length}${of} visit${dates.length === 1 && !of ? "" : "s"} (${listed}${more}) and was left off ${dates.length === 1 ? "it" : "them"}.`;
  });
  const n = visits.length;
  return `${parts.join(" ")} ${n === 1 ? "That visit is" : `Those ${n} visits are`} marked "Needs cover": open ${n === 1 ? "it" : "each one"} and pick someone else.`;
}

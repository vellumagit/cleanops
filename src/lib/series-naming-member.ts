/**
 * The recurring series that still name someone who has a last working day.
 *
 * Setting a last working day takes the person off the visits already made
 * after it, and the nightly top-up leaves them off every new one. It does
 * not change the series itself: the series still names them, so each new
 * batch of visits comes out a person short (or with nobody) until someone
 * gives the series a new crew. Nothing said which series those were. This
 * lists them on the person's page, each with the visit to open.
 *
 * The first half is pure, for tests; the loader is at the bottom.
 */
import { parseSeriesCrew } from "./series-crew";
import { zonedYmd } from "./wall-clock";

export type SeriesRow = {
  id: string;
  assigned_to: string | null;
  crew: unknown;
  pattern: string;
  /** YYYY-MM-DD, or null for a series with no end. */
  ends_at: string | null;
  client_name: string | null;
};

export type UpcomingVisit = { id: string; series_id: string; scheduled_at: string };

export type SeriesNamingMember = {
  seriesId: string;
  clientName: string;
  /** "Weekly", "Every 2 weeks"... */
  frequency: string;
  /** The visit to open and re-staff from: the first one after the last
   *  working day, or the latest one coming up when none is that far out
   *  yet. Null when the series has no visit coming up at all. */
  visitId: string | null;
  visitAt: string | null;
  /** True when `visitId` is after the last working day (so the person is
   *  already off it and it reads "Needs cover"). */
  visitIsAfterLastDay: boolean;
};

const FREQUENCY: Record<string, string> = {
  weekly: "Weekly",
  bi_weekly: "Every 2 weeks",
  tri_weekly: "Every 3 weeks",
  quad_weekly: "Every 4 weeks",
  monthly: "Monthly",
  every_2_months: "Every 2 months",
  every_3_months: "Every 3 months",
  every_6_months: "Every 6 months",
  monthly_nth: "Monthly",
  custom_weekly: "Set days each week",
};

export function frequencyLabel(pattern: string): string {
  return FREQUENCY[pattern] ?? "Recurring";
}

/** Is this person on the series' crew (the stored crew, or the one cleaner
 *  an older series holds)? */
export function seriesNames(series: Pick<SeriesRow, "assigned_to" | "crew">, memberId: string): boolean {
  if (series.assigned_to === memberId) return true;
  return parseSeriesCrew(series.crew).some((m) => m.membership_id === memberId);
}

/**
 * The series that will go on making visits after `lastDay` and still name
 * this person, each with the visit to open. `upcoming` is every visit of
 * those series still ahead, in any order.
 */
export function seriesNamingMember(
  series: SeriesRow[],
  upcoming: UpcomingVisit[],
  memberId: string,
  lastDay: string,
  tz: string,
): SeriesNamingMember[] {
  const bySeries = new Map<string, UpcomingVisit[]>();
  for (const v of upcoming) {
    const list = bySeries.get(v.series_id) ?? [];
    list.push(v);
    bySeries.set(v.series_id, list);
  }
  const out: SeriesNamingMember[] = [];
  for (const s of series) {
    if (!seriesNames(s, memberId)) continue;
    // A series that ends on or before the last day makes nothing after it.
    if (s.ends_at && s.ends_at <= lastDay) continue;
    const visits = (bySeries.get(s.id) ?? []).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    const after = visits.find((v) => zonedYmd(new Date(v.scheduled_at), tz) > lastDay) ?? null;
    const pick = after ?? visits[visits.length - 1] ?? null;
    out.push({
      seriesId: s.id,
      clientName: s.client_name?.trim() || "A client",
      frequency: frequencyLabel(s.pattern),
      visitId: pick?.id ?? null,
      visitAt: pick?.scheduled_at ?? null,
      visitIsAfterLastDay: after !== null,
    });
  }
  return out.sort((a, b) => a.clientName.localeCompare(b.clientName));
}

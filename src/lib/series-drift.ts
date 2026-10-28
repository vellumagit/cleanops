/**
 * Series drift: visits whose stored time no longer says what their series
 * says.
 *
 * A recurring series is the intent — "every other Monday at 9:00 AM" in the
 * org's zone. Each generated visit is a copy, stored as an exact instant. The
 * two can part ways without anyone touching the visit: the zone's rules
 * change (Alberta stopped changing its clocks from 2026-11-01; the server
 * generated winter visits on the old rules until about 2026-09-29, so each
 * one sits an hour late), or the series' time is edited after visits exist.
 *
 * This compares every future visit to its series under the CURRENT rules and
 * names the ones that differ, leaving out any a person set by hand
 * (bookings.time_set_by_hand_at). Pure: the loader fetches, this decides.
 *
 * Deliberately a question for the office, not a silent correction. On
 * 2026-10-08 a "repair" read correct times through stale rules and moved
 * them wrong; a list with a Restore button and a Keep button is the shape
 * that can't do that.
 */
import { zonedWallClockUtc, zonedYmd } from "./wall-clock";

export type DriftSeries = {
  id: string;
  /** "HH:MM" or "HH:MM:SS", the series' wall-clock start. */
  start_time: string;
  clientName: string;
};

export type DriftVisit = {
  id: string;
  series_id: string;
  scheduled_at: string;
  status: string;
  time_set_by_hand_at: string | null;
};

export type DriftedVisit = {
  id: string;
  scheduled_at: string;
  /** The instant the series says this visit should be at. */
  expected_at: string;
  /** Visit minus expected, in minutes. +60 = stored an hour late. */
  deltaMinutes: number;
};

export type SeriesDrift = {
  seriesId: string;
  clientName: string;
  startTime: string;
  visits: DriftedVisit[];
};

/**
 * The instant the series puts a visit at, given the visit's own date: the
 * date the stored instant falls on in the org's zone, at the series' start
 * time. The date is kept and only the time is corrected, so a visit the
 * generator placed on the right day but at the wrong instant comes back to
 * the right day.
 */
export function expectedVisitInstant(
  visitIso: string,
  startTime: string,
  tz: string,
): Date {
  const ymd = zonedYmd(new Date(visitIso), tz);
  return zonedWallClockUtc(ymd, startTime.slice(0, 5), tz);
}

export function findSeriesDrift(args: {
  series: DriftSeries[];
  visits: DriftVisit[];
  tz: string;
  now: number;
}): SeriesDrift[] {
  const byId = new Map(args.series.map((s) => [s.id, s]));
  const out = new Map<string, SeriesDrift>();
  for (const v of args.visits) {
    const s = byId.get(v.series_id);
    if (!s) continue;
    if (v.time_set_by_hand_at) continue;
    if (v.status === "cancelled" || v.status === "completed") continue;
    const at = new Date(v.scheduled_at).getTime();
    if (at < args.now) continue;
    const expected = expectedVisitInstant(v.scheduled_at, s.start_time, args.tz);
    const delta = Math.round((at - expected.getTime()) / 60_000);
    if (delta === 0) continue;
    const d = out.get(s.id) ?? {
      seriesId: s.id,
      clientName: s.clientName,
      startTime: s.start_time.slice(0, 5),
      visits: [],
    };
    d.visits.push({
      id: v.id,
      scheduled_at: v.scheduled_at,
      expected_at: expected.toISOString(),
      deltaMinutes: delta,
    });
    out.set(s.id, d);
  }
  const list = [...out.values()];
  for (const d of list) d.visits.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  list.sort((a, b) => a.visits[0].scheduled_at.localeCompare(b.visits[0].scheduled_at));
  return list;
}

/** "an hour late", "30 min early", "2h 15m late". */
export function describeDelta(deltaMinutes: number): string {
  const abs = Math.abs(deltaMinutes);
  const dir = deltaMinutes > 0 ? "late" : "early";
  if (abs === 60) return `an hour ${dir}`;
  if (abs % 60 === 0) return `${abs / 60} hours ${dir}`;
  if (abs < 60) return `${abs} min ${dir}`;
  return `${Math.floor(abs / 60)}h ${abs % 60}m ${dir}`;
}

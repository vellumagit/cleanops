/**
 * A visit's time as a person booked it, and the instant derived from it.
 *
 * The wall clock ("2026-12-07T09:00" in America/Edmonton) is the truth. The
 * instant (bookings.scheduled_at) is what every query reads, and it is a
 * cache of the wall clock under the zone rules known when it was written.
 * Rules change — Alberta stopped changing its clocks from 2026-11-01, and
 * every winter visit converted before the server knew sat an hour late with
 * no record of the hour that was typed. Storing the wall clock makes that a
 * one-night self-correction instead of a hunt (see planRederive).
 *
 * Pure. The job that applies it is scheduled-local-job.ts.
 */
import { toDatetimeLocal, zonedWallClockUtc } from "./wall-clock";
import { runtimeKnowsZone } from "./tz-probe";

/** "YYYY-MM-DDTHH:MM" — what a datetime-local input holds. */
export type WallClock = string;

const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

/** Normalize a datetime-local string to exactly "YYYY-MM-DDTHH:MM", or null. */
export function normalizeWallClock(input: string | null | undefined): WallClock | null {
  const m = String(input ?? "")
    .trim()
    .match(WALL_CLOCK);
  return m ? `${m[1]}T${m[2]}` : null;
}

/** The instant `tz`'s clock reads `local`, under this runtime's rules. */
export function instantForWallClock(local: WallClock, tz: string): string {
  const m = local.match(WALL_CLOCK);
  if (!m) throw new Error(`not a wall clock: ${local}`);
  return zonedWallClockUtc(m[1], m[2], tz).toISOString();
}

/** What `tz`'s clock reads at `iso`. */
export function wallClockForInstant(iso: string, tz: string): WallClock {
  return toDatetimeLocal(iso, tz);
}

/**
 * The three columns a writer that knows the wall clock sets together. The
 * instant is computed here so the two can't disagree at the moment of
 * writing.
 */
export function scheduleFromWallClock(
  local: WallClock,
  tz: string,
): { scheduled_at: string; scheduled_local: WallClock; scheduled_tz: string } {
  return { scheduled_at: instantForWallClock(local, tz), scheduled_local: local, scheduled_tz: tz };
}

/**
 * The wall-clock columns, for spreading into an insert/update whose generated
 * type doesn't know them yet. Typed as `object` so the spread adds nothing the
 * type checker argues with. Pass the wall clock a person typed; the instant
 * itself is still set by the caller from the same text.
 */
export function wallClockColumns(local: string | null | undefined, tz: string): object {
  const norm = normalizeWallClock(local);
  return norm ? { scheduled_local: norm, scheduled_tz: tz } : {};
}

export type RederiveRow = {
  id: string;
  scheduled_at: string;
  scheduled_local: string | null;
  scheduled_tz: string | null;
};

export type RederiveChange = { id: string; from: string; to: string; tz: string; local: string };

/**
 * Which future visits' instants no longer match their wall clock under the
 * current rules. Refuses to touch a zone this runtime has wrong
 * (runtimeKnowsZone): re-deriving on stale rules would move every correct
 * visit an hour off, which is the exact harm this exists to undo. Past
 * visits are history and are never moved.
 */
export function planRederive(
  rows: RederiveRow[],
  opts: { now: number; knowsZone?: (tz: string) => boolean },
): { changes: RederiveChange[]; refusedZones: string[] } {
  const knows = opts.knowsZone ?? runtimeKnowsZone;
  const changes: RederiveChange[] = [];
  const refused = new Set<string>();
  const zoneOk = new Map<string, boolean>();
  for (const r of rows) {
    if (!r.scheduled_local || !r.scheduled_tz) continue;
    const local = normalizeWallClock(r.scheduled_local);
    if (!local) continue;
    if (new Date(r.scheduled_at).getTime() < opts.now) continue;
    let ok = zoneOk.get(r.scheduled_tz);
    if (ok === undefined) {
      ok = knows(r.scheduled_tz);
      zoneOk.set(r.scheduled_tz, ok);
    }
    if (!ok) {
      refused.add(r.scheduled_tz);
      continue;
    }
    let to: string;
    try {
      to = instantForWallClock(local, r.scheduled_tz);
    } catch {
      continue;
    }
    if (new Date(to).getTime() === new Date(r.scheduled_at).getTime()) continue;
    changes.push({ id: r.id, from: new Date(r.scheduled_at).toISOString(), to, tz: r.scheduled_tz, local });
  }
  return { changes, refusedZones: [...refused] };
}

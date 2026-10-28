/**
 * Does this device agree with the server about the org's clock?
 *
 * Every time on the board, the field app and the calendar is formatted on the
 * DEVICE, with the device's own copy of the timezone rules. Alberta moved to
 * permanent UTC-6 from 2026-11-01 (tzdata 2026c); a phone or browser still on
 * older rules turns every winter visit an hour early — a 1:15 job reads 12:15,
 * with nothing on screen to say anything is off.
 *
 * The server (current rules) computes the org's UTC offset at a handful of
 * dates spread across the next year; the device computes the same and any
 * disagreement means its rules are stale. Spread across seasons so any
 * daylight-saving change — or the lack of one — lands between two samples.
 */

export type TzProbe = {
  tz: string;
  samples: Array<{ at: string; offsetMinutes: number }>;
};

/** Minutes `tz` is ahead of UTC at `instant` (negative = behind). */
export function tzOffsetMinutes(tz: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const n = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    n("year"),
    n("month") - 1,
    n("day"),
    n("hour") % 24,
    n("minute"),
    n("second"),
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/**
 * Zone facts this server's runtime must know before it turns a wall-clock
 * time into an instant for a future date. Each was missing from some
 * runtime at some point and cost real visits.
 *
 * America/Edmonton: permanent UTC-6 from 2026-11-01. Until about 2026-09-29
 * production still fell Edmonton back to UTC-7, and every winter visit the
 * series generator made in that time was stored an hour late (a 9:00 AM
 * clean saved as 10:00 — scripts/fix-alberta-winter-times.ts).
 */
const KNOWN_ZONE_FACTS: Record<string, Array<{ at: string; offsetMinutes: number }>> = {
  "America/Edmonton": [{ at: "2026-12-15T18:00:00Z", offsetMinutes: -360 }],
};

/**
 * True when this runtime's rules for `tz` agree with every known fact. A
 * zone with no facts on file is trusted. Callers generating future times
 * should refuse when this is false: a visit stored an hour off is worse
 * than a visit not generated yet, because nothing says it's wrong.
 */
export function runtimeKnowsZone(
  tz: string,
  offset: (tz: string, instant: Date) => number = tzOffsetMinutes,
): boolean {
  for (const f of KNOWN_ZONE_FACTS[tz] ?? []) {
    try {
      if (offset(tz, new Date(f.at)) !== f.offsetMinutes) return false;
    } catch {
      return false;
    }
  }
  return true;
}

const SAMPLE_DAYS = [0, 45, 100, 160, 220, 280, 340];

export function buildTzProbe(tz: string, now: Date = new Date()): TzProbe {
  const noon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
  return {
    tz,
    samples: SAMPLE_DAYS.map((d) => {
      const at = new Date(noon + d * 86_400_000);
      return { at: at.toISOString(), offsetMinutes: tzOffsetMinutes(tz, at) };
    }),
  };
}

export type TzMismatch = {
  /** First sampled date the device gets wrong. */
  at: string;
  /** Device minus server: negative = the device shows times early. */
  diffMinutes: number;
};

export function findTzMismatch(
  probe: TzProbe,
  deviceOffset: (tz: string, instant: Date) => number = tzOffsetMinutes,
): TzMismatch | null {
  let prev: { at: number; device: number } | null = null;
  for (const s of probe.samples) {
    const at = new Date(s.at).getTime();
    let device: number;
    try {
      device = deviceOffset(probe.tz, new Date(at));
    } catch {
      return null; // a device that can't format the zone at all: not this check's job
    }
    if (device !== s.offsetMinutes) {
      // Name the day it starts, not the sample that caught it: between the
      // last sample the device got right and this one, find the first day
      // the device's offset changes (Nov 1, for Alberta).
      let start = at;
      if (prev) {
        let lo = prev.at;
        let hi = at;
        while (hi - lo > 86_400_000) {
          const mid = lo + Math.floor((hi - lo) / 2 / 86_400_000) * 86_400_000;
          if (mid <= lo) break;
          if (deviceOffset(probe.tz, new Date(mid)) === prev.device) lo = mid;
          else hi = mid;
        }
        start = hi;
      }
      return {
        at: new Date(start).toISOString(),
        diffMinutes: device - s.offsetMinutes,
      };
    }
    prev = { at, device };
  }
  return null;
}

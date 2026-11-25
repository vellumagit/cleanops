/**
 * Open times: when could a visitor book this service on this day?
 *
 * The core of online booking (docs/online-booking-roadmap.md, phase 2), and
 * deliberately nothing but arithmetic: no database, no clock of its own, no
 * time zone of its own. Everything it needs is handed in, so every rule here
 * is tested directly (open-times.test.ts) and the same answer comes out for
 * the office's preview today and for the public page later.
 *
 * A time is open when ALL of these hold:
 *   - the company is open then (its opening hours for that weekday), and the
 *     day isn't one it closed;
 *   - it is far enough ahead (the notice the company asks for) and not too
 *     far ahead (how far out it takes bookings);
 *   - the whole visit fits inside one stretch of opening hours;
 *   - enough of the cleaners who take online bookings are free for the whole
 *     visit: not off that day, inside the hours they said they work, and
 *     with no other job within the gap the company leaves between jobs;
 *   - and, of those, enough are left once visits booked online that nobody
 *     is on yet have each kept the people they will need. An online booking
 *     is left for the office to staff (2026-11-25), so until it is, it holds
 *     a person's time without naming whose.
 *
 * How long each person is on site follows the rule the double-booking guard
 * uses: when a crew shares a job's hours, N people are each there for the
 * booked length divided by N. The booked length is the one-person estimate.
 *
 * All instants are epoch milliseconds. Wall-clock times ("09:30") are read
 * in the company's zone, by the caller-supplied `at`, which is the one
 * place a zone enters. Steps are real elapsed time, so a day on which the
 * clocks change has the right number of slots, each labelled by what the
 * clock on the wall will actually say.
 */

/** A stretch of a day, as wall-clock times: { start: "09:00", end: "17:00" }. */
export type Hours = { start: string; end: string };

export type Busy = { startMs: number; endMs: number };

/** A visit booked online that nobody is on yet: it holds `need` people for this window. */
export type Held = Busy & { need: number };

export type OpenTimeRules = {
  /** Opening hours by weekday, 0 = Sunday. A missing or empty day is closed. */
  openingHours: Record<number, Hours[]>;
  /** How far ahead a booking must be made. */
  minNoticeHours: number;
  /** How many days ahead bookings are taken. 0 = today only. */
  maxDaysAhead: number;
  /** Time kept clear on each side of a cleaner's other jobs. */
  gapMinutes: number;
  /** How far apart offered start times are. */
  stepMinutes: number;
};

export type EngineCleaner = {
  id: string;
  /** Approved time off, or the day marked unavailable. */
  off: boolean;
  /**
   * The hours this person works on THIS day: hours given for the date if
   * there are any, otherwise their weekly hours for the weekday. An empty
   * list means they don't work that day. Null means they never said, which
   * is "unknown", not "never": nothing is held against them.
   */
  hours: Hours[] | null;
  /** When they are already on a job, around this day. */
  busy: Busy[];
};

export type OpenTime = {
  startMs: number;
  /** The wall-clock start, "09:30". */
  hhmm: string;
  /** Who is free then, in the order given, before visits nobody is on yet
   *  take their share. At least `crewSize` more than those visits need. */
  cleaners: string[];
};

/** Why a day has no open times, for saying so in words. */
export type NoTimesReason =
  | "no_length" // the service has no length to fit
  | "past" // the day is over, or before today
  | "too_far" // beyond how far ahead bookings are taken
  | "closed" // not a day the company is open
  | "no_cleaners" // nobody takes online bookings
  | "too_soon" // every time is inside the notice period
  | "full"; // times exist; nobody is free for any of them

export type OpenTimesResult = { times: OpenTime[]; reason: NoTimesReason | null };

const MIN = 60_000;
const DAY = 86_400_000;

const validHHMM = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Wall-clock blocks as instants, sorted, with touching or overlapping ones
 *  joined: 8 to 12 and 12 to 4 is one stretch of work. */
function stretches(blocks: Hours[], at: (hhmm: string) => number): Busy[] {
  const spans = blocks
    .filter((b) => validHHMM(b.start) && validHHMM(b.end) && b.start < b.end)
    .map((b) => ({ startMs: at(b.start), endMs: at(b.end) }))
    .filter((b) => Number.isFinite(b.startMs) && Number.isFinite(b.endMs) && b.startMs < b.endMs)
    .sort((a, b) => a.startMs - b.startMs);
  const out: Busy[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && span.startMs <= last.endMs) last.endMs = Math.max(last.endMs, span.endMs);
    else out.push({ ...span });
  }
  return out;
}

/** How long each of `crewSize` people is on site for a job of this length. */
export function onSiteMinutes(durationMinutes: number, crewSize: number, sharesHours: boolean): number {
  const full = Math.max(0, Math.floor(durationMinutes));
  return sharesHours && crewSize >= 2 && full > 0 ? Math.max(1, Math.round(full / crewSize)) : full;
}

export function openTimesForDay(input: {
  /** The day, on the company's calendar: "2027-03-05". */
  ymd: string;
  /** Today on the company's calendar. */
  todayYmd: string;
  nowMs: number;
  /** The instant the company's wall clock reads this time on `ymd`. */
  at: (hhmm: string) => number;
  /** The wall-clock time the company's clock reads at an instant, "09:30". */
  clock: (ms: number) => string;
  rules: OpenTimeRules;
  /** The company is shut that day whatever the weekday says (a holiday). */
  closed?: boolean;
  /** The service's booked length: the hours for one person. */
  durationMinutes: number;
  /** How many cleaners the job needs. */
  crewSize: number;
  /** A crew shares the job's hours (the company's setting). */
  sharesHours: boolean;
  /** The cleaners who take online bookings. */
  cleaners: EngineCleaner[];
  /** Visits booked online that nobody is on yet, around this day. */
  held?: Held[];
}): OpenTimesResult {
  const none = (reason: NoTimesReason): OpenTimesResult => ({ times: [], reason });
  const { rules } = input;
  const crewSize = Math.max(1, Math.floor(input.crewSize));
  const onSite = onSiteMinutes(input.durationMinutes, crewSize, input.sharesHours);
  if (onSite <= 0) return none("no_length");

  // Whole days between today and that day, on the calendar, not the clock.
  const dayNumber = (ymd: string) => Date.parse(`${ymd}T12:00:00Z`);
  const ahead = Math.round((dayNumber(input.ymd) - dayNumber(input.todayYmd)) / DAY);
  if (!Number.isFinite(ahead) || ahead < 0) return none("past");
  if (ahead > Math.max(0, rules.maxDaysAhead)) return none("too_far");

  const weekday = new Date(`${input.ymd}T12:00:00Z`).getUTCDay();
  const open = input.closed ? [] : stretches(rules.openingHours[weekday] ?? [], input.at);
  if (open.length === 0) return none("closed");
  if (input.cleaners.length === 0) return none("no_cleaners");

  const step = Math.max(5, Math.floor(rules.stepMinutes)) * MIN;
  const gap = Math.max(0, rules.gapMinutes) * MIN;
  const earliest = input.nowMs + Math.max(0, rules.minNoticeHours) * 3_600_000;

  // Each cleaner's own working stretches that day, worked out once.
  const working = input.cleaners
    .filter((c) => !c.off && (c.hours === null || c.hours.length > 0))
    .map((c) => ({ id: c.id, busy: c.busy, hours: c.hours === null ? null : stretches(c.hours, input.at) }));

  const times: OpenTime[] = [];
  const seen = new Set<number>();
  let anyCandidate = false;
  let anyAfterNotice = false;
  for (const stretch of open) {
    for (let start = stretch.startMs; start + onSite * MIN <= stretch.endMs; start += step) {
      anyCandidate = true;
      if (start < earliest) continue;
      anyAfterNotice = true;
      if (seen.has(start)) continue;
      const end = start + onSite * MIN;
      const free = working
        .filter((c) => c.hours === null || c.hours.some((h) => start >= h.startMs && end <= h.endMs))
        .filter((c) => !c.busy.some((b) => b.startMs < end + gap && b.endMs > start - gap))
        .map((c) => c.id);
      // Visits nobody is on yet keep the people they will need.
      if (free.length - heldPeopleDuring(input.held ?? [], start, end, gap) < crewSize) continue;
      seen.add(start);
      times.push({ startMs: start, hhmm: input.clock(start), cleaners: free });
    }
  }
  if (times.length > 0) return { times, reason: null };
  if (!anyCandidate) return none("closed"); // open, but never for long enough to fit the visit
  if (!anyAfterNotice) return none("too_soon");
  return none("full");
}

/**
 * How many people visits nobody is on yet need at once, at the busiest
 * moment of [startMs, endMs), the gap included: whoever does one can't
 * start the next until the gap has passed. The busiest moment, not the sum:
 * a visit from 9 to 11 and one from 11 to 1 can be one person's day, which
 * leaves the other free for 10 to 12.
 */
export function heldPeopleDuring(held: Held[], startMs: number, endMs: number, gapMs: number): number {
  // Each held visit as [start, end + gap); this visit as [start, end + gap).
  const hi = endMs + gapMs;
  const near = held.filter((h) => h.startMs < hi && h.endMs + gapMs > startMs);
  if (near.length === 0) return 0;
  const points = [startMs, ...near.map((h) => h.startMs).filter((t) => t > startMs && t < hi)];
  let most = 0;
  for (const t of points) {
    const at = near.filter((h) => h.startMs <= t && t < h.endMs + gapMs).reduce((n, h) => n + Math.max(1, Math.floor(h.need)), 0);
    if (at > most) most = at;
  }
  return most;
}

/** A sentence for a day with no open times, for the office's preview. */
export function noTimesSentence(reason: NoTimesReason): string {
  switch (reason) {
    case "no_length":
      return "This service has no length set, so nothing can be fitted. Give it one in Settings, Services.";
    case "past":
      return "This day has passed.";
    case "too_far":
      return "Further ahead than you take bookings.";
    case "closed":
      return "Closed.";
    case "no_cleaners":
      return "Nobody is set to take online bookings.";
    case "too_soon":
      return "Too soon: inside the notice you ask for.";
    case "full":
      return "No open times: nobody is free.";
  }
}

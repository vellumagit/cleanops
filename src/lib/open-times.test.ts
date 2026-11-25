/**
 * Open times: every rule, on its own and at its edges. The engine has no
 * database and no clock, so each case hands it exactly the world it is
 * about. Regina keeps one clock all year; Toronto is used for the days the
 * clocks change.
 */
import { describe, expect, it } from "vitest";
import { noTimesSentence, onSiteMinutes, openTimesForDay, type EngineCleaner, type Held, type OpenTimeRules } from "./open-times";
import { zonedParts, zonedWallClockUtc } from "./wall-clock";

const REGINA = "America/Regina";
const TORONTO = "America/Toronto";
const DAY = "2027-03-05"; // a Friday
const pad = (n: number) => String(n).padStart(2, "0");

const world = (tz: string, ymd: string) => ({
  at: (hhmm: string) => zonedWallClockUtc(ymd, hhmm, tz).getTime(),
  clock: (ms: number) => {
    const p = zonedParts(new Date(ms), tz);
    return `${pad(p.hour)}:${pad(p.minute)}`;
  },
});

const nineToFive: OpenTimeRules = {
  openingHours: Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, [{ start: "09:00", end: "17:00" }]])),
  minNoticeHours: 0,
  maxDaysAhead: 60,
  gapMinutes: 0,
  stepMinutes: 60,
};
const free = (id: string, over: Partial<EngineCleaner> = {}): EngineCleaner => ({ id, off: false, hours: null, busy: [], ...over });

function ask(over: {
  ymd?: string;
  tz?: string;
  today?: string;
  now?: string; // wall clock on `today`
  rules?: Partial<OpenTimeRules>;
  closed?: boolean;
  minutes?: number;
  crew?: number;
  shares?: boolean;
  cleaners?: EngineCleaner[];
  held?: Held[];
} = {}) {
  const tz = over.tz ?? REGINA;
  const ymd = over.ymd ?? DAY;
  const today = over.today ?? "2027-03-01";
  const w = world(tz, ymd);
  return openTimesForDay({
    ymd,
    todayYmd: today,
    nowMs: zonedWallClockUtc(today, over.now ?? "08:00", tz).getTime(),
    at: w.at,
    clock: w.clock,
    rules: { ...nineToFive, ...over.rules },
    closed: over.closed,
    durationMinutes: over.minutes ?? 120,
    crewSize: over.crew ?? 1,
    sharesHours: over.shares ?? true,
    cleaners: over.cleaners ?? [free("anna")],
    held: over.held,
  });
}
const starts = (r: ReturnType<typeof ask>) => r.times.map((t) => t.hhmm);
const busyOn = (ymd: string, from: string, to: string, tz = REGINA) => ({
  startMs: zonedWallClockUtc(ymd, from, tz).getTime(),
  endMs: zonedWallClockUtc(ymd, to, tz).getTime(),
});

describe("the company's opening hours", () => {
  it("offers every start that lets the whole visit finish before closing", () => {
    // Two hours, nine to five, on the hour: the last start is three.
    expect(starts(ask())).toEqual(["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"]);
    // A visit as long as the day fits exactly once.
    expect(starts(ask({ minutes: 480 }))).toEqual(["09:00"]);
    // One minute longer than the day fits nowhere: there is no time to offer.
    expect(ask({ minutes: 481 })).toEqual({ times: [], reason: "closed" });
  });

  it("the step sets how far apart the starts are", () => {
    expect(starts(ask({ rules: { stepMinutes: 30 }, minutes: 420 }))).toEqual(["09:00", "09:30", "10:00"]);
    expect(starts(ask({ rules: { stepMinutes: 15 }, minutes: 465 }))).toEqual(["09:00", "09:15"]);
  });

  it("a closed weekday, a day closed by hand, and a day with no hours all say closed", () => {
    expect(ask({ ymd: "2027-03-06" })).toEqual({ times: [], reason: "closed" }); // Saturday
    expect(ask({ closed: true })).toEqual({ times: [], reason: "closed" });
    expect(ask({ rules: { openingHours: {} } })).toEqual({ times: [], reason: "closed" });
    expect(ask({ rules: { openingHours: { 5: [{ start: "17:00", end: "09:00" }] } } }).reason).toBe("closed");
    expect(ask({ rules: { openingHours: { 5: [{ start: "nine", end: "five" }] } } }).reason).toBe("closed");
  });

  it("a split day: the visit must fit inside one part, and parts that touch are one", () => {
    const lunch = { 5: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }] };
    expect(starts(ask({ rules: { openingHours: lunch } }))).toEqual(["09:00", "10:00", "13:00", "14:00", "15:00"]);
    const touching = { 5: [{ start: "09:00", end: "12:00" }, { start: "12:00", end: "17:00" }] };
    expect(starts(ask({ rules: { openingHours: touching } }))).toEqual(starts(ask()));
    // Overlapping parts don't offer the same time twice.
    const overlap = { 5: [{ start: "09:00", end: "13:00" }, { start: "11:00", end: "17:00" }] };
    expect(starts(ask({ rules: { openingHours: overlap } }))).toEqual(starts(ask()));
  });
});

describe("how far ahead", () => {
  it("notice: nothing sooner than the hours asked for, to the minute", () => {
    // Friday 08:00 with four hours' notice: the first start is noon.
    expect(starts(ask({ today: DAY, now: "08:00", rules: { minNoticeHours: 4 } }))).toEqual(["12:00", "13:00", "14:00", "15:00"]);
    expect(starts(ask({ today: DAY, now: "08:01", rules: { minNoticeHours: 4 } }))[0]).toBe("13:00");
    // Notice longer than what is left of the day.
    expect(ask({ today: DAY, now: "08:00", rules: { minNoticeHours: 24 } })).toEqual({ times: [], reason: "too_soon" });
    // Later in the day, with no notice asked: what is left.
    expect(starts(ask({ today: DAY, now: "13:30" }))).toEqual(["14:00", "15:00"]);
  });

  it("the furthest day is counted in calendar days; before today is past", () => {
    expect(ask({ today: "2027-03-01", rules: { maxDaysAhead: 4 } }).reason).toBeNull();
    expect(ask({ today: "2027-03-01", rules: { maxDaysAhead: 3 } })).toEqual({ times: [], reason: "too_far" });
    expect(ask({ today: "2027-03-06" })).toEqual({ times: [], reason: "past" });
    // Today only.
    expect(starts(ask({ today: DAY, now: "08:00", rules: { maxDaysAhead: 0 } }))).toHaveLength(7);
  });
});

describe("the cleaners", () => {
  it("nobody taking online bookings, a service with no length", () => {
    expect(ask({ cleaners: [] })).toEqual({ times: [], reason: "no_cleaners" });
    expect(ask({ minutes: 0 })).toEqual({ times: [], reason: "no_length" });
  });

  it("someone off that day is out; if she was the only one, the day is full", () => {
    expect(ask({ cleaners: [free("anna", { off: true })] })).toEqual({ times: [], reason: "full" });
    const two = ask({ cleaners: [free("anna", { off: true }), free("bea")] });
    expect(two.times.every((t) => t.cleaners.join() === "bea")).toBe(true);
    expect(two.times).toHaveLength(7);
  });

  it("her own hours: the visit must sit inside them; no hours on file means any time; an empty day means not that day", () => {
    const mornings = free("anna", { hours: [{ start: "09:00", end: "12:00" }] });
    expect(starts(ask({ cleaners: [mornings] }))).toEqual(["09:00", "10:00"]);
    expect(starts(ask({ cleaners: [free("anna", { hours: null })] }))).toHaveLength(7);
    expect(ask({ cleaners: [free("anna", { hours: [] })] })).toEqual({ times: [], reason: "full" });
    // Her hours reach past opening hours: opening hours still bound the day.
    expect(starts(ask({ cleaners: [free("anna", { hours: [{ start: "06:00", end: "22:00" }] })] }))).toHaveLength(7);
    // A split shift she works across is one stretch only if the parts touch.
    const split = free("anna", { hours: [{ start: "09:00", end: "11:00" }, { start: "11:00", end: "13:00" }] });
    expect(starts(ask({ cleaners: [split] }))).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("another job: back to back is fine with no gap; a gap keeps time clear on both sides", () => {
    const job = busyOn(DAY, "11:00", "13:00");
    // Free 9 to 11 and 1 to 5, to the minute.
    expect(starts(ask({ cleaners: [free("anna", { busy: [job] })] }))).toEqual(["09:00", "13:00", "14:00", "15:00"]);
    // Thirty minutes each side: 9 to 11 now ends too close; 1:00 starts too close.
    expect(starts(ask({ rules: { gapMinutes: 30 }, cleaners: [free("anna", { busy: [job] })] }))).toEqual(["14:00", "15:00"]);
    expect(starts(ask({ rules: { gapMinutes: 30, stepMinutes: 30 }, cleaners: [free("anna", { busy: [job] })] }))).toEqual([
      "13:30",
      "14:00",
      "14:30",
      "15:00",
    ]);
    // A job that ended yesterday evening, or starts tomorrow, is no clash.
    const others = [busyOn("2027-03-04", "15:00", "23:00"), busyOn("2027-03-06", "00:30", "04:00")];
    expect(starts(ask({ cleaners: [free("anna", { busy: others })] }))).toHaveLength(7);
    // One that runs over midnight into the morning is.
    const overnight = { startMs: busyOn("2027-03-04", "22:00", "23:00").startMs, endMs: busyOn(DAY, "09:30", "10:00").endMs };
    expect(starts(ask({ cleaners: [free("anna", { busy: [overnight] })] }))[0]).toBe("10:00");
  });

  it("a time is open if anyone is free, and says who", () => {
    const anna = free("anna", { busy: [busyOn(DAY, "09:00", "13:00")] });
    const bea = free("bea", { busy: [busyOn(DAY, "13:00", "17:00")] });
    const r = ask({ cleaners: [anna, bea] });
    expect(starts(r)).toEqual(["09:00", "10:00", "11:00", "13:00", "14:00", "15:00"]);
    expect(r.times.find((t) => t.hhmm === "09:00")?.cleaners).toEqual(["bea"]);
    expect(r.times.find((t) => t.hhmm === "15:00")?.cleaners).toEqual(["anna"]);
    // Noon needs 12 to 2: Anna is busy until 1, Bea from 1.
    expect(starts(r)).not.toContain("12:00");
  });
});

describe("a crew of more than one", () => {
  it("shared hours: each is there for the length divided by the crew, and enough of them must be free together", () => {
    expect(onSiteMinutes(240, 2, true)).toBe(120);
    expect(onSiteMinutes(240, 2, false)).toBe(240);
    expect(onSiteMinutes(240, 1, true)).toBe(240);
    expect(onSiteMinutes(100, 3, true)).toBe(33);
    expect(onSiteMinutes(0, 2, true)).toBe(0);

    // Four hours for one person is two hours for two: the last start is 3.
    const two = [free("anna"), free("bea")];
    expect(starts(ask({ minutes: 240, crew: 2, cleaners: two }))).toEqual(["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"]);
    // Not shared: each works all four, so the last start is 1.
    expect(starts(ask({ minutes: 240, crew: 2, shares: false, cleaners: two })).at(-1)).toBe("13:00");
    // One of the two is busy in the morning: only the afternoon has both.
    const busyBea = [free("anna"), free("bea", { busy: [busyOn(DAY, "09:00", "12:00")] })];
    expect(starts(ask({ minutes: 240, crew: 2, cleaners: busyBea }))).toEqual(["12:00", "13:00", "14:00", "15:00"]);
    // Needs two, has one.
    expect(ask({ minutes: 240, crew: 2, cleaners: [free("anna")] })).toEqual({ times: [], reason: "full" });
    // Three on file, two needed: any two will do.
    const three = [free("anna", { off: true }), free("bea"), free("cara")];
    expect(ask({ minutes: 240, crew: 2, cleaners: three }).times[0].cleaners).toEqual(["bea", "cara"]);
  });
});

describe("visits booked online that nobody is on yet", () => {
  const held = (from: string, to: string, need = 1): Held => ({ ...busyOn(DAY, from, to), need });

  it("each holds a person for its window: with two free, one held visit leaves room for one more", () => {
    const two = [free("anna"), free("bea")];
    expect(starts(ask({ cleaners: two, held: [held("10:00", "12:00")] }))).toContain("10:00");
    expect(starts(ask({ cleaners: two, held: [held("10:00", "12:00"), held("10:00", "12:00")] }))).not.toContain("10:00");
    // Overlapping only part of it still holds the person.
    expect(starts(ask({ cleaners: two, held: [held("09:00", "11:00"), held("11:00", "13:00")] }))).toContain("10:00");
    expect(starts(ask({ cleaners: two, held: [held("09:00", "11:00"), held("10:30", "11:30")] }))).not.toContain("10:00");
  });

  it("the gap counts: a held visit ending at ten keeps a lone cleaner off ten when the gap is half an hour", () => {
    expect(starts(ask({ held: [held("08:00", "10:00")] }))).toContain("10:00");
    expect(starts(ask({ held: [held("08:00", "10:00")], rules: { gapMinutes: 30 } }))).not.toContain("10:00");
  });

  it("a held job for two holds two people", () => {
    const three = [free("anna"), free("bea"), free("cy")];
    expect(starts(ask({ cleaners: three, held: [held("10:00", "11:00", 2)] }))).toContain("10:00");
    expect(starts(ask({ cleaners: three, crew: 2, held: [held("10:00", "11:00", 2)] }))).not.toContain("10:00");
  });

  it("nothing held: every free start, as before; all held: the day says full", () => {
    expect(starts(ask({ held: [] }))).toEqual(starts(ask({})));
    const allDay = ask({ held: [held("09:00", "17:00")] });
    expect(allDay).toEqual({ times: [], reason: "full" });
  });
});

describe("the company's clock", () => {
  it("times are the company's wall clock whatever the day's offset", () => {
    // Regina: 9:00 is 15:00 UTC all year.
    expect(new Date(ask().times[0].startMs).toISOString()).toBe("2027-03-05T15:00:00.000Z");
    // Toronto in winter: 9:00 is 14:00 UTC.
    expect(new Date(ask({ tz: TORONTO }).times[0].startMs).toISOString()).toBe("2027-03-05T14:00:00.000Z");
    // Toronto in summer: 9:00 is 13:00 UTC.
    const july = ask({ tz: TORONTO, ymd: "2027-07-02", today: "2027-06-28" });
    expect(new Date(july.times[0].startMs).toISOString()).toBe("2027-07-02T13:00:00.000Z");
    expect(starts(july)).toEqual(starts(ask()));
  });

  it("the night the clocks go forward: the hour that doesn't happen isn't offered", () => {
    // Toronto, Sunday 14 March 2027: 2:00 AM becomes 3:00 AM.
    const night = { 0: [{ start: "00:00", end: "05:00" }] };
    const r = ask({ tz: TORONTO, ymd: "2027-03-14", today: "2027-03-10", minutes: 30, rules: { openingHours: night, stepMinutes: 30 } });
    expect(starts(r)).toEqual(["00:00", "00:30", "01:00", "01:30", "03:00", "03:30", "04:00", "04:30"]);
    // Real half hours apart, every one.
    for (let i = 1; i < r.times.length; i++) expect(r.times[i].startMs - r.times[i - 1].startMs).toBe(30 * 60_000);
  });

  it("the night the clocks go back: the hour that happens twice is offered twice, as two different moments", () => {
    // Toronto, Sunday 7 November 2027: 2:00 AM becomes 1:00 AM.
    const night = { 0: [{ start: "00:00", end: "03:00" }] };
    const r = ask({ tz: TORONTO, ymd: "2027-11-07", today: "2027-11-03", minutes: 30, rules: { openingHours: night, stepMinutes: 30 } });
    expect(starts(r)).toEqual(["00:00", "00:30", "01:00", "01:30", "01:00", "01:30", "02:00", "02:30"]);
    expect(new Set(r.times.map((t) => t.startMs)).size).toBe(8);
  });

  it("an ordinary day is unaffected by a clock change the week before or after", () => {
    expect(starts(ask({ tz: TORONTO, ymd: "2027-03-15", today: "2027-03-10" }))).toEqual(starts(ask()));
    expect(starts(ask({ tz: TORONTO, ymd: "2027-03-12", today: "2027-03-10" }))).toEqual(starts(ask()));
  });
});

describe("why a day is empty", () => {
  it("has a sentence for every reason", () => {
    for (const reason of ["no_length", "past", "too_far", "closed", "no_cleaners", "too_soon", "full"] as const) {
      expect(noTimesSentence(reason).length).toBeGreaterThan(5);
    }
  });
});

import { describe, expect, it } from "vitest";
import { outsideHoursReason, pickReason } from "./crew-availability";

const monToFri = Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, [{ start: "09:00", end: "17:00" }]]));
const at = (h: number, m = 0) => h * 60 + m;

describe("outsideHoursReason", () => {
  it("holds nothing against someone who never filled in their hours", () => {
    expect(outsideHoursReason({ dayOfWeek: 6, startMinutes: at(3), durationMinutes: 120, weekly: {}, custom: null })).toBeNull();
    expect(outsideHoursReason({ dayOfWeek: 6, startMinutes: at(3), durationMinutes: 120, weekly: { 1: [] }, custom: null })).toBeNull();
  });

  it("a visit inside their hours fits, to the minute at both ends", () => {
    const fits = (start: number, minutes: number) =>
      outsideHoursReason({ dayOfWeek: 2, startMinutes: start, durationMinutes: minutes, weekly: monToFri, custom: null });
    expect(fits(at(9), 480)).toBeNull();
    expect(fits(at(15), 120)).toBeNull();
    expect(fits(at(8, 59), 60)).toBe("Works 9:00 AM to 5:00 PM on Tuesdays");
    expect(fits(at(15, 1), 120)).toBe("Works 9:00 AM to 5:00 PM on Tuesdays");
  });

  it("a day they don't work says so", () => {
    expect(outsideHoursReason({ dayOfWeek: 6, startMinutes: at(10), durationMinutes: 60, weekly: monToFri, custom: null })).toBe(
      "Doesn't work Saturdays",
    );
  });

  it("hours given for that date replace the weekly ones, both ways", () => {
    const custom = [{ start: "12:00", end: "16:00" }];
    // A Saturday they don't normally work, opened up for that date.
    expect(outsideHoursReason({ dayOfWeek: 6, startMinutes: at(13), durationMinutes: 60, weekly: monToFri, custom })).toBeNull();
    // A Tuesday morning they normally work, closed for that date.
    expect(outsideHoursReason({ dayOfWeek: 2, startMinutes: at(9), durationMinutes: 60, weekly: monToFri, custom })).toBe(
      "Works 12:00 PM to 4:00 PM that day",
    );
  });

  it("a split shift: fits in either part, or across parts that touch, not across a gap", () => {
    const gap = { 3: [{ start: "08:00", end: "12:00" }, { start: "14:00", end: "18:00" }] };
    const touching = { 3: [{ start: "08:00", end: "12:00" }, { start: "12:00", end: "16:00" }] };
    const ask = (weekly: typeof gap, start: number, minutes: number) =>
      outsideHoursReason({ dayOfWeek: 3, startMinutes: start, durationMinutes: minutes, weekly, custom: null });
    expect(ask(gap, at(14), 240)).toBeNull();
    expect(ask(gap, at(11), 120)).toBe("Works 8:00 AM to 12:00 PM and 2:00 PM to 6:00 PM on Wednesdays");
    expect(ask(touching, at(11), 120)).toBeNull();
  });

  it("no length yet is judged on the start time; past midnight on the first day's part", () => {
    expect(outsideHoursReason({ dayOfWeek: 2, startMinutes: at(16, 59), durationMinutes: 0, weekly: monToFri, custom: null })).toBeNull();
    expect(outsideHoursReason({ dayOfWeek: 2, startMinutes: at(17), durationMinutes: 0, weekly: monToFri, custom: null })).not.toBeNull();
    const late = { 5: [{ start: "18:00", end: "24:00" }] };
    // "24:00" is not a time of day the column allows; 23:59 is the latest.
    expect(outsideHoursReason({ dayOfWeek: 5, startMinutes: at(22), durationMinutes: 300, weekly: late, custom: null })).toBeNull();
    const night = { 5: [{ start: "18:00", end: "23:59" }] };
    expect(outsideHoursReason({ dayOfWeek: 5, startMinutes: at(22), durationMinutes: 60, weekly: night, custom: null })).toBeNull();
  });
});

describe("pickReason", () => {
  it("time off first, then another job, then hours; null when free", () => {
    expect(pickReason({ off: true, busy: "On another job", hours: "x" })).toEqual({ kind: "off", reason: "Off that day" });
    expect(pickReason({ off: false, busy: "On another job", hours: "x" })).toEqual({ kind: "busy", reason: "On another job" });
    expect(pickReason({ off: false, busy: null, hours: "x" })).toEqual({ kind: "hours", reason: "x" });
    expect(pickReason({ off: false, busy: null, hours: null })).toBeNull();
  });

  it("finished by the visit's date beats everything: the save would be refused", () => {
    expect(pickReason({ finished: "2026-12-18", off: true, busy: "On another job", hours: "x" })).toEqual({
      kind: "off",
      reason: "Last working day was Dec 18",
    });
    expect(pickReason({ finished: null, off: false, busy: null, hours: null })).toBeNull();
  });
});

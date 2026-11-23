/**
 * The booking rules a company sets (roadmap phase 2): reading what is
 * stored, and checking what someone typed. The rule that matters most: a
 * value that can't be read never opens a day.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, SUGGESTED_HOURS, parseRulesForm, readOpeningHours, readRules } from "./open-time-rules";

const posted = (fields: Record<string, string>) => (name: string) => fields[name] ?? "";
const good = {
  open_1: "on",
  start_1: "09:00",
  end_1: "17:00",
  open_6: "on",
  start_6: "10:00:00",
  end_6: "14:00:00",
  min_notice_hours: "24",
  max_days_ahead: "60",
  gap_minutes: "30",
  slot_step_minutes: "30",
};

describe("reading stored hours", () => {
  it("keeps good days and drops anything unreadable, which leaves that day closed", () => {
    expect(
      readOpeningHours({
        1: [{ start: "09:00", end: "17:00" }],
        2: [{ start: "17:00", end: "09:00" }], // backwards
        3: [{ start: "9am", end: "5pm" }],
        4: "all day",
        7: [{ start: "09:00", end: "17:00" }], // not a weekday
        5: [{ start: "09:00", end: "12:00" }, { start: "13:00" }, null],
      }),
    ).toEqual({ 1: [{ start: "09:00", end: "17:00" }], 5: [{ start: "09:00", end: "12:00" }] });
    for (const junk of [null, undefined, "open", 5, [], [[1]]]) expect(readOpeningHours(junk)).toEqual({});
  });

  it("a page with nothing saved is closed every day, with the usual numbers", () => {
    expect(readRules(null)).toEqual(DEFAULT_RULES);
    expect(readRules({})).toEqual(DEFAULT_RULES);
    expect(DEFAULT_RULES.openingHours).toEqual({});
    // The suggestion is only ever a starting point in the form.
    expect(Object.keys(SUGGESTED_HOURS).map(Number).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("numbers out of range are pulled back in, and a step that isn't offered falls back", () => {
    expect(readRules({ min_notice_hours: -5, max_days_ahead: 9999, gap_minutes: "45", slot_step_minutes: 20 })).toMatchObject({
      minNoticeHours: 0,
      maxDaysAhead: 365,
      gapMinutes: 45,
      stepMinutes: 30,
    });
    expect(readRules({ slot_step_minutes: 15 }).stepMinutes).toBe(15);
    expect(readRules({ min_notice_hours: "soon" }).minNoticeHours).toBe(24);
  });
});

describe("what the form posted", () => {
  it("ticked days become hours; unticked days are closed whatever times came with them", () => {
    const parsed = parseRulesForm(posted({ ...good, start_2: "09:00", end_2: "17:00" }));
    expect(parsed).toEqual({
      ok: true,
      rules: {
        openingHours: { 1: [{ start: "09:00", end: "17:00" }], 6: [{ start: "10:00", end: "14:00" }] },
        minNoticeHours: 24,
        maxDaysAhead: 60,
        gapMinutes: 30,
        stepMinutes: 30,
      },
    });
  });

  it("every day unticked is allowed: closed all week", () => {
    const parsed = parseRulesForm(posted({ min_notice_hours: "0", max_days_ahead: "0", gap_minutes: "0", slot_step_minutes: "60" }));
    expect(parsed).toMatchObject({ ok: true, rules: { openingHours: {}, stepMinutes: 60 } });
  });

  it("says which day or number is wrong, in words", () => {
    const bad = (over: Record<string, string>) => {
      const r = parseRulesForm(posted({ ...good, ...over }));
      return r.ok ? null : r.error;
    };
    expect(bad({ end_1: "08:00" })).toBe("Monday: closing has to be after opening.");
    expect(bad({ end_1: "09:00" })).toBe("Monday: closing has to be after opening.");
    expect(bad({ start_6: "" })).toBe("Saturday: set an opening and a closing time, or untick the day.");
    expect(bad({ start_1: "25:00" })).toMatch(/^Monday: set an opening/);
    expect(bad({ min_notice_hours: "a day" })).toBe("Notice: type a whole number.");
    expect(bad({ min_notice_hours: "-1" })).toBe("Notice: type a whole number.");
    expect(bad({ max_days_ahead: "400" })).toBe("How far ahead: between 0 and 365.");
    expect(bad({ gap_minutes: "1.5" })).toBe("Gap between jobs: type a whole number.");
    expect(bad({ slot_step_minutes: "20" })).toBe("Choose how far apart the start times are.");
  });
});

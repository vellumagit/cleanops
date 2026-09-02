import { describe, it, expect } from "vitest";
import {
  computeSendSlot,
  describeSendSchedule,
  MIN_REVIEW_MINUTES,
} from "./invoice-send-schedule";
import { zonedYmd } from "./wall-clock";

const EDM = "America/Edmonton"; // MDT (UTC-6) summer / MST (UTC-7) winter

/** The org-local wall clock at an instant, for readable assertions. */
function local(d: Date, tz = EDM): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

describe("computeSendSlot — next_day (the untouched default)", () => {
  it("sends at the configured hour the following day", () => {
    // Tue 2026-09-01, 9 AM MDT.
    const from = new Date("2026-09-01T15:00:00Z");
    const slot = computeSendSlot(from, EDM, { mode: "next_day", hour: 17 });
    expect(zonedYmd(slot, EDM)).toBe("2026-09-02");
    expect(local(slot)).toContain("17:00");
  });

  it("a late-night draft and a morning one share the same slot", () => {
    // Both are Tue Sep 1 in EDMONTON — 05:58Z is 23:58 the previous local day.
    const lateNight = new Date("2026-09-02T05:58:00Z"); // Tue 11:58 PM MDT
    const morning = new Date("2026-09-01T12:00:00Z"); // Tue 6 AM MDT
    expect(
      computeSendSlot(lateNight, EDM, { mode: "next_day", hour: 17 }).getTime(),
    ).toBe(
      computeSendSlot(morning, EDM, { mode: "next_day", hour: 17 }).getTime(),
    );
  });
});

describe("computeSendSlot — weekday ('every Friday')", () => {
  const friday = { mode: "weekday" as const, hour: 17, weekday: 5 };

  it("a Monday draft waits for Friday", () => {
    const from = new Date("2026-08-31T15:00:00Z"); // Mon 9 AM MDT
    const slot = computeSendSlot(from, EDM, friday);
    expect(zonedYmd(slot, EDM)).toBe("2026-09-04"); // that Friday
    expect(local(slot)).toContain("17:00");
  });

  it("a Friday-morning draft goes out the SAME day", () => {
    // The point of the setting: the week's work leaves on Friday.
    const from = new Date("2026-09-04T15:00:00Z"); // Fri 9 AM MDT
    expect(zonedYmd(computeSendSlot(from, EDM, friday), EDM)).toBe(
      "2026-09-04",
    );
  });

  it("but a draft raised minutes before the slot waits a week", () => {
    // 4:59 PM on send day: a one-minute review window is not a review.
    const from = new Date("2026-09-04T22:59:00Z"); // Fri 4:59 PM MDT
    expect(zonedYmd(computeSendSlot(from, EDM, friday), EDM)).toBe(
      "2026-09-11",
    );
  });

  it("a draft just over the review floor still makes the same day", () => {
    const from = new Date(
      new Date("2026-09-04T23:00:00Z").getTime() -
        (MIN_REVIEW_MINUTES + 5) * 60_000,
    );
    expect(zonedYmd(computeSendSlot(from, EDM, friday), EDM)).toBe(
      "2026-09-04",
    );
  });

  it("honours the org's Friday, not the server's", () => {
    // Fri 00:30 UTC = Thu 6:30 PM in Edmonton. The org's Friday has not
    // started, so the slot is Edmonton's Friday — the next day, not today.
    const from = new Date("2026-09-04T00:30:00Z");
    expect(zonedYmd(computeSendSlot(from, EDM, friday), EDM)).toBe(
      "2026-09-04",
    );
  });

  it("survives the fall-back DST weekend at the same wall-clock hour", () => {
    // Nov 1 2026 Edmonton falls back to MST. A draft on Oct 30 sends the
    // following Friday, Nov 6, still at 5 PM local (now UTC-7).
    const from = new Date("2026-10-30T23:00:00Z"); // Fri 5 PM MDT — too late
    const slot = computeSendSlot(from, EDM, friday);
    expect(zonedYmd(slot, EDM)).toBe("2026-11-06");
    expect(local(slot)).toContain("17:00");
    expect(slot.toISOString()).toBe("2026-11-07T00:00:00.000Z"); // UTC-7
  });

  it("works for every weekday", () => {
    const from = new Date("2026-09-01T15:00:00Z"); // Tue
    for (let wd = 0; wd < 7; wd++) {
      const slot = computeSendSlot(from, EDM, {
        mode: "weekday",
        hour: 9,
        weekday: wd,
      });
      expect(local(slot).startsWith(
        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][wd],
      )).toBe(true);
      expect(slot.getTime()).toBeGreaterThan(from.getTime());
    }
  });
});

describe("computeSendSlot — delay_hours", () => {
  it("24 hours lands on the next day's send hour", () => {
    const from = new Date("2026-09-01T15:00:00Z"); // Tue 9 AM MDT
    const slot = computeSendSlot(from, EDM, {
      mode: "delay_hours",
      hour: 17,
      delayHours: 24,
    });
    expect(zonedYmd(slot, EDM)).toBe("2026-09-02");
    expect(local(slot)).toContain("17:00");
  });

  it("48 hours clears two full days before the send hour", () => {
    const from = new Date("2026-09-01T15:00:00Z"); // Tue 9 AM MDT
    const slot = computeSendSlot(from, EDM, {
      mode: "delay_hours",
      hour: 17,
      delayHours: 48,
    });
    expect(zonedYmd(slot, EDM)).toBe("2026-09-03");
    expect(slot.getTime() - from.getTime()).toBeGreaterThanOrEqual(
      48 * 3_600_000,
    );
  });

  it("never returns a slot earlier than the requested window", () => {
    for (const delayHours of [24, 48, 72]) {
      for (const startHour of [1, 9, 16, 18, 23]) {
        const from = new Date(
          Date.UTC(2026, 8, 1, startHour, 30, 0),
        );
        const slot = computeSendSlot(from, EDM, {
          mode: "delay_hours",
          hour: 17,
          delayHours,
        });
        expect(slot.getTime() - from.getTime()).toBeGreaterThanOrEqual(
          delayHours * 3_600_000,
        );
      }
    }
  });
});

describe("computeSendSlot — bad settings fall back, never misfire", () => {
  const from = new Date("2026-09-01T15:00:00Z");
  const expected = computeSendSlot(from, EDM, {
    mode: "next_day",
    hour: 17,
  }).getTime();

  it("an unknown mode behaves as next_day", () => {
    expect(
      computeSendSlot(from, EDM, {
        mode: "sideways" as never,
        hour: 17,
      }).getTime(),
    ).toBe(expected);
  });

  it("a nonsense hour falls back to 5 PM", () => {
    expect(computeSendSlot(from, EDM, { mode: "next_day", hour: 99 }).getTime())
      .toBe(expected);
  });

  it("a null weekday still produces a real future slot", () => {
    const slot = computeSendSlot(from, EDM, {
      mode: "weekday",
      hour: 17,
      weekday: null,
    });
    expect(slot.getTime()).toBeGreaterThan(from.getTime());
  });

  it("never returns a slot in the past, whatever it is handed", () => {
    for (const mode of ["next_day", "delay_hours", "weekday"] as const) {
      const slot = computeSendSlot(from, EDM, {
        mode,
        hour: -3,
        delayHours: 0,
        weekday: 99,
      });
      expect(slot.getTime()).toBeGreaterThan(from.getTime());
    }
  });
});

describe("describeSendSchedule", () => {
  it("says it the way an owner would", () => {
    expect(
      describeSendSchedule({ mode: "weekday", hour: 17, weekday: 5 }),
    ).toBe("every Friday at 5:00 PM");
    expect(
      describeSendSchedule({ mode: "delay_hours", hour: 9, delayHours: 48 }),
    ).toBe("48 hours after drafting, at 9:00 AM");
    expect(describeSendSchedule({ mode: "next_day", hour: 17 })).toBe(
      "the day after drafting, at 5:00 PM",
    );
  });
});

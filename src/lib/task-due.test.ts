import { describe, expect, it } from "vitest";
import { describeDue, describeReminder } from "./task-due";

// Regina is UTC-6 all year, on every copy of the time zone rules, so these
// read the same on a machine whose Alberta rules are out of date.
const TZ = "America/Regina";
// 10:00 AM on Wed 18 Nov 2026 in Regina.
const NOW = new Date("2026-11-18T16:00:00Z");

describe("describeDue", () => {
  it("shows the time on the company's clock, whatever the device's zone", () => {
    // 7:24 AM tomorrow in Regina.
    expect(describeDue("2026-11-19T13:24:00Z", TZ, NOW)).toEqual({
      label: "Tomorrow · 7:24 AM",
      urgent: false,
      bucket: "upcoming",
    });
  });

  it("due earlier today is still today's, not overdue", () => {
    expect(describeDue("2026-11-18T15:00:00Z", TZ, NOW)).toEqual({
      label: "Today · 9:00 AM",
      urgent: false,
      bucket: "today",
    });
  });

  it("the company's day decides: 11 PM tonight there is today, though it is tomorrow in UTC", () => {
    expect(describeDue("2026-11-19T05:00:00Z", TZ, NOW)?.bucket).toBe("today");
  });

  it("yesterday is overdue and red", () => {
    expect(describeDue("2026-11-17T23:00:00Z", TZ, NOW)).toEqual({
      label: "Overdue · Nov 17",
      urgent: true,
      bucket: "overdue",
    });
  });

  it("further out carries the date and year", () => {
    expect(describeDue("2026-12-01T15:00:00Z", TZ, NOW)?.label).toBe("Dec 1, 2026 · 9:00 AM");
  });

  it("an unreadable date gives nothing rather than Invalid Date", () => {
    expect(describeDue("not a date", TZ, NOW)).toBeNull();
  });
});

describe("describeReminder", () => {
  it("reads on the company's clock", () => {
    expect(describeReminder("2026-11-20T14:30:00Z", TZ)).toBe("Nov 20, 8:30 AM");
  });
});

import { describe, it, expect } from "vitest";
import { bookingLineLabel } from "./invoice-line-label";

const EDM = "America/Edmonton";

describe("bookingLineLabel", () => {
  it("carries service, date, time range and address", () => {
    expect(
      bookingLineLabel({
        serviceLabel: "Standard clean",
        scheduledAt: "2026-07-30T15:00:00Z", // 9:00 AM MDT
        durationMinutes: 360,
        address: "4033 32 St NW",
        tz: EDM,
      }),
    ).toBe(
      "Standard clean · Thu, Jul 30, 2026, 9:00 AM–3:00 PM · 4033 32 St NW",
    );
  });

  it("formats in the ORG timezone, not UTC", () => {
    // 6:00 PM in Edmonton is already the NEXT day in UTC. The billing-cycle
    // cron used to hardcode UTC and print Jul 31 for this job.
    const label = bookingLineLabel({
      serviceLabel: "Deep clean",
      scheduledAt: "2026-07-31T00:00:00Z",
      durationMinutes: 120,
      address: null,
      tz: EDM,
    });
    expect(label).toContain("Thu, Jul 30, 2026");
    expect(label).not.toContain("Jul 31");
  });

  it("derives the end time across a DST transition", () => {
    // 2026-11-01: Edmonton falls back at 02:00. A shift starting 01:00 MDT
    // and running 3h ends at 03:00 MST — adding 3 to the wall clock would
    // wrongly say 04:00.
    expect(
      bookingLineLabel({
        serviceLabel: "Overnight",
        scheduledAt: "2026-11-01T07:00:00Z",
        durationMinutes: 180,
        address: null,
        tz: EDM,
      }),
    ).toContain("1:00 AM–3:00 AM");
  });

  it("omits the location rather than printing a placeholder", () => {
    const label = bookingLineLabel({
      serviceLabel: "Standard clean",
      scheduledAt: "2026-07-30T15:00:00Z",
      durationMinutes: 60,
      address: "   ",
      tz: EDM,
    });
    expect(label).not.toContain("on site");
    expect(label).toBe("Standard clean · Thu, Jul 30, 2026, 9:00 AM–10:00 AM");
  });

  it("shows a start time only when there is no duration", () => {
    expect(
      bookingLineLabel({
        serviceLabel: "Standard clean",
        scheduledAt: "2026-07-30T15:00:00Z",
        durationMinutes: null,
        address: null,
        tz: EDM,
      }),
    ).toBe("Standard clean · Thu, Jul 30, 2026, 9:00 AM");
  });

  it("degrades to the service alone rather than printing junk", () => {
    expect(
      bookingLineLabel({
        serviceLabel: "Standard clean",
        scheduledAt: null,
        durationMinutes: 120,
        address: null,
        tz: EDM,
      }),
    ).toBe("Standard clean");
    expect(
      bookingLineLabel({
        serviceLabel: "",
        scheduledAt: "not-a-date",
        durationMinutes: null,
        address: null,
        tz: EDM,
      }),
    ).toBe("Service");
  });
});

import { describe, it, expect } from "vitest";
import { bookingLineLabel } from "./invoice-line-label";

const EDM = "America/Edmonton";

describe("bookingLineLabel", () => {
  it("carries service, date and address, and no time of day", () => {
    expect(
      bookingLineLabel({
        serviceLabel: "Standard clean",
        scheduledAt: "2026-07-30T15:00:00Z", // 9:00 AM MDT
        durationMinutes: 360,
        address: "4033 32 St NW",
        tz: EDM,
      }),
    ).toBe(
      "Standard clean · Thu, Jul 30, 2026 · 4033 32 St NW",
    );
  });

  // Svitlana, 2026-11-21: the booked length is one person's hours, so a
  // ten-hour job three people did in an afternoon read "9:30 AM–7:30 PM".
  it("never prints the booked hours, however long the job or whoever did it", () => {
    for (const durationMinutes of [null, 0, 120, 600, 2880]) {
      const label = bookingLineLabel({
        serviceLabel: "Deep clean/Initial clean",
        scheduledAt: "2026-11-05T16:30:00Z",
        durationMinutes,
        address: "12603 12 Ave",
        tz: EDM,
      });
      expect(label).toBe("Deep clean/Initial clean · Thu, Nov 5, 2026 · 12603 12 Ave");
      expect(label).not.toMatch(/d:dd|AM|PM/);
    }
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

  it("a job that starts after midnight is on the day it starts", () => {
    expect(
      bookingLineLabel({
        serviceLabel: "Overnight",
        scheduledAt: "2026-11-01T07:00:00Z", // 1:00 AM in Edmonton
        durationMinutes: 180,
        address: null,
        tz: EDM,
      }),
    ).toBe("Overnight · Sun, Nov 1, 2026");
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
    expect(label).toBe("Standard clean · Thu, Jul 30, 2026");
  });

  it("falls back to the client's address when the booking has none", () => {
    // A booking created without a snapshotted address used to bill as
    // "on site" even though the client's profile held a full street address.
    expect(
      bookingLineLabel({
        serviceLabel: "Standard clean",
        scheduledAt: "2026-07-30T15:00:00Z",
        durationMinutes: 120,
        address: null,
        fallbackAddress: "4033 32 St NW, Edmonton, AB",
        tz: EDM,
      }),
    ).toBe(
      "Standard clean · Thu, Jul 30, 2026 · 4033 32 St NW, Edmonton, AB",
    );
  });

  it("prefers the booking's own address over the client's", () => {
    expect(
      bookingLineLabel({
        serviceLabel: "Standard clean",
        scheduledAt: "2026-07-30T15:00:00Z",
        durationMinutes: 60,
        address: "Unit 12, 500 Jasper Ave",
        fallbackAddress: "4033 32 St NW",
        tz: EDM,
      }),
    ).toContain("Unit 12, 500 Jasper Ave");
  });

  it("the date alone, with or without a duration", () => {
    expect(
      bookingLineLabel({
        serviceLabel: "Standard clean",
        scheduledAt: "2026-07-30T15:00:00Z",
        durationMinutes: null,
        address: null,
        tz: EDM,
      }),
    ).toBe("Standard clean · Thu, Jul 30, 2026");
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

describe("multi-property clients", () => {
  it("names the property before the address", () => {
    // An Airbnb host paying for four units cannot tell four identical
    // "Standard clean — Aug 3" lines apart, and an address alone makes them
    // remember which street is which unit.
    expect(
      bookingLineLabel({
        serviceLabel: "Turnover clean",
        scheduledAt: "2026-08-14T21:30:00Z",
        durationMinutes: 120,
        address: "155 Whyte Ave",
        propertyLabel: "Unit 3",
        tz: "America/Edmonton",
      }),
    ).toContain("Unit 3 · 155 Whyte Ave");
  });

  it("changes nothing for the clients that have one address", () => {
    const withoutProperty = bookingLineLabel({
      serviceLabel: "Standard clean",
      scheduledAt: "2026-08-14T21:30:00Z",
      durationMinutes: 120,
      address: "155 Whyte Ave",
      tz: "America/Edmonton",
    });
    expect(withoutProperty).not.toContain("·  ");
    expect(withoutProperty).toContain("155 Whyte Ave");
  });

  it("still renders the property when the job has no address", () => {
    expect(
      bookingLineLabel({
        serviceLabel: "Turnover clean",
        scheduledAt: null,
        durationMinutes: null,
        address: null,
        propertyLabel: "Unit 3",
        tz: "America/Edmonton",
      }),
    ).toBe("Turnover clean · Unit 3");
  });
});

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
      "Standard clean · Thu, Jul 30, 2026, 9:00 AM–11:00 AM · 4033 32 St NW, Edmonton, AB",
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

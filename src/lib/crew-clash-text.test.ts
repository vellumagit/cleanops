import { describe, expect, it } from "vitest";
import {
  alsoBookedSentence,
  clashKey,
  clashMessage,
  isDoubleBookingError,
  proposedWindows,
  type CrewClash,
  type ProposedVisit,
} from "./crew-clash-text";

const visit = (over: Partial<ProposedVisit> = {}): ProposedVisit => ({
  bookingId: "b1",
  scheduledAt: "2026-11-20T16:00:00.000Z",
  durationMinutes: 180,
  dividesHours: false,
  crew: [{ membershipId: "olha" }],
  ...over,
});

describe("proposedWindows", () => {
  it("one person takes the whole visit", () => {
    expect(proposedWindows([visit()]).get("olha")).toEqual([
      { start_at: "2026-11-20T16:00:00.000Z", end_at: "2026-11-20T19:00:00.000Z" },
    ]);
  });

  it("shared hours: three people on a 3-hour job are there an hour each", () => {
    const w = proposedWindows([
      visit({ dividesHours: true, crew: [{ membershipId: "a" }, { membershipId: "b" }, { membershipId: "c" }] }),
    ]);
    expect(w.get("a")).toEqual([{ start_at: "2026-11-20T16:00:00.000Z", end_at: "2026-11-20T17:00:00.000Z" }]);
    expect(w.get("c")).toEqual(w.get("a"));
  });

  it("without shared hours everyone is there for all of it", () => {
    const w = proposedWindows([visit({ crew: [{ membershipId: "a" }, { membershipId: "b" }] })]);
    expect(w.get("b")?.[0].end_at).toBe("2026-11-20T19:00:00.000Z");
  });

  it("someone with their own start and length keeps them", () => {
    const w = proposedWindows([
      visit({
        dividesHours: true,
        crew: [
          { membershipId: "a", startOffsetMinutes: 0, durationMinutes: 60 },
          { membershipId: "b", startOffsetMinutes: 90, durationMinutes: 90 },
        ],
      }),
    ]);
    expect(w.get("a")).toEqual([{ start_at: "2026-11-20T16:00:00.000Z", end_at: "2026-11-20T17:00:00.000Z" }]);
    expect(w.get("b")).toEqual([{ start_at: "2026-11-20T17:30:00.000Z", end_at: "2026-11-20T19:00:00.000Z" }]);
  });

  it("a series is one window per visit for each person", () => {
    const w = proposedWindows([
      visit(),
      visit({ bookingId: "b2", scheduledAt: "2026-12-04T16:00:00.000Z" }),
      visit({ bookingId: "b3", scheduledAt: "2026-12-18T16:00:00.000Z" }),
    ]);
    expect(w.get("olha")).toHaveLength(3);
  });

  it("nobody on the job is nothing to check", () => {
    expect(proposedWindows([visit({ crew: [] })]).size).toBe(0);
  });
});

const clash = (over: Partial<CrewClash>): CrewClash => ({
  memberId: "olha",
  memberName: "Olha Musnytska",
  bookingId: "x",
  clientName: "Nancy Whitson",
  scheduledAt: "2026-12-04T15:00:00.000Z",
  ...over,
});

describe("clashMessage", () => {
  const tz = "America/Regina"; // permanent UTC-6, as Alberta is from Nov 2026

  it("says nothing when there is nothing to name", () => {
    expect(clashMessage([], { tz, visitCount: 1 })).toBeNull();
  });

  it("one visit: who, which job, when, and that nothing changed", () => {
    const text = clashMessage([clash({})], { tz, visitCount: 1 });
    expect(text).toContain("Olha Musnytska is already booked then: Nancy Whitson, Dec 4, 2026 · 9:00 AM.");
    expect(text).toContain("Nothing was changed.");
    expect(text).toContain("move that job first");
    // The sentence it replaces named nobody.
    expect(text).not.toMatch(/A cleaner already has an overlapping booking/);
  });

  it("a series: every clashing date, in order, and what to do about it", () => {
    const text = clashMessage(
      [
        clash({ bookingId: "c", clientName: "Emma Drebit", scheduledAt: "2027-01-15T16:00:00.000Z" }),
        clash({}),
        clash({ bookingId: "b", clientName: "Emma Drebit", scheduledAt: "2027-01-01T16:00:00.000Z" }),
      ],
      { tz, visitCount: 52 },
    ) as string;
    expect(text).toContain("Olha Musnytska is already booked on 3 of these dates:");
    expect(text.indexOf("Dec 4, 2026")).toBeLessThan(text.indexOf("Jan 1, 2027"));
    expect(text.indexOf("Jan 1, 2027")).toBeLessThan(text.indexOf("Jan 15, 2027"));
    expect(text).toContain("Choose someone who is free on every date");
  });

  it("lists four jobs per person and counts the rest", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      clash({ bookingId: `j${i}`, clientName: "Emma Drebit", scheduledAt: `2027-0${i + 1}-01T16:00:00.000Z` }),
    );
    const text = clashMessage(many, { tz, visitCount: 52 }) as string;
    expect(text).toContain("on 6 of these dates");
    expect(text).toContain("and 2 more");
    expect(text.match(/Emma Drebit/g)).toHaveLength(4);
  });

  it("names each person separately", () => {
    const text = clashMessage(
      [clash({}), clash({ memberId: "vira", memberName: "Vira Karpynska", bookingId: "y", clientName: "Emma Drebit" })],
      { tz, visitCount: 1 },
    ) as string;
    expect(text).toContain("Olha Musnytska is already booked then: Nancy Whitson");
    expect(text).toContain("Vira Karpynska is already booked then: Emma Drebit");
  });
});

describe("isDoubleBookingError", () => {
  it("knows the database's refusal by code or by words", () => {
    expect(isDoubleBookingError({ code: "23P01" })).toBe(true);
    expect(isDoubleBookingError({ message: "A cleaner already has an overlapping booking" })).toBe(true);
    expect(isDoubleBookingError({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isDoubleBookingError(null)).toBe(false);
  });
});

describe("Book anyway", () => {
  const tz = "America/Regina";

  it("an owner saving one visit is told the button is there; a series never is", () => {
    const one = clashMessage([clash({})], { tz, visitCount: 1, canBookAnyway: true });
    expect(one).toContain("press Book anyway to keep both");
    const many = clashMessage([clash({})], { tz, visitCount: 3, canBookAnyway: true });
    expect(many).not.toContain("Book anyway");
  });

  it("the key names each person and job once, in a fixed order", () => {
    const a = clash({ memberId: "m2", bookingId: "b1" });
    const b = clash({ memberId: "m1", bookingId: "b1" });
    expect(clashKey([a, b, a])).toBe("m1:b1,m2:b1");
    expect(clashKey([b, a])).toBe(clashKey([a, b]));
  });

  it("the visit's page says who is on which other job", () => {
    expect(alsoBookedSentence([], tz)).toBeNull();
    expect(alsoBookedSentence([clash({})], tz)).toBe(
      "Olha Musnytska is also on Nancy Whitson's job (Dec 4, 2026 · 9:00 AM) at the same time.",
    );
    const two = alsoBookedSentence(
      [clash({ bookingId: "z", clientName: "Leslie Saumer", scheduledAt: "2026-12-04T20:00:00.000Z" }), clash({})],
      tz,
    );
    expect(two).toBe(
      "Olha Musnytska is also on Nancy Whitson's job (Dec 4, 2026 · 9:00 AM) and Leslie Saumer's job (Dec 4, 2026 · 2:00 PM) at the same time.",
    );
  });
});

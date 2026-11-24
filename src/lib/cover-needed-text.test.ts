import { describe, expect, it } from "vitest";
import { coverReason, coverSummary, type CoverPerson, type CoverVisit } from "./cover-needed-text";
import { computeBookingWarnings, type WarnableBooking } from "@/app/app/bookings/booking-warnings";

const TZ = "America/Regina";
const anna: CoverPerson = { membershipId: "a", name: "Anna Cleaner", otherClient: "Smith", otherAt: "2027-03-05T15:00:00.000Z" };
const bea: CoverPerson = { membershipId: "b", name: "Bea Cleaner", otherClient: null, otherAt: null };
const visit = (date: string, people: CoverPerson[] = [anna]): CoverVisit => ({
  bookingId: `v-${date}`,
  scheduledAt: `${date}T16:00:00.000Z`,
  clientName: "Stacie Moore",
  people,
});

describe("why a visit needs cover", () => {
  it("names the person and the job they are on, in the company's time", () => {
    expect(coverReason(visit("2027-03-05"), TZ)).toBe("Anna Cleaner is on another job then (Smith, 9:00 AM)");
  });

  it("still reads when the other job can't be named, and lists two people", () => {
    expect(coverReason(visit("2027-03-05", [bea]), TZ)).toBe("Bea Cleaner is on another job then");
    expect(coverReason(visit("2027-03-05", [anna, bea]), TZ)).toBe(
      "Anna Cleaner is on another job then (Smith, 9:00 AM); Bea Cleaner is on another job then",
    );
  });
});

describe("what a series save says", () => {
  it("nothing, when nobody was left off", () => {
    expect(coverSummary([], TZ, 26)).toBeNull();
  });

  it("one visit", () => {
    expect(coverSummary([visit("2027-03-05")], TZ, 26)).toBe(
      'Anna Cleaner is on another job on 1 of the 26 visits (Fri, Mar 5) and was left off it. That visit is marked "Needs cover": open it and pick someone else.',
    );
  });

  it("several visits, in date order, with the count of visits when it is known", () => {
    const said = coverSummary([visit("2027-04-02"), visit("2027-03-05"), visit("2027-05-14")], TZ, 26);
    expect(said).toBe(
      'Anna Cleaner is on another job on 3 of the 26 visits (Fri, Mar 5, Fri, Apr 2, Fri, May 14) and was left off them. Those 3 visits are marked "Needs cover": open each one and pick someone else.',
    );
    expect(coverSummary([visit("2027-03-05"), visit("2027-04-02")], TZ)).toContain("is on another job on 2 visits (");
  });

  it("two people, each with their own dates; a long list is cut off with a count", () => {
    const said = coverSummary([visit("2027-03-05", [anna, bea]), visit("2027-03-19", [bea])], TZ, 10)!;
    expect(said).toContain("Anna Cleaner is on another job on 1 of the 10 visits (Fri, Mar 5) and was left off it.");
    expect(said).toContain("Bea Cleaner is on another job on 2 of the 10 visits (Fri, Mar 5, Fri, Mar 19) and was left off them.");
    expect(said).toContain("Those 2 visits are marked");

    const many = Array.from({ length: 9 }, (_, i) => visit(`2027-03-${String(i + 1).padStart(2, "0")}`));
    expect(coverSummary(many, TZ, 52)).toContain(", and 3 more) and was left off them.");
  });
});

describe("someone left off for having finished", () => {
  const olga: CoverPerson = { membershipId: "o", name: "Olga", otherClient: null, otherAt: null, finishedOn: "2026-12-18" };

  it("gives her last working day as the reason, not another job", () => {
    expect(coverReason(visit("2027-01-07", [olga]), TZ)).toBe("Olga's last working day is Fri, Dec 18");
    expect(coverReason(visit("2027-01-07", [{ ...olga, finishedOn: "" }]), TZ)).toBe("Olga was left off this visit");
  });

  it("a series save says so in its own sentence, beside anyone left off for another job", () => {
    const said = coverSummary([visit("2027-01-07", [olga, anna]), visit("2027-01-14", [olga])], TZ)!;
    expect(said).toContain("Olga's last working day is Fri, Dec 18, so Olga was left off 2 visits after it (Thu, Jan 7, Thu, Jan 14).");
    expect(said).toContain("Anna Cleaner is on another job on 1 visit (Thu, Jan 7) and was left off it.");
  });
});

describe("the Needs cover warning chip", () => {
  const job = (over: Partial<WarnableBooking>): WarnableBooking => ({
    id: "j",
    client_id: "c",
    client_name: "Stacie Moore",
    scheduled_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    duration_minutes: 120,
    status: "confirmed",
    total_cents: 15000,
    hourly_rate_cents: null,
    assigned_to: "someone",
    additional_assignee_ids: [],
    covered_by_name: null,
    ...over,
  });
  const codes = (b: WarnableBooking) => (computeBookingWarnings([b]).get("j") ?? []).map((w) => w.code);

  it("shows on a marked visit, with the reason, and not on an unmarked, finished or cancelled one", () => {
    const reason = "Anna Cleaner is on another job then (Smith, 9:00 AM)";
    const [w] = computeBookingWarnings([job({ needs_cover: reason })]).get("j") ?? [];
    expect(w).toMatchObject({ code: "needs_cover", label: "Needs cover", severity: "high" });
    expect(w.detail).toBe(`${reason}, so they were left off this visit when the series' crew was set. Open it and pick someone else.`);
    expect(codes(job({}))).not.toContain("needs_cover");
    expect(codes(job({ needs_cover: null }))).not.toContain("needs_cover");
    expect(codes(job({ needs_cover: reason, status: "completed" }))).not.toContain("needs_cover");
    expect(codes(job({ needs_cover: reason, status: "cancelled" }))).not.toContain("needs_cover");
  });

  it("for a last working day, doesn't say the series' crew was set", () => {
    const [w] = computeBookingWarnings([job({ needs_cover: "Olga's last working day is Fri, Dec 18" })]).get("j") ?? [];
    expect(w.detail).toBe("Olga's last working day is Fri, Dec 18. Open it and pick someone else.");
  });
});

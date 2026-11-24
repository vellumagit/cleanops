import { describe, expect, it } from "vitest";
import { frequencyLabel, seriesNames, seriesNamingMember, type SeriesRow } from "./series-naming-member";

const TZ = "UTC";
const series = (over: Partial<SeriesRow> & { id: string }): SeriesRow => ({
  assigned_to: null,
  crew: null,
  pattern: "weekly",
  ends_at: null,
  client_name: "Client",
  ...over,
});
const visit = (id: string, seriesId: string, day: string) => ({
  id,
  series_id: seriesId,
  scheduled_at: `${day}T15:00:00.000Z`,
});

describe("seriesNames", () => {
  it("finds the person as the one cleaner of an older series, or anywhere on a stored crew", () => {
    expect(seriesNames({ assigned_to: "olha", crew: null }, "olha")).toBe(true);
    expect(
      seriesNames(
        { assigned_to: "anna", crew: [{ membership_id: "anna" }, { membership_id: "olha" }] },
        "olha",
      ),
    ).toBe(true);
    expect(seriesNames({ assigned_to: "anna", crew: [{ membership_id: "anna" }] }, "olha")).toBe(false);
  });

  it("does not choke on a crew that is not a list", () => {
    expect(seriesNames({ assigned_to: null, crew: "olha" }, "olha")).toBe(false);
  });
});

describe("seriesNamingMember", () => {
  it("lists only series that name the person and go on past the last day", () => {
    const out = seriesNamingMember(
      [
        series({ id: "a", assigned_to: "olha", client_name: "Nella" }),
        series({ id: "b", assigned_to: "anna", client_name: "Someone else" }),
        // Ends the day she finishes: makes nothing after it.
        series({ id: "c", assigned_to: "olha", ends_at: "2026-12-18", client_name: "Ends in time" }),
        series({ id: "d", crew: [{ membership_id: "olha" }], ends_at: "2027-03-01", client_name: "Amanda" }),
      ],
      [],
      "olha",
      "2026-12-18",
      TZ,
    );
    expect(out.map((s) => s.seriesId)).toEqual(["d", "a"]); // by client name
  });

  it("points at the first visit after the last day", () => {
    const [s] = seriesNamingMember(
      [series({ id: "a", assigned_to: "olha" })],
      [visit("v3", "a", "2026-12-28"), visit("v1", "a", "2026-12-14"), visit("v2", "a", "2026-12-21")],
      "olha",
      "2026-12-18",
      TZ,
    );
    expect(s).toMatchObject({ visitId: "v2", visitIsAfterLastDay: true });
  });

  it("a visit on the last day itself is still hers, so it is not the one to re-staff", () => {
    const [s] = seriesNamingMember(
      [series({ id: "a", assigned_to: "olha" })],
      [visit("v1", "a", "2026-12-18"), visit("v2", "a", "2026-12-25")],
      "olha",
      "2026-12-18",
      TZ,
    );
    expect(s.visitId).toBe("v2");
  });

  it("falls back to the latest visit coming up when none is that far out yet", () => {
    const [s] = seriesNamingMember(
      [series({ id: "a", assigned_to: "olha" })],
      [visit("v1", "a", "2026-12-07"), visit("v2", "a", "2026-12-14")],
      "olha",
      "2026-12-18",
      TZ,
    );
    expect(s).toMatchObject({ visitId: "v2", visitIsAfterLastDay: false });
  });

  it("says so when the series has nothing coming up", () => {
    const [s] = seriesNamingMember([series({ id: "a", assigned_to: "olha" })], [], "olha", "2026-12-18", TZ);
    expect(s).toMatchObject({ visitId: null, visitAt: null, visitIsAfterLastDay: false });
  });

  it("reads the visit's day in the company's timezone", () => {
    // 03:00 UTC on the 19th is still the evening of the 18th in Regina.
    const [s] = seriesNamingMember(
      [series({ id: "a", assigned_to: "olha" })],
      [{ id: "late", series_id: "a", scheduled_at: "2026-12-19T03:00:00.000Z" }],
      "olha",
      "2026-12-18",
      "America/Regina",
    );
    expect(s.visitIsAfterLastDay).toBe(false);
  });
});

describe("frequencyLabel", () => {
  it("names the patterns the app offers, and has a word for one it does not know", () => {
    expect(frequencyLabel("bi_weekly")).toBe("Every 2 weeks");
    expect(frequencyLabel("something_new")).toBe("Recurring");
  });
});

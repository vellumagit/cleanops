import { describe, expect, it } from "vitest";
import {
  crewForGeneration,
  crewFromForm,
  crewHasWindows,
  parseSeriesCrew,
  splitsFromCrew,
} from "./series-crew";

describe("crewFromForm", () => {
  it("keeps the whole crew for an ordinary team job", () => {
    // Amanda DeGroot's shape: two cleaners, same hours.
    expect(
      crewFromForm({ primaryId: "anna", additionalIds: ["marharyta"], splits: [] }),
    ).toEqual([
      { membership_id: "anna", start_offset_minutes: null, duration_minutes: null },
      { membership_id: "marharyta", start_offset_minutes: null, duration_minutes: null },
    ]);
  });

  it("keeps each person's window on a staggered job", () => {
    const crew = crewFromForm({
      primaryId: "veronika",
      additionalIds: [],
      splits: [
        { assigned_to: "veronika", start_offset_minutes: 0, duration_minutes: 480 },
        { assigned_to: "olha", start_offset_minutes: 90, duration_minutes: 480 },
      ],
    });
    expect(crew).toEqual([
      { membership_id: "veronika", start_offset_minutes: 0, duration_minutes: 480 },
      { membership_id: "olha", start_offset_minutes: 90, duration_minutes: 480 },
    ]);
  });

  it("resolves legacy end-to-end splits that carry no offset", () => {
    const crew = crewFromForm({
      primaryId: null,
      additionalIds: [],
      splits: [
        { assigned_to: "a", duration_minutes: 180 },
        { assigned_to: "b", duration_minutes: 240 },
      ],
    });
    expect(crew.map((m) => m.start_offset_minutes)).toEqual([0, 180]);
  });

  it("adds extra crew alongside windows, on site for the whole visit", () => {
    const crew = crewFromForm({
      primaryId: "a",
      additionalIds: ["helper"],
      splits: [{ assigned_to: "a", start_offset_minutes: 0, duration_minutes: 120 }],
    });
    expect(crew[1]).toEqual({
      membership_id: "helper",
      start_offset_minutes: null,
      duration_minutes: null,
    });
  });

  it("matches syncBookingAssignees: with windows, the selected cleaner is not added unless named", () => {
    const crew = crewFromForm({
      primaryId: "lead",
      additionalIds: [],
      splits: [{ assigned_to: "other", start_offset_minutes: 0, duration_minutes: 60 }],
    });
    expect(crew.map((m) => m.membership_id)).toEqual(["other"]);
  });

  it("drops duplicates, first mention wins", () => {
    const crew = crewFromForm({
      primaryId: "a",
      additionalIds: ["a", "b", "b"],
      splits: [],
    });
    expect(crew.map((m) => m.membership_id)).toEqual(["a", "b"]);
  });

  it("is empty when nobody is selected", () => {
    expect(crewFromForm({ primaryId: null, additionalIds: [], splits: [] })).toEqual([]);
  });
});

describe("parseSeriesCrew", () => {
  it("survives garbage without throwing — it runs inside the nightly cron", () => {
    expect(parseSeriesCrew(null)).toEqual([]);
    expect(parseSeriesCrew("nope")).toEqual([]);
    expect(
      parseSeriesCrew([null, 5, {}, { membership_id: "" }, { membership_id: "ok" }]),
    ).toEqual([
      { membership_id: "ok", start_offset_minutes: null, duration_minutes: null },
    ]);
  });

  it("dedupes and rejects negative or non-numeric windows", () => {
    expect(
      parseSeriesCrew([
        { membership_id: "a", start_offset_minutes: -5, duration_minutes: "x" },
        { membership_id: "a", start_offset_minutes: 10, duration_minutes: 20 },
      ]),
    ).toEqual([
      { membership_id: "a", start_offset_minutes: null, duration_minutes: null },
    ]);
  });
});

describe("crewForGeneration", () => {
  it("uses the stored crew — the fix: a two-person series extends as two people", () => {
    const crew = crewForGeneration({
      assigned_to: "anna",
      crew: [
        { membership_id: "anna", start_offset_minutes: null, duration_minutes: null },
        { membership_id: "marharyta", start_offset_minutes: null, duration_minutes: null },
      ],
    });
    expect(crew).toHaveLength(2);
  });

  it("falls back to the legacy single cleaner for series without a stored crew", () => {
    expect(crewForGeneration({ assigned_to: "olha", crew: null })).toEqual([
      { membership_id: "olha", start_offset_minutes: null, duration_minutes: null },
    ]);
  });

  it("treats an empty stored crew as no crew, not as 'nobody'", () => {
    expect(crewForGeneration({ assigned_to: "olha", crew: [] })).toHaveLength(1);
  });

  it("is empty when there is no crew and no legacy cleaner", () => {
    expect(crewForGeneration({ assigned_to: null, crew: null })).toEqual([]);
  });
});

describe("splitsFromCrew", () => {
  it("writes the form's splits shape when anyone has a window", () => {
    const crew = parseSeriesCrew([
      { membership_id: "a", start_offset_minutes: 0, duration_minutes: 480 },
      { membership_id: "b", start_offset_minutes: 90, duration_minutes: 480 },
    ]);
    expect(crewHasWindows(crew)).toBe(true);
    expect(splitsFromCrew(crew)).toEqual([
      { assigned_to: "a", start_offset_minutes: 0, duration_minutes: 480 },
      { assigned_to: "b", start_offset_minutes: 90, duration_minutes: 480 },
    ]);
  });

  it("is empty for a plain team job, so it does not become a split", () => {
    const crew = parseSeriesCrew([{ membership_id: "a" }, { membership_id: "b" }]);
    expect(crewHasWindows(crew)).toBe(false);
    expect(splitsFromCrew(crew)).toEqual([]);
  });
});

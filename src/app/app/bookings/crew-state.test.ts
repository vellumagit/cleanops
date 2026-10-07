import { describe, expect, it } from "vitest";
import {
  crewFormFields,
  initialCrewState,
  toggleCrewMember,
  wholeVisit,
} from "./crew-state";

describe("initialCrewState", () => {
  it("opens a plain team job as one crew, no times", () => {
    expect(
      initialCrewState({ assignedTo: "anna", additional: ["uliana"], splits: [] }),
    ).toEqual({ crew: ["anna", "uliana"], timesOn: false, windows: {} });
  });

  it("opens a job with per-person times showing each window", () => {
    const s = initialCrewState({
      assignedTo: "veronika",
      additional: [],
      splits: [
        { assigned_to: "veronika", start_offset_minutes: 0, duration_minutes: 480 },
        { assigned_to: "olha", start_offset_minutes: 90, duration_minutes: 480 },
      ],
    });
    expect(s.crew).toEqual(["veronika", "olha"]);
    expect(s.timesOn).toBe(true);
    expect(s.windows.olha).toEqual({ start_offset_minutes: 90, duration_minutes: 480 });
  });

  it("resolves legacy end-to-end splits with no offset", () => {
    const s = initialCrewState({
      assignedTo: null,
      additional: [],
      splits: [
        { assigned_to: "a", duration_minutes: 180 },
        { assigned_to: "b", duration_minutes: 240 },
      ],
    });
    expect(s.windows.b.start_offset_minutes).toBe(180);
  });

  it("keeps only the first window for someone named twice — all the database ever stored", () => {
    const s = initialCrewState({
      assignedTo: null,
      additional: [],
      splits: [
        { assigned_to: "a", start_offset_minutes: 0, duration_minutes: 60 },
        { assigned_to: "b", start_offset_minutes: 0, duration_minutes: 60 },
        { assigned_to: "a", start_offset_minutes: 300, duration_minutes: 60 },
      ],
    });
    expect(s.crew).toEqual(["a", "b"]);
    expect(s.windows.a.start_offset_minutes).toBe(0);
  });

  it("brings in extra crew who weren't given a window", () => {
    const s = initialCrewState({
      assignedTo: "a",
      additional: ["helper"],
      splits: [
        { assigned_to: "a", start_offset_minutes: 0, duration_minutes: 60 },
        { assigned_to: "b", start_offset_minutes: 60, duration_minutes: 60 },
      ],
    });
    expect(s.crew).toEqual(["a", "b", "helper"]);
  });

  it("is empty for an unassigned job", () => {
    expect(initialCrewState({ assignedTo: null, additional: null, splits: null }).crew).toEqual([]);
  });
});

describe("crewFormFields", () => {
  it("sends the same fields the server already reads", () => {
    const f = crewFormFields({ crew: ["anna", "uliana"], timesOn: false, windows: {} }, 420);
    expect(f).toEqual({ assignedTo: "anna", additional: ["uliana"], splits: null });
  });

  it("sends nothing for an empty crew — the job stays unassigned", () => {
    expect(crewFormFields({ crew: [], timesOn: false, windows: {} }, 420)).toEqual({
      assignedTo: "",
      additional: [],
      splits: null,
    });
  });

  it("sends one window per person when times are on", () => {
    const f = crewFormFields(
      {
        crew: ["v", "o"],
        timesOn: true,
        windows: { v: { start_offset_minutes: 0, duration_minutes: 480 } },
      },
      960,
    );
    expect(JSON.parse(f.splits as string)).toEqual([
      { id: "v", assigned_to: "v", start_offset_minutes: 0, duration_minutes: 480 },
      // o has no window yet, so they default to the whole visit
      { id: "o", assigned_to: "o", start_offset_minutes: 0, duration_minutes: 960 },
    ]);
  });

  it("drops times for a one-person crew — the server rejects a single segment", () => {
    const f = crewFormFields({ crew: ["v"], timesOn: true, windows: {} }, 240);
    expect(f.splits).toBeNull();
  });
});

describe("toggleCrewMember / wholeVisit", () => {
  it("adds and removes without reordering anyone else", () => {
    let s = { crew: ["a"], timesOn: false, windows: {} };
    s = toggleCrewMember(s, "b");
    s = toggleCrewMember(s, "c");
    expect(s.crew).toEqual(["a", "b", "c"]);
    s = toggleCrewMember(s, "a");
    expect(s.crew).toEqual(["b", "c"]);
  });

  it("falls back to two hours when the job has no length yet", () => {
    expect(wholeVisit(0)).toEqual({ start_offset_minutes: 0, duration_minutes: 120 });
  });
});

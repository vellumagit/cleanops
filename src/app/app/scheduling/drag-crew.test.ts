import { describe, expect, it } from "vitest";
import { planCrewMove } from "./drag-crew";

const amanda = { crew: ["anna", "uliana"], lead: "anna" };

describe("planCrewMove", () => {
  it("THE BUG: moving the day from Uliana's lane keeps Anna on the job", () => {
    // Used to: delete the crew, re-add only Uliana.
    expect(planCrewMove({ ...amanda, mover: "uliana", target: "uliana" })).toEqual({
      kind: "unchanged",
    });
  });

  it("moving the day from the lead's lane changes nobody", () => {
    expect(planCrewMove({ ...amanda, mover: "anna", target: "anna" }).kind).toBe(
      "unchanged",
    );
  });

  it("dragging Uliana's card to Marharyta swaps just Uliana", () => {
    expect(planCrewMove({ ...amanda, mover: "uliana", target: "marharyta" })).toEqual({
      kind: "changed",
      crew: ["anna", "marharyta"],
      lead: "anna",
      removed: "uliana",
      added: "marharyta",
    });
  });

  it("swapping the lead hands the lead to the person dropped in", () => {
    const p = planCrewMove({ ...amanda, mover: "anna", target: "marharyta" });
    expect(p).toMatchObject({ kind: "changed", crew: ["uliana", "marharyta"], lead: "marharyta" });
  });

  it("refuses dropping into the lane of someone already on the job", () => {
    expect(planCrewMove({ ...amanda, mover: "uliana", target: "anna" })).toEqual({
      kind: "already_on",
      target: "anna",
    });
  });

  it("the unassigned tray takes off one person, not the crew", () => {
    expect(planCrewMove({ ...amanda, mover: "uliana", target: null })).toEqual({
      kind: "changed",
      crew: ["anna"],
      lead: "anna",
      removed: "uliana",
      added: null,
    });
  });

  it("the job is only unassigned when its last person goes to the tray", () => {
    const p = planCrewMove({ crew: ["anna"], lead: "anna", mover: "anna", target: null });
    expect(p).toMatchObject({ kind: "changed", crew: [], lead: null });
  });

  it("assigns a job dragged out of the unassigned tray", () => {
    expect(planCrewMove({ crew: [], lead: null, mover: null, target: "olha" })).toEqual({
      kind: "changed",
      crew: ["olha"],
      lead: "olha",
      removed: null,
      added: "olha",
    });
  });

  it("an old tab that can only name the lead now swaps instead of wiping", () => {
    // The pre-fix server, given (target=marharyta), deleted everyone. The
    // fallback treats the lead as the mover: Uliana survives.
    const p = planCrewMove({ ...amanda, mover: amanda.lead, target: "marharyta" });
    expect(p).toMatchObject({ kind: "changed", crew: ["uliana", "marharyta"] });
  });

  it("a solo job behaves exactly as before", () => {
    expect(planCrewMove({ crew: ["olha"], lead: "olha", mover: "olha", target: "veronika" })).toEqual({
      kind: "changed",
      crew: ["veronika"],
      lead: "veronika",
      removed: "olha",
      added: "veronika",
    });
  });

  it("a tray card dropped back on the tray is a no-op", () => {
    expect(planCrewMove({ crew: [], lead: null, mover: null, target: null }).kind).toBe(
      "unchanged",
    );
  });
});

import { describe, it, expect } from "vitest";
import { planOfferSwap } from "./offer-swap";

const base = {
  replacedId: "olha",
  claimerMembershipId: "diana",
  isFirstClaim: true,
  crew: [
    { membership_id: "veronika", is_primary: true },
    { membership_id: "olha", is_primary: false },
  ],
  assignedTo: "veronika",
  bookingStatus: "confirmed",
  replacedClockedIn: false,
};

describe("planOfferSwap", () => {
  it("Diana takes Olha's spot: her row moves over, Veronika stays lead", () => {
    expect(planOfferSwap(base)).toEqual({
      kind: "swap",
      reassignRow: true,
      deleteRow: false,
      insertClaimer: false,
      assignedTo: undefined,
      newPrimary: null,
      crewAfter: ["veronika", "diana"],
    });
  });

  it("replacing the lead hands the lead to the claimer", () => {
    const p = planOfferSwap({
      ...base,
      crew: [{ membership_id: "olha", is_primary: true }],
      assignedTo: "olha",
    });
    expect(p).toMatchObject({ kind: "swap", reassignRow: true, assignedTo: "diana", newPrimary: null });
  });

  it("claimer already on the job: Olha's row is just removed", () => {
    const p = planOfferSwap({
      ...base,
      crew: [...base.crew, { membership_id: "diana", is_primary: false }],
    });
    expect(p).toMatchObject({ kind: "swap", reassignRow: false, deleteRow: true, insertClaimer: false });
  });

  it("an on-call freelancer covering the lead: lead passes to whoever is left", () => {
    const p = planOfferSwap({
      ...base,
      claimerMembershipId: null,
      crew: [
        { membership_id: "olha", is_primary: true },
        { membership_id: "veronika", is_primary: false },
      ],
      assignedTo: "olha",
    });
    expect(p).toMatchObject({ kind: "swap", deleteRow: true, assignedTo: "veronika", newPrimary: "veronika", crewAfter: ["veronika"] });
  });

  it("an on-call freelancer covering a solo job leaves it to the claim", () => {
    const p = planOfferSwap({
      ...base,
      claimerMembershipId: null,
      crew: [{ membership_id: "olha", is_primary: true }],
      assignedTo: "olha",
    });
    expect(p).toMatchObject({ kind: "swap", deleteRow: true, assignedTo: null, crewAfter: [] });
  });

  it("never swaps once the job has started or the replaced cleaner clocked in", () => {
    expect(planOfferSwap({ ...base, bookingStatus: "in_progress" })).toEqual({ kind: "blocked", reason: "started" });
    expect(planOfferSwap({ ...base, replacedClockedIn: true })).toEqual({ kind: "blocked", reason: "clocked_in" });
  });

  it("only the first claim swaps, and nothing happens without a replacement", () => {
    expect(planOfferSwap({ ...base, isFirstClaim: false })).toEqual({ kind: "none" });
    expect(planOfferSwap({ ...base, replacedId: null })).toEqual({ kind: "none" });
  });

  it("someone already taken off by hand: nothing to swap", () => {
    expect(
      planOfferSwap({ ...base, crew: [{ membership_id: "veronika", is_primary: true }] }),
    ).toEqual({ kind: "none" });
  });

  it("legacy job with Olha only in assigned_to: claimer gets a row and the lead", () => {
    const p = planOfferSwap({ ...base, crew: [], assignedTo: "olha" });
    expect(p).toMatchObject({ kind: "swap", reassignRow: false, deleteRow: false, insertClaimer: true, assignedTo: "diana", newPrimary: "diana" });
  });
});

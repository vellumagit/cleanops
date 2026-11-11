import { describe, expect, it } from "vitest";
import { noteUnpriced, resolvePayRate, stillAnEstimate, unpricedSentence, type Unpriced } from "./pay-rate";

describe("resolvePayRate", () => {
  it("uses the rate frozen on the shift, then the person's current rate", () => {
    expect(resolvePayRate(2400, 2000)).toBe(2400);
    expect(resolvePayRate(null, 2000)).toBe(2000);
    expect(resolvePayRate(undefined, 2000)).toBe(2000);
  });

  it("says so when there is no rate at all, and never invents zero", () => {
    expect(resolvePayRate(null, null)).toBeNull();
    expect(resolvePayRate(undefined, undefined)).toBeNull();
  });

  it("keeps a rate someone set to zero", () => {
    expect(resolvePayRate(0, 2000)).toBe(0);
    expect(resolvePayRate(null, 0)).toBe(0);
  });
});

describe("unpricedSentence", () => {
  it("says nothing when everyone has a rate", () => {
    expect(unpricedSentence(new Map())).toBeNull();
  });

  it("names each person once with their total time, longest first", () => {
    const u: Unpriced = new Map();
    noteUnpriced(u, "a", "Anna", 45);
    noteUnpriced(u, "b", "Svitlana", 120);
    noteUnpriced(u, "a", "Anna", 30);
    expect(u.get("a")).toEqual({ name: "Anna", minutes: 75, items: 2 });
    expect(unpricedSentence(u)).toBe(
      "Not included: Svitlana (2h 00m) and Anna (1h 15m) have no pay rate, so that time is not in this run and is not marked paid. Set a rate and prepare a run again to pay it.",
    );
  });

  it("reads right for one person and for three", () => {
    const one: Unpriced = new Map();
    noteUnpriced(one, "a", "Anna", 60);
    expect(unpricedSentence(one)).toMatch(/^Not included: Anna \(1h 00m\) has no pay rate/);
    const three: Unpriced = new Map();
    noteUnpriced(three, "a", "A", 30);
    noteUnpriced(three, "b", "B", 20);
    noteUnpriced(three, "c", "C", 10);
    expect(unpricedSentence(three)).toMatch(/^Not included: A \(0h 30m\), B \(0h 20m\) and C \(0h 10m\) have no pay rate/);
  });
});

describe("stillAnEstimate", () => {
  const drafts = new Set(["draft-run"]);

  it("keeps a shift no run has claimed", () => {
    expect(stillAnEstimate({ payroll_run_id: null, subcontractor_run_id: null }, drafts)).toBe(true);
    expect(stillAnEstimate({}, drafts)).toBe(true);
  });

  it("keeps a shift in a run the office is still reviewing", () => {
    expect(stillAnEstimate({ payroll_run_id: "draft-run" }, drafts)).toBe(true);
    expect(stillAnEstimate({ subcontractor_run_id: "draft-run" }, drafts)).toBe(true);
  });

  it("drops a shift a finalized run already states", () => {
    expect(stillAnEstimate({ payroll_run_id: "finalized-run" }, drafts)).toBe(false);
    expect(stillAnEstimate({ subcontractor_run_id: "paid-run" }, drafts)).toBe(false);
  });
});

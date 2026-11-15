import { describe, expect, it } from "vitest";
import { effectiveFrom, planRateChange, rateChangeNotice, type RateShift } from "./pay-rate-change";

const shift = (over: Partial<RateShift> & { id: string }): RateShift => ({
  clock_in_at: "2026-11-04T16:00:00Z",
  clock_out_at: "2026-11-04T19:00:00Z",
  pay_rate_cents_snapshot: 1700,
  payroll_run_id: null,
  subcontractor_run_id: null,
  ...over,
});

describe("planRateChange", () => {
  it("unpaid shifts at another rate are re-priced; ones already at the new rate are left", () => {
    const plan = planRateChange([shift({ id: "a" }), shift({ id: "b", pay_rate_cents_snapshot: 1800 })], 1800);
    expect(plan).toEqual({ repriceIds: ["a"], onRuns: 0, owedCents: 0 });
  });

  it("a shift with no frozen rate takes the new one", () => {
    expect(planRateChange([shift({ id: "a", pay_rate_cents_snapshot: null })], 1800).repriceIds).toEqual(["a"]);
  });

  it("a shift still on the clock is re-priced too", () => {
    expect(planRateChange([shift({ id: "a", clock_out_at: null })], 1800).repriceIds).toEqual(["a"]);
  });

  it("shifts on a pay run, payroll or contractor, are never re-priced, and what is owed is counted", () => {
    const plan = planRateChange(
      [
        shift({ id: "p", payroll_run_id: "run" }), // 3h at +$1
        shift({ id: "s", subcontractor_run_id: "stmt", clock_out_at: "2026-11-04T17:30:00Z" }), // 1.5h at +$1
        shift({ id: "free" }),
      ],
      1800,
    );
    expect(plan.repriceIds).toEqual(["free"]);
    expect(plan.onRuns).toBe(2);
    expect(plan.owedCents).toBe(450);
  });

  it("a cut counts what it would take off", () => {
    const plan = planRateChange([shift({ id: "p", payroll_run_id: "run", pay_rate_cents_snapshot: 1800 })], 1700);
    expect(plan.owedCents).toBe(-300);
  });
});

describe("rateChangeNotice", () => {
  it("says nothing when nothing was reached", () => {
    expect(rateChangeNotice({ repriceIds: [], onRuns: 0, owedCents: 0 }, "Vira", 1800)).toBeNull();
  });

  it("names the person, the count and the rate", () => {
    expect(rateChangeNotice({ repriceIds: ["a", "b"], onRuns: 0, owedCents: 0 }, "Vira Karpynska", 1800)).toBe(
      "2 unpaid shifts for Vira Karpynska are now at $18.00/hr.",
    );
  });

  it("says what was left on a pay run and what it would add", () => {
    const text = rateChangeNotice({ repriceIds: [], onRuns: 1, owedCents: 300 }, "Vira", 1800);
    expect(text).toContain("1 shift is already on a pay run and was not changed.");
    expect(text).toContain("would add $3.00");
    expect(text).toContain("delete it and prepare it again");
  });
});

describe("effectiveFrom", () => {
  const now = new Date("2026-11-15T16:00:00Z");
  const midnight = (ymd: string) => new Date(`${ymd}T06:00:00Z`);
  const from = (ymd: string) => effectiveFrom(ymd, "2026-11-15", midnight, now);

  it("blank is from now, and touches nothing already worked", () => {
    expect(from("")).toEqual({ at: now, backdated: false });
  });

  it("a date is that day's midnight in the company's zone", () => {
    expect(from("2026-11-01")).toEqual({ at: new Date("2026-11-01T06:00:00Z"), backdated: true });
  });

  it("today counts as a date: shifts worked earlier today are covered", () => {
    expect(from("2026-11-15")).toMatchObject({ backdated: true });
  });

  it("refuses the future, more than a year back, and nonsense", () => {
    expect(from("2026-11-16")).toHaveProperty("error");
    expect(from("2025-11-01")).toHaveProperty("error");
    expect(from("yesterday")).toHaveProperty("error");
    expect(from("2026-13-45")).toHaveProperty("error");
  });
});

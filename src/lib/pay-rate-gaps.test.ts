import { describe, expect, it } from "vitest";
import { describeRateGaps, findRateGaps, type RateGapMember } from "./pay-rate-gaps";

const shift = (who: string, hours: number, rate: number | null = null) => ({
  employee_id: who,
  clock_in_at: "2026-10-28T15:15:00Z",
  clock_out_at: new Date(Date.parse("2026-10-28T15:15:00Z") + hours * 3_600_000).toISOString(),
  pay_rate_cents_snapshot: rate,
});

const members = new Map<string, RateGapMember>([
  ["iryna", { name: "Iryna Ilin", role: "employee", payRateCents: null }],
  ["alona", { name: "Alona Smirnova", role: "employee", payRateCents: null }],
  ["olha", { name: "Olha Musnytska", role: "manager", payRateCents: 2600 }],
  ["svitlana", { name: "Svitlana Pavliuk", role: "owner", payRateCents: null }],
  ["zero", { name: "Zero Rate", role: "employee", payRateCents: 0 }],
]);

describe("findRateGaps", () => {
  it("adds up each person's hours with no rate, most first", () => {
    const gaps = findRateGaps([shift("alona", 3.5), shift("iryna", 6), shift("iryna", 4), shift("alona", 5.5)], members);
    expect(gaps.map((g) => [g.name, g.minutes])).toEqual([
      ["Iryna Ilin", 600],
      ["Alona Smirnova", 540],
    ]);
  });

  it("is quiet when a rate exists anywhere: current, or on the shift itself", () => {
    expect(findRateGaps([shift("olha", 4)], members)).toEqual([]);
    expect(findRateGaps([shift("iryna", 4, 2000)], members)).toEqual([]);
  });

  it("counts only the unpriced shifts of someone whose rate came and went", () => {
    const gaps = findRateGaps([shift("iryna", 4, 2000), shift("iryna", 2)], members);
    expect(gaps[0].minutes).toBe(120);
  });

  it("treats a rate of zero as no rate", () => {
    expect(findRateGaps([shift("zero", 1)], members).map((g) => g.name)).toEqual(["Zero Rate"]);
  });

  it("leaves out owners, open shifts, zero-length shifts and unknown people", () => {
    const entries = [
      shift("svitlana", 2),
      { ...shift("iryna", 1), clock_out_at: null },
      { ...shift("iryna", 1), clock_out_at: "2026-10-28T15:15:00Z" },
      shift("nobody", 1),
      { ...shift("iryna", 1), employee_id: null },
    ];
    expect(findRateGaps(entries, members)).toEqual([]);
  });
});

describe("describeRateGaps", () => {
  const iryna = { membershipId: "i", name: "Iryna Ilin", minutes: 612 };
  const alona = { membershipId: "a", name: "Alona Smirnova", minutes: 540 };
  const third = { membershipId: "t", name: "Third Person", minutes: 60 };

  it("says nothing when there's nothing to say", () => {
    expect(describeRateGaps([], "before_prepare")).toBeNull();
    expect(describeRateGaps([], "prepared")).toBeNull();
  });

  it("before preparing, says setting a rate is enough", () => {
    expect(describeRateGaps([iryna, alona], "before_prepare")).toBe(
      "Iryna Ilin (10.2h) and Alona Smirnova (9.0h) have hours but no pay rate. Set their rates on the employee file before this period is prepared, or those hours are paid at $0.",
    );
    expect(describeRateGaps([iryna], "before_prepare")).toContain("Iryna Ilin (10.2h) has hours");
  });

  it("after preparing, says it takes preparing again", () => {
    const text = describeRateGaps([iryna], "prepared")!;
    expect(text).toContain("on this period at $0");
    expect(text).toContain("delete the statement or run, and prepare the period again");
  });

  it("lists three people readably", () => {
    expect(describeRateGaps([iryna, alona, third], "prepared")).toContain(
      "Iryna Ilin (10.2h), Alona Smirnova (9.0h) and Third Person (1.0h) have",
    );
  });
});

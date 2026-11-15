import { describe, expect, it } from "vitest";
import { parseAddonAmount, totalAddons } from "./pay-addons";

describe("parseAddonAmount", () => {
  it("reads the ways people type money", () => {
    expect(parseAddonAmount("25")).toBe(2500);
    expect(parseAddonAmount("$25.50")).toBe(2550);
    expect(parseAddonAmount(" 1,200.00 ")).toBe(120000);
    expect(parseAddonAmount("0.5")).toBe(50);
  });

  it("refuses zero, negatives, three decimals, words and anything over $10,000", () => {
    for (const bad of ["", "0", "0.00", "-5", "25.555", "twenty", "10000.01", "25..0"]) {
      expect(parseAddonAmount(bad)).toBeNull();
    }
    expect(parseAddonAmount("10000")).toBe(1_000_000);
  });
});

describe("totalAddons", () => {
  it("adds up per person and keeps reimbursements apart", () => {
    const t = totalAddons([
      { id: "a", membership_id: "vira", kind: "reimbursement", amount_cents: 2500 },
      { id: "b", membership_id: "vira", kind: "travel", amount_cents: 1500 },
      { id: "c", membership_id: "olha", kind: "other", amount_cents: 1000 },
    ]);
    expect(t.get("vira")).toEqual({ addonsCents: 4000, reimbursementCents: 2500, ids: ["a", "b"] });
    expect(t.get("olha")).toEqual({ addonsCents: 1000, reimbursementCents: 0, ids: ["c"] });
  });

  it("ignores a row with no amount", () => {
    expect(totalAddons([{ id: "z", membership_id: "x", kind: "other", amount_cents: 0 }]).size).toBe(0);
  });
});

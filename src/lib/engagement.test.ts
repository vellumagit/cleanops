import { describe, it, expect } from "vitest";
import {
  toEngagement,
  isSubcontractor,
  paySystemFor,
  accruesPto,
  accruesOvertime,
  ENGAGEMENTS,
} from "./engagement";

describe("reading an engagement", () => {
  it("only 'subcontractor' means subcontractor", () => {
    expect(toEngagement("subcontractor")).toBe("subcontractor");
    expect(isSubcontractor("subcontractor")).toBe(true);
  });

  it("treats anything else as employee, including rows written before the column existed", () => {
    // The DB default is 'employee', but a null, a typo, or a stale cached row
    // must never quietly land someone in the wrong pay system. Defaulting to
    // employee keeps them where they already were.
    for (const raw of [null, undefined, "", "employee", "Employee", "contractor", 0]) {
      expect(toEngagement(raw)).toBe("employee");
      expect(isSubcontractor(raw)).toBe(false);
    }
  });

  it("offers exactly two engagements — outsourcing is a different table", () => {
    expect([...ENGAGEMENTS]).toEqual(["employee", "subcontractor"]);
    expect(ENGAGEMENTS).not.toContain("outsourcing");
    expect(ENGAGEMENTS).not.toContain("freelancer");
  });
});

describe("one pay system, never two, never none", () => {
  it("routes each engagement to exactly one system", () => {
    expect(paySystemFor("employee")).toBe("payroll");
    expect(paySystemFor("subcontractor")).toBe("subcontractor-pay");
  });

  it("routes unknown values somewhere rather than nowhere", () => {
    // A person who lands in neither system has invisible earnings; a person in
    // both gets paid twice. Both are worse than being in the wrong one, which
    // is at least visible and correctable.
    for (const raw of [null, undefined, "nonsense"]) {
      expect(["payroll", "subcontractor-pay"]).toContain(paySystemFor(raw));
    }
  });
});

describe("employee-only entitlements", () => {
  it("a subcontractor accrues neither PTO nor overtime", () => {
    // Not just inapplicable — offering either is evidence against the
    // contractor classification the business is asserting.
    expect(accruesPto("subcontractor")).toBe(false);
    expect(accruesOvertime("subcontractor")).toBe(false);
  });

  it("an employee accrues both", () => {
    expect(accruesPto("employee")).toBe(true);
    expect(accruesOvertime("employee")).toBe(true);
  });

  it("defaults to accruing, so nobody silently loses an entitlement", () => {
    expect(accruesPto(null)).toBe(true);
    expect(accruesOvertime(undefined)).toBe(true);
  });
});

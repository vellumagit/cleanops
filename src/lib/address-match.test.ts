import { describe, expect, it } from "vitest";
import { hasNoAddress, samePlace } from "./address-match";

describe("samePlace", () => {
  it("the same address written two ways is one place", () => {
    // Pairs taken from the shapes found in Svit on 2026-11-14.
    expect(samePlace("9420 58 St NW", "9420 58 Street Northwest, Edmonton, AB T6B 1K6, Canada")).toBe(true);
    expect(samePlace("13 Fulton Pl 13 Fulton Pl, St. Albert", "13 Fulton Place, St. Albert, AB")).toBe(true);
    expect(samePlace("17228, 115 Street", "17228 115 Street Northwest")).toBe(true);
    expect(samePlace("903 Proctor Wynd", "903 PROCTOR WYND NW")).toBe(true);
    expect(samePlace("  204 Wahstao Rd ", "204 wahstao rd")).toBe(true);
  });

  it("a different home is a different place", () => {
    expect(samePlace("13825 155 Avenue NW", "6315 135 Avenue NW")).toBe(false);
    expect(samePlace("3696 97 Street", "7723 181 Avenue")).toBe(false);
    // Next door on the same street.
    expect(samePlace("9420 58 St NW", "9422 58 St NW")).toBe(false);
    // Same house number, different street.
    expect(samePlace("9420 58 St NW", "9420 60 St NW")).toBe(false);
  });

  it("an empty address matches nothing, itself included", () => {
    expect(samePlace("", "")).toBe(false);
    expect(samePlace(null, "9420 58 St NW")).toBe(false);
    expect(samePlace("9420 58 St NW", undefined)).toBe(false);
  });

  it("a one-word address only matches itself", () => {
    expect(samePlace("Warehouse", "warehouse")).toBe(true);
    expect(samePlace("Warehouse", "Warehouse 2")).toBe(false);
  });
});

describe("hasNoAddress", () => {
  it("knows blank from typed", () => {
    expect(hasNoAddress(null)).toBe(true);
    expect(hasNoAddress("   ")).toBe(true);
    expect(hasNoAddress("9420 58 St NW")).toBe(false);
  });
});

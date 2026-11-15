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

  it("two units in one building are two places, however the unit is written", () => {
    expect(samePlace("10020 100 St Unit 304", "10020 100 St Unit 305")).toBe(false);
    expect(samePlace("10020 100 Street NW, Apt 12B", "10020 100 St #14")).toBe(false);
    // The same unit, written two ways.
    expect(samePlace("10020 100 St Unit 304", "10020 100 Street Northwest #304")).toBe(true);
    // Only one of them names a unit: the same address with less detail.
    expect(samePlace("10020 100 St", "10020 100 St Unit 304")).toBe(true);
    // A street that merely starts like a unit word is not a unit.
    expect(samePlace("12 Stephen Ave", "12 Stephen Avenue NW")).toBe(true);
    expect(samePlace("40 Unity Square", "40 Unity Sq")).toBe(true);
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

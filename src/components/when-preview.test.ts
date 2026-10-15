import { describe, expect, it } from "vitest";
import { readableWall } from "./when-preview";

describe("readableWall", () => {
  it("spells out a date-only value with its weekday", () => {
    expect(readableWall("2026-10-19")).toBe("Monday, October 19, 2026");
  });

  it("adds the time for a datetime-local value", () => {
    expect(readableWall("2026-10-19T14:30")).toBe(
      "Monday, October 19, 2026 · 2:30 PM",
    );
    expect(readableWall("2026-09-14T19:30:00")).toBe(
      "Monday, September 14, 2026 · 7:30 PM",
    );
  });

  it("is blank for blank, null or junk", () => {
    expect(readableWall("")).toBe("");
    expect(readableWall(null)).toBe("");
    expect(readableWall(undefined)).toBe("");
    expect(readableWall("19/10/2026")).toBe("");
  });

  it("does not shift with the server's zone (evening before midnight)", () => {
    expect(readableWall("2026-12-31T23:59")).toBe(
      "Thursday, December 31, 2026 · 11:59 PM",
    );
  });
});

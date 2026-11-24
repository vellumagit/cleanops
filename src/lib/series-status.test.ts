import { describe, expect, it } from "vitest";
import { seriesStatusPatch } from "./series-status";

describe("seriesStatusPatch", () => {
  it("carries a change between Pending and Confirmed to the later visits", () => {
    expect(seriesStatusPatch("confirmed", "pending")).toBe("pending");
    expect(seriesStatusPatch("pending", "confirmed")).toBe("confirmed");
  });

  it("leaves the later visits alone when the status wasn't changed", () => {
    expect(seriesStatusPatch("confirmed", "confirmed")).toBeNull();
    expect(seriesStatusPatch("pending", "pending")).toBeNull();
  });

  it("never carries a status that belongs to one visit's own day", () => {
    expect(seriesStatusPatch("confirmed", "cancelled")).toBeNull();
    expect(seriesStatusPatch("confirmed", "completed")).toBeNull();
    expect(seriesStatusPatch("completed", "confirmed")).toBeNull();
    expect(seriesStatusPatch("en_route", "confirmed")).toBeNull();
    expect(seriesStatusPatch(undefined, "pending")).toBeNull();
  });
});

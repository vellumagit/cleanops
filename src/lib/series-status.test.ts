import { describe, expect, it } from "vitest";
import { rebuiltPendingIds, seriesStatusPatch } from "./series-status";

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

describe("rebuiltPendingIds", () => {
  const rebuilt = [
    { id: "c", scheduled_at: "2027-02-18T16:00:00.000Z" },
    { id: "a", scheduled_at: "2027-01-07T16:00:00.000Z" },
    { id: "b", scheduled_at: "2027-01-28T16:00:00.000Z" },
  ];

  it("Pending, this and all future: every rebuilt visit", () => {
    expect(rebuiltPendingIds("pending", ["confirmed", "confirmed"], rebuilt)).toEqual(["a", "b", "c"]);
  });

  it("Confirmed, this and all future: none", () => {
    expect(rebuiltPendingIds("confirmed", ["pending", "pending", "pending"], rebuilt)).toEqual([]);
  });

  it("no say: each takes the status of the visit it replaces, in date order", () => {
    expect(rebuiltPendingIds(null, ["confirmed", "pending", "pending"], rebuilt)).toEqual(["b", "c"]);
    expect(rebuiltPendingIds(null, ["confirmed", "confirmed", "confirmed"], rebuilt)).toEqual([]);
  });

  it("more new visits than old: the extra ones follow the last old visit", () => {
    expect(rebuiltPendingIds(null, ["confirmed", "pending"], rebuilt)).toEqual(["b", "c"]);
    expect(rebuiltPendingIds(null, ["pending", "confirmed"], rebuilt)).toEqual(["a"]);
  });

  it("nothing was replaced: nothing to carry", () => {
    expect(rebuiltPendingIds(null, [], rebuilt)).toEqual([]);
  });
});

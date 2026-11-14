import { describe, expect, it } from "vitest";
import { refusalKey, refusalMessage, refusalPath, summarizeRefusals, type RefusalRow } from "./refusal-log";

describe("refusalPath", () => {
  it("drops the query and folds ids, so one screen is one path", () => {
    expect(refusalPath("/app/bookings/ee5a9bf7-64cd-409a-b679-636855e8f5fe/edit?_return=%2Fapp")).toBe(
      "/app/bookings/:id/edit",
    );
    expect(refusalPath("/field/jobs")).toBe("/field/jobs");
  });
});

describe("refusalMessage", () => {
  it("is one bounded line", () => {
    expect(refusalMessage("  Olha is already\n booked then.  ")).toBe("Olha is already booked then.");
    expect(refusalMessage("x".repeat(900))).toHaveLength(600);
  });

  it("keeps nothing that is not a message", () => {
    expect(refusalMessage("")).toBeNull();
    expect(refusalMessage("ok")).toBeNull();
    expect(refusalMessage(undefined)).toBeNull();
    expect(refusalMessage(42)).toBeNull();
  });
});

describe("refusalKey", () => {
  it("the same refusal about different people and dates is one kind", () => {
    const a = refusalKey(
      "Olha Musnytska is already booked then: Nancy Whitson, Dec 4, 2026 · 9:00 AM. Nothing was changed. Pick someone else or another time, or move that job first.",
    );
    const b = refusalKey(
      "Vira Karpynska is already booked then: Emma Drebit, Jan 1, 2027 · 10:00 AM. Nothing was changed. Pick someone else or another time, or move that job first.",
    );
    expect(a).toBe(b);
  });

  it("different refusals are different kinds", () => {
    expect(refusalKey("Olga Musnytska is no longer active here, so can't be on a job's crew.")).not.toBe(
      refusalKey("Olha Musnytska is already booked then: Nancy Whitson, Dec 4, 2026 · 9:00 AM."),
    );
  });

  it("a short label is its own key", () => {
    expect(refusalKey("Not authorized.")).toBe("not authorized.");
  });
});

describe("summarizeRefusals", () => {
  const row = (message: string, over: Partial<RefusalRow> = {}): RefusalRow => ({
    message,
    path: "/app/bookings",
    created_at: "2026-11-14T20:18:11Z",
    membership_id: "svitlana",
    ...over,
  });

  it("counts each kind once, most frequent first", () => {
    const s = summarizeRefusals([
      row("Olga Musnytska is no longer active here, so can't be on a job's crew."),
      row("Olha Musnytska is already booked then: Nancy Whitson, Dec 4, 2026 · 9:00 AM. Nothing was changed."),
      row("Vira Karpynska is already booked then: Emma Drebit, Jan 1, 2027 · 10:00 AM. Nothing was changed."),
      row("Olha Musnytska is already booked then: Emma Drebit, Jan 15, 2027 · 10:00 AM. Nothing was changed."),
    ]);
    expect(s.total).toBe(4);
    expect(s.lines).toHaveLength(2);
    expect(s.lines[0]).toContain("×3");
    expect(s.lines[0]).toContain("already booked");
    expect(s.lines[1]).toContain("×1");
  });

  it("says where, and when it was more than one person", () => {
    const s = summarizeRefusals([
      row("Not authorized.", { path: "/app/timesheets" }),
      row("Not authorized.", { path: "/app/timesheets", membership_id: "olha" }),
    ]);
    expect(s.lines[0]).toContain("on /app/timesheets");
    expect(s.lines[0]).toContain("2 people");
  });

  it("an empty day is zero and no lines", () => {
    expect(summarizeRefusals([])).toEqual({ total: 0, lines: [] });
  });
});

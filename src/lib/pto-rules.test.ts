import { describe, expect, it } from "vitest";
import {
  statusAfterWorkerEdit,
  validatePtoFields,
  workerCanCancel,
  workerCanEdit,
} from "@/lib/pto-rules";

const TODAY = "2026-08-11";

describe("workerCanCancel", () => {
  it("allows cancelling a pending or approved future request", () => {
    expect(workerCanCancel("pending", "2026-08-20", TODAY)).toBe(true);
    expect(workerCanCancel("approved", "2026-08-20", TODAY)).toBe(true);
  });

  it("allows cancelling mid-leave — coming back early frees the remaining days", () => {
    // Leave runs Aug 10–14, today is the 11th: end_date is still ahead.
    expect(workerCanCancel("approved", "2026-08-14", TODAY)).toBe(true);
  });

  it("allows cancelling on the last day of the leave", () => {
    expect(workerCanCancel("approved", TODAY, TODAY)).toBe(true);
  });

  it("refuses once the request is entirely in the past", () => {
    expect(workerCanCancel("approved", "2026-08-10", TODAY)).toBe(false);
  });

  it("refuses declined and cancelled requests — nothing left to cancel", () => {
    expect(workerCanCancel("declined", "2026-08-20", TODAY)).toBe(false);
    expect(workerCanCancel("cancelled", "2026-08-20", TODAY)).toBe(false);
  });
});

describe("workerCanEdit", () => {
  it("allows reshaping a request that hasn't started", () => {
    expect(workerCanEdit("pending", "2026-08-12", TODAY)).toBe(true);
    expect(workerCanEdit("approved", TODAY, TODAY)).toBe(true);
  });

  it("refuses once the leave is underway — cancel is the honest edit then", () => {
    expect(workerCanEdit("approved", "2026-08-10", TODAY)).toBe(false);
  });

  it("refuses declined and cancelled requests", () => {
    expect(workerCanEdit("declined", "2026-08-20", TODAY)).toBe(false);
    expect(workerCanEdit("cancelled", "2026-08-20", TODAY)).toBe(false);
  });
});

describe("statusAfterWorkerEdit", () => {
  it("sends an approved request back to the manager's queue", () => {
    expect(statusAfterWorkerEdit("approved")).toBe("pending");
  });

  it("keeps a pending request pending", () => {
    expect(statusAfterWorkerEdit("pending")).toBe("pending");
  });
});

describe("validatePtoFields", () => {
  const ok = { start_date: "2026-08-17", end_date: "2026-08-24", hours: 8 };

  it("passes a sane request", () => {
    expect(validatePtoFields(ok)).toBeNull();
  });

  it("requires both dates", () => {
    expect(validatePtoFields({ ...ok, start_date: "" })).toMatch(/required/);
    expect(validatePtoFields({ ...ok, end_date: "" })).toMatch(/required/);
  });

  it("refuses an end before the start", () => {
    expect(
      validatePtoFields({ ...ok, end_date: "2026-08-16" }),
    ).toMatch(/on or after/);
  });

  it("bounds hours to (0, 200]", () => {
    expect(validatePtoFields({ ...ok, hours: 0 })).toMatch(/between/);
    expect(validatePtoFields({ ...ok, hours: 201 })).toMatch(/between/);
    expect(validatePtoFields({ ...ok, hours: NaN })).toMatch(/between/);
    expect(validatePtoFields({ ...ok, hours: 200 })).toBeNull();
  });
});

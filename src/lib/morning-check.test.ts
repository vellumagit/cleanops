import { describe, expect, it } from "vitest";
import { morningFlags } from "./morning-check";

const clean = {
  stateChecks: 0,
  disagreeingJobs: 0,
  digestMarked: true,
  longOpenClocks: 0,
  duplicateMessages: 0,
  readErrors: [],
};

describe("morningFlags", () => {
  it("a quiet night is clean", () => {
    expect(morningFlags(clean)).toEqual([]);
  });
  it("each thing the morning routine asks about raises its own flag", () => {
    expect(morningFlags({ ...clean, stateChecks: 1 })).toHaveLength(1);
    expect(morningFlags({ ...clean, disagreeingJobs: 2 })[0]).toMatch(/2 job/);
    expect(morningFlags({ ...clean, duplicateMessages: 1 })[0]).toMatch(/same person twice/);
    expect(morningFlags({ ...clean, longOpenClocks: 1 })[0]).toMatch(/on the clock/);
    expect(morningFlags({ ...clean, digestMarked: false })[0]).toMatch(/digest/);
  });
  it("a failed read is never clean, and comes first", () => {
    const f = morningFlags({ ...clean, stateChecks: 3, readErrors: ["notifications (timeout)"] });
    expect(f).toHaveLength(2);
    expect(f[0]).toMatch(/Could not read notifications/);
  });
});

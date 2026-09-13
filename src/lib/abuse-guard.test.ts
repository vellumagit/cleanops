import { describe, expect, it } from "vitest";
import { judgeAbuse } from "./abuse-guard";

const base = { ageDays: 0.3, isNew: true, clientsToday: 0, disposableClientsToday: 0, emailsToday: 0 };

describe("judgeAbuse", () => {
  it("a quiet new workspace is nothing", () => {
    expect(judgeAbuse({ ...base, clientsToday: 12, emailsToday: 3 }).level).toBe("none");
  });
  it("the Sep 11 spammer is hard on three counts", () => {
    const v = judgeAbuse({ ...base, clientsToday: 35423, disposableClientsToday: 0, emailsToday: 50 });
    expect(v.level).toBe("hard");
    expect(v.reasons.length).toBeGreaterThanOrEqual(2);
  });
  it("the Sep 13 probe is soft: nine clients, mostly throwaway, five emails", () => {
    // Under ten clients the disposable share doesn't count; five emails is under the soft line.
    expect(judgeAbuse({ ...base, clientsToday: 9, disposableClientsToday: 8, emailsToday: 5 }).level).toBe("none");
    // Twelve of those and it's soft.
    expect(judgeAbuse({ ...base, clientsToday: 12, disposableClientsToday: 10, emailsToday: 5 }).level).toBe("soft");
  });
  it("an established org importing a real list is soft, never hard", () => {
    const v = judgeAbuse({ ageDays: 120, isNew: false, clientsToday: 1500, disposableClientsToday: 0, emailsToday: 40 });
    expect(v.level).toBe("soft");
  });
  it("hard beats soft when both fire", () => {
    const v = judgeAbuse({ ...base, clientsToday: 120, emailsToday: 50 });
    expect(v.level).toBe("hard");
  });
});

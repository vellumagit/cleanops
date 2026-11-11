import { describe, expect, it } from "vitest";
import { readWorkHistory, workHistoryRefusal } from "./member-history";

describe("workHistoryRefusal", () => {
  it("lets someone with no history go", () => {
    expect(workHistoryRefusal("Anna", { shifts: 0, bonuses: 0 })).toBeNull();
  });

  it("names what would be lost, in the singular and the plural", () => {
    expect(workHistoryRefusal("Anna", { shifts: 1, bonuses: 0 })).toMatch(/^Anna has 1 recorded shift\. /);
    expect(workHistoryRefusal("Anna", { shifts: 212, bonuses: 3 })).toMatch(
      /^Anna has 212 recorded shifts and 3 bonuses\. /,
    );
    expect(workHistoryRefusal("Anna", { shifts: 0, bonuses: 1 })).toMatch(/^Anna has 1 bonus\. /);
  });

  it("points a stuck login at the way out that keeps her history", () => {
    const plain = workHistoryRefusal("Anna", { shifts: 4, bonuses: 0 });
    const stuck = workHistoryRefusal("Anna", { shifts: 4, bonuses: 0 }, { stuckLogin: true });
    expect(plain).not.toMatch(/recovery link/);
    expect(stuck).toMatch(/Generate recovery link/);
  });
});

describe("readWorkHistory", () => {
  const client = (result: (table: string) => { count: number | null; error: { message: string } | null }) =>
    ({
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          then: (resolve: (v: unknown) => void) => resolve(result(table)),
        };
        return chain;
      },
    }) as never;

  it("counts shifts and bonuses", async () => {
    const admin = client((t) => ({ count: t === "time_entries" ? 7 : 2, error: null }));
    await expect(readWorkHistory(admin, "org", "m1")).resolves.toEqual({ shifts: 7, bonuses: 2 });
  });

  it("throws when either read fails, so nothing is removed on a guess", async () => {
    for (const broken of ["time_entries", "bonuses"]) {
      const admin = client((t) =>
        t === broken ? { count: null, error: { message: "boom" } } : { count: 0, error: null },
      );
      await expect(readWorkHistory(admin, "org", "m1")).rejects.toThrow(/could not read work history/);
    }
  });
});

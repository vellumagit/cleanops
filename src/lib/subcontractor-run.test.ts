import { describe, expect, it } from "vitest";
import {
  groupEntriesForRun,
  runTotalCents,
  type RunnableEntry,
} from "@/lib/subcontractor-run";

const entry = (over: Partial<RunnableEntry>): RunnableEntry => ({
  id: "e1",
  employee_id: "olha",
  clock_in_at: "2026-08-03T15:00:00.000Z",
  clock_out_at: "2026-08-03T18:00:00.000Z", // 180 min
  pay_rate_cents_snapshot: null,
  booking: null,
  ...over,
});

const rates = (pairs: Array<[string, number | null]>) => new Map(pairs);

describe("groupEntriesForRun", () => {
  it("prices with the payroll precedence: booking → snapshot → member rate", () => {
    const items = groupEntriesForRun(
      [
        entry({ id: "a", booking: { hourly_rate_cents: 3000 } }), // 180m @ $30
        entry({ id: "b", pay_rate_cents_snapshot: 2400 }), // 180m @ $24
        entry({ id: "c" }), // 180m @ member $20
      ],
      rates([["olha", 2000]]),
    );
    expect(items).toHaveLength(1);
    expect(items[0].totalCents).toBe(9000 + 7200 + 6000);
    expect(items[0].minutes).toBe(540);
    expect(items[0].entryCount).toBe(3);
    expect(items[0].entryIds).toEqual(["a", "b", "c"]);
  });

  it("groups per subcontractor and sorts largest first", () => {
    const items = groupEntriesForRun(
      [
        entry({ id: "a", employee_id: "olha" }),
        entry({
          id: "b",
          employee_id: "marta",
          clock_out_at: "2026-08-03T16:00:00.000Z", // 60 min
        }),
      ],
      rates([
        ["olha", 2000],
        ["marta", 2500],
      ]),
    );
    expect(items.map((i) => i.membershipId)).toEqual(["olha", "marta"]);
    expect(items[0].totalCents).toBe(6000);
    expect(items[1].totalCents).toBe(2500);
  });

  it("drops zero-minute payees entirely — no item, no stamped entries", () => {
    const items = groupEntriesForRun(
      [
        entry({
          id: "z",
          clock_out_at: "2026-08-03T15:00:00.000Z", // 0 min
        }),
      ],
      rates([["olha", 2000]]),
    );
    expect(items).toHaveLength(0);
  });

  it("skips open entries and owners with no resolvable rate row", () => {
    const items = groupEntriesForRun(
      [
        entry({ id: "open", clock_out_at: null }),
        entry({ id: "stranger", employee_id: "ghost" }),
      ],
      rates([["olha", 2000]]),
    );
    expect(items).toHaveLength(0);
  });

  it("a NULL member rate still prices booking/snapshot entries, and floors the rest at 0", () => {
    const items = groupEntriesForRun(
      [
        entry({ id: "a", pay_rate_cents_snapshot: 2400 }),
        entry({ id: "b" }),
      ],
      rates([["olha", null]]),
    );
    expect(items[0].totalCents).toBe(7200);
    expect(items[0].entryIds).toEqual(["a", "b"]);
  });
});

describe("runTotalCents", () => {
  it("sums the items", () => {
    const items = groupEntriesForRun(
      [
        entry({ id: "a", employee_id: "olha" }),
        entry({ id: "b", employee_id: "marta" }),
      ],
      rates([
        ["olha", 2000],
        ["marta", 1000],
      ]),
    );
    expect(runTotalCents(items)).toBe(6000 + 3000);
  });
});

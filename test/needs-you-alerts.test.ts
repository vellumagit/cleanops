/**
 * Who the manager alerts reach. sendNeedsYouAlerts is all I/O, so the
 * database, the item list and notify are stubbed; what's under test is
 * the routing decision.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NeedsYouItem } from "@/lib/needs-you-items";

const notify = vi.fn(async (_input: Record<string, unknown>) => {});
let items: NeedsYouItem[] = [];

vi.mock("@/lib/notify", () => ({ notify: (input: Record<string, unknown>) => notify(input) }));
vi.mock("@/lib/needs-you", () => ({
  collectNeedsYou: async () => ({ items, tz: "America/Regina" }),
}));
vi.mock("@/lib/supabase/admin", () => {
  // Every chain resolves: one org, nothing marked sent, every mark sticks.
  const chain = (result: unknown): unknown =>
    new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "then"
            ? (resolve: (v: unknown) => void) => resolve(result)
            : () => chain(result),
      },
    );
  return {
    createSupabaseAdminClient: () => ({
      from: (table: string) =>
        table === "organizations"
          ? chain({ data: [{ id: "org", timezone: "America/Regina" }] })
          : chain({ data: [], error: null }),
    }),
  };
});

const { sendNeedsYouAlerts } = await import("@/lib/needs-you-alerts");

const item = (over: Partial<NeedsYouItem>): NeedsYouItem => ({
  key: "k",
  kind: "not_clocked_in",
  title: "t",
  body: "b",
  href: "/app",
  atMs: 0,
  actions: [],
  alert: true,
  ...over,
});

describe("manager alerts", () => {
  beforeEach(() => {
    notify.mockClear();
  });

  it("don't reach the manager the alert is about when she is told herself", async () => {
    items = [
      item({
        key: "late:b1:olha",
        title: "Olha hasn't clocked in",
        tell: { membershipId: "olha", title: "Chance Chopp started 30 min ago", body: "", href: "/field" },
      }),
    ];
    // Mid-morning, so the 6 PM digest stays out of it.
    await sendNeedsYouAlerts({ now: Date.parse("2026-10-28T15:30:00Z") });
    const managers = notify.mock.calls.map((c) => c[0]).find((i) => i.audience === "org-management");
    expect(managers?.title).toBe("Olha hasn't clocked in");
    expect(managers?.excludeMembershipId).toBe("olha");
    // And she still hears it, in her own words.
    const tell = notify.mock.calls.map((c) => c[0]).find((i) => i.audience === "membership");
    expect(tell?.membershipId).toBe("olha");
  });

  it("still reach every manager when nothing else tells the person", async () => {
    items = [item({ key: "over:e1", kind: "over_hours", title: "Olha is 1h past her hours" })];
    await sendNeedsYouAlerts({ now: Date.parse("2026-10-28T20:30:00Z") });
    const managers = notify.mock.calls.map((c) => c[0]).find((i) => i.audience === "org-management");
    expect(managers?.title).toBe("Olha is 1h past her hours");
    expect(managers?.excludeMembershipId).toBeUndefined();
  });
});

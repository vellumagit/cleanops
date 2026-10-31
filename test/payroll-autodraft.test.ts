/**
 * The morning pay-period notice has to mention hours with no pay rate, in
 * words that fit whether the period got prepared. Replays Nov 1, 2026 for
 * Oct 16-31. The database, preparing and notify are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.fn(async (_input: Record<string, unknown>) => {});
const prepare = vi.fn();
const gapsLoader = vi.fn();

vi.mock("@/lib/notify", () => ({ notify: (i: Record<string, unknown>) => notify(i) }));
vi.mock("@/lib/org-timezone", () => ({ getOrgTimezone: async () => "America/Regina" }));
vi.mock("@/lib/org-currency", () => ({ getOrgCurrency: async () => "CAD" }));
vi.mock("@/lib/pay-period", () => ({
  preparePayPeriod: (o: unknown) => prepare(o),
  periodHref: () => "/app/payroll/periods/x",
}));
vi.mock("@/lib/pay-rate-gaps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pay-rate-gaps")>()),
  loadRateGaps: () => gapsLoader(),
}));
vi.mock("@/lib/supabase/admin", () => {
  const chain = (result: unknown): unknown =>
    new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "then" ? (resolve: (v: unknown) => void) => resolve(result) : () => chain(result),
      },
    );
  return {
    createSupabaseAdminClient: () => ({
      from: (table: string) => {
        if (table === "organizations") {
          return chain({ data: [{ id: "org", pay_schedule: "semimonthly", pay_anchor: null }] });
        }
        if (table === "memberships") return chain({ data: [{ id: "owner", role: "owner" }] });
        return chain({ count: 0, data: [] });
      },
    }),
  };
});

const { runPayrollAutodraft } = await import("@/lib/payroll-autodraft");

const GAPS = [
  { membershipId: "i", name: "Iryna Ilin", minutes: 612 },
  { membershipId: "a", name: "Alona Smirnova", minutes: 540 },
];

describe("the morning pay-period notice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T13:00:00Z"));
    notify.mockClear();
    prepare.mockReset();
    gapsLoader.mockReset();
    gapsLoader.mockResolvedValue(GAPS);
  });

  it("when blocked on a flag, says to set the rates while there's still time", async () => {
    prepare.mockResolvedValue({ ok: false, error: "flagged", flagged: 1 });
    expect(await runPayrollAutodraft()).toEqual({ prepared: 0, blocked: 1 });
    const note = notify.mock.calls[0][0];
    expect(note.title).toBe("Payroll is waiting on flagged shifts");
    expect(note.body).toContain("Iryna Ilin (10.2h) and Alona Smirnova (9.0h)");
    expect(note.body).toContain("before this period is prepared");
    expect(note.channels).toEqual({ email: true });
  });

  it("when prepared, says those hours are at $0 and how to fix it", async () => {
    prepare.mockResolvedValue({
      ok: true,
      href: "/x",
      payroll: null,
      contractor: { id: "r", totalCents: 282213 },
    });
    expect(await runPayrollAutodraft()).toEqual({ prepared: 1, blocked: 0 });
    const note = notify.mock.calls[0][0];
    expect(note.title).toBe("Pay period ready for review");
    expect(note.body).toContain("on this period at $0");
    expect(note.body).toContain("prepare the period again");
    expect(note.channels).toEqual({ email: true });
  });

  it("says nothing extra when everyone has a rate", async () => {
    gapsLoader.mockResolvedValue([]);
    prepare.mockResolvedValue({ ok: true, href: "/x", payroll: null, contractor: { id: "r", totalCents: 100 } });
    await runPayrollAutodraft();
    expect(String(notify.mock.calls[0][0].body)).not.toContain("pay rate");
  });

  it("still prepares the period when the rate check fails", async () => {
    gapsLoader.mockRejectedValue(new Error("connection reset"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    prepare.mockResolvedValue({ ok: true, href: "/x", payroll: null, contractor: { id: "r", totalCents: 100 } });
    expect(await runPayrollAutodraft()).toEqual({ prepared: 1, blocked: 0 });
    errors.mockRestore();
  });
});

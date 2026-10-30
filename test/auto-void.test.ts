/**
 * Auto-void writes off money. With the toggle off it must not touch a single
 * invoice, and with it on every void is logged and announced. The database and
 * notify are stubbed; what's under test is that decision.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.fn(async (_input: Record<string, unknown>) => {});
const audit = vi.fn(async (_input: Record<string, unknown>) => {});
const invoiceUpdates = vi.fn();

let org: {
  id: string;
  invoice_void_days: number | null;
  timezone: string;
  automations_enabled: boolean;
  automation_settings: Record<string, { enabled?: boolean }>;
};
let matched: Array<{ id: string; number: string; amount_cents: number }> = [];

vi.mock("@/lib/notify", () => ({ notify: (input: Record<string, unknown>) => notify(input) }));
vi.mock("@/lib/audit", () => ({
  logSystemAuditEvent: (input: Record<string, unknown>) => audit(input),
}));
vi.mock("@/lib/supabase/admin", () => {
  // Every chain resolves to its table's result.
  const chain = (result: () => unknown, onUpdate?: () => void): unknown =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve(result());
          }
          if (prop === "maybeSingle") return async () => result();
          return () => {
            if (prop === "update") onUpdate?.();
            return chain(result, onUpdate);
          };
        },
      },
    );
  return {
    createSupabaseAdminClient: () => ({
      from: (table: string) => {
        if (table === "invoices") {
          return chain(() => ({ data: matched, error: null }), invoiceUpdates);
        }
        // The org list wants an array; the automation gate wants one row.
        return new Proxy(
          {},
          {
            get: (_t, prop) => {
              if (prop === "select") {
                return (columns: string) =>
                  columns.includes("automation_settings")
                    ? chain(() => ({ data: org, error: null }))
                    : chain(() => ({ data: [org], error: null }));
              }
              return () => chain(() => ({ data: null, error: null }));
            },
          },
        );
      },
    }),
  };
});

const { autoVoidOldInvoices } = await import("@/lib/automations");

describe("auto-void", () => {
  beforeEach(() => {
    notify.mockClear();
    audit.mockClear();
    invoiceUpdates.mockClear();
    matched = [
      { id: "i1", number: "INV-1", amount_cents: 14000 },
      { id: "i2", number: "INV-2", amount_cents: 22050 },
    ];
    org = {
      id: "org",
      invoice_void_days: 365,
      timezone: "America/Regina",
      automations_enabled: true,
      automation_settings: { auto_void_overdue_invoices: { enabled: true } },
    };
  });

  it("touches nothing when the toggle is off", async () => {
    org.automation_settings = { auto_void_overdue_invoices: { enabled: false } };
    expect(await autoVoidOldInvoices()).toEqual({ voided: 0 });
    expect(invoiceUpdates).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("touches nothing when the org never set the toggle", async () => {
    org.automation_settings = {};
    expect(await autoVoidOldInvoices()).toEqual({ voided: 0 });
    expect(invoiceUpdates).not.toHaveBeenCalled();
  });

  it("touches nothing when the days are blank", async () => {
    org.invoice_void_days = null;
    expect(await autoVoidOldInvoices()).toEqual({ voided: 0 });
    expect(invoiceUpdates).not.toHaveBeenCalled();
  });

  it("logs every void and tells owners and admins once when on", async () => {
    expect(await autoVoidOldInvoices()).toEqual({ voided: 2 });
    expect(audit.mock.calls.map((c) => c[0].entity_id)).toEqual(["i1", "i2"]);
    expect(audit.mock.calls[0][0].after).toEqual({
      status: "void",
      via: "auto_void_overdue_invoices",
      days: 365,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    const note = notify.mock.calls[0][0];
    expect(note.audience).toBe("org-admins");
    expect(note.title).toBe("2 unpaid invoices were voided automatically");
    expect(String(note.body)).toContain("INV-1");
    expect(String(note.body)).toContain("365 days");
  });

  it("says nothing on a night with nothing to void", async () => {
    matched = [];
    expect(await autoVoidOldInvoices()).toEqual({ voided: 0 });
    expect(notify).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Query = {
  table: string;
  operation: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  selection?: string;
  selectOptions?: Record<string, unknown>;
  eq: Record<string, unknown>;
  is: Record<string, unknown>;
  in: Record<string, unknown>;
};

const mocks = vi.hoisted(() => ({
  calls: [] as Query[],
  respond: (query: Query): unknown => ({ data: null, error: null, table: query.table }),
  coverage: vi.fn(),
  notify: vi.fn(async () => {}),
  classifyJob: vi.fn(),
  lateStarters: vi.fn(),
  orgUsesClockIn: vi.fn(),
  saidForThisSchedule: vi.fn(),
  autoCompleteDue: vi.fn(),
  syncJob: vi.fn(async () => {}),
  clientNotify: vi.fn(async () => ({ email: false, sms: false, clientPhone: null })),
  sendOrgEmail: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      const query: Query = {
        table,
        operation: "select",
        eq: {},
        is: {},
        in: {},
      };
      const builder: Record<string, unknown> = {};
      const execute = () => {
        const snapshot = structuredClone(query);
        mocks.calls.push(snapshot);
        return Promise.resolve(mocks.respond(snapshot));
      };
      builder.select = (selection: string, options?: Record<string, unknown>) => {
        query.selection = selection;
        query.selectOptions = options;
        return builder;
      };
      builder.insert = (payload: unknown) => {
        query.operation = "insert";
        query.payload = payload;
        return builder;
      };
      builder.update = (payload: unknown) => {
        query.operation = "update";
        query.payload = payload;
        return builder;
      };
      builder.delete = () => {
        query.operation = "delete";
        return builder;
      };
      builder.eq = (column: string, value: unknown) => {
        query.eq[column] = value;
        return builder;
      };
      builder.is = (column: string, value: unknown) => {
        query.is[column] = value;
        return builder;
      };
      builder.in = (column: string, value: unknown) => {
        query.in[column] = value;
        return builder;
      };
      for (const method of ["not", "lt", "lte", "gte", "order", "limit"]) {
        builder[method] = () => builder;
      }
      builder.upsert = (payload: unknown) => {
        query.operation = "insert";
        query.payload = payload;
        return builder;
      };
      builder.maybeSingle = execute;
      builder.single = execute;
      builder.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        execute().then(resolve, reject);
      return builder;
    },
  }),
}));

vi.mock("@/lib/notify", () => ({ notify: mocks.notify }));
vi.mock("@/lib/push", () => ({
  sendPushToMembership: vi.fn(),
  sendPushToOrgAdmins: vi.fn(),
}));
vi.mock("@/lib/notification-gate", () => ({
  resolveClientNotify: mocks.clientNotify,
}));
vi.mock("@/lib/email", () => ({
  sendOrgEmail: mocks.sendOrgEmail,
  isInvoiceEmailUnpaused: vi.fn(() => true),
}));
vi.mock("@/lib/email-templates", () => ({
  paymentReceiptEmail: vi.fn(() => ({ subject: "Receipt", html: "Receipt" })),
  reviewRequestEmail: vi.fn(() => ({ subject: "Review", html: "Review" })),
}));
vi.mock("@/lib/org-currency", () => ({
  getOrgCurrency: vi.fn(async () => "CAD"),
}));
vi.mock("@/lib/claim-token", () => ({
  generateClaimToken: vi.fn(() => "claim-token"),
}));
vi.mock("@/lib/automation-defaults", () => ({
  resolveAutomationEnabled: vi.fn(() => true),
}));
vi.mock("@/lib/series-crew", () => ({
  crewForGeneration: vi.fn(),
  splitsFromCrew: vi.fn(),
}));
vi.mock("@/lib/org-timezone", () => ({
  getOrgTimezone: vi.fn(async () => "UTC"),
}));
vi.mock("@/lib/wall-clock", () => ({
  zonedYmd: vi.fn((date: Date) => date.toISOString().slice(0, 10)),
}));
vi.mock("@/lib/invoice-line-label", () => ({
  bookingLineLabel: vi.fn(() => "House cleaning"),
}));
vi.mock("@/lib/booking-prepayments", () => ({
  applyPrepaymentsToInvoice: vi.fn(async () => {}),
}));
vi.mock("@/lib/invoice-send", () => ({
  scheduleAutoSendIfEnabled: vi.fn(async () => {}),
}));
vi.mock("@/lib/booking-coverage", () => ({
  resolveBookingCoverage: mocks.coverage,
}));
vi.mock("@/lib/supabase/chunked-in", () => ({
  selectInChunks: async (
    ids: string[],
    select: (chunk: string[]) => PromiseLike<unknown>,
  ) => select(ids),
}));
vi.mock("@/lib/job-state", () => ({
  jobWindowEndMs: vi.fn(() => Date.now()),
}));
vi.mock("@/lib/job-watch", () => ({
  classifyJob: mocks.classifyJob,
  lateStarters: mocks.lateStarters,
  orgUsesClockIn: mocks.orgUsesClockIn,
  saidForThisSchedule: mocks.saidForThisSchedule,
  autoCompleteDue: mocks.autoCompleteDue,
}));
vi.mock("@/lib/format", () => ({
  formatDateTime: vi.fn((value: string) => value),
  formatCurrencyCents: vi.fn((amount: number) => String(amount)),
}));
vi.mock("@/lib/job-sync", () => ({ syncJob: mocks.syncJob }));

const {
  autoCompletePastBookings,
  autoGenerateRecurringInvoices,
  autoInvoiceOnJobComplete,
  autoOnInvoicePaid,
  runJobWatch,
} = await import("@/lib/automations");

const booking = {
  id: "booking-1",
  organization_id: "org-1",
  client_id: "client-1",
  status: "completed",
  total_cents: 14_000,
  service_type: "standard",
  service_type_label: "House cleaning",
  address: "123 Main Street",
  duration_minutes: 120,
  scheduled_at: "2026-11-07T16:00:00.000Z",
  billing_invoice_id: null,
  billing_released_at: null,
  client: { address: "123 Main Street" },
  property: null,
};

const invoice = { id: "invoice-1", number: "INV-2026-0001" };
const automationSettings = {
  data: { automation_settings: {}, automations_enabled: true },
  error: null,
};

function installInvoiceResponder(options: { lineError?: string } = {}) {
  mocks.respond = (query) => {
    if (query.table === "bookings" && query.operation === "select") {
      return { data: booking, error: null };
    }
    if (query.table === "clients") {
      return { data: { billing_cadence: "on_demand" }, error: null };
    }
    if (
      query.table === "organizations" &&
      query.selection?.includes("automation_settings")
    ) {
      return automationSettings;
    }
    if (query.table === "organizations") return { data: null, error: null };
    if (query.table === "invoices" && query.operation === "select") {
      return { data: null, error: null };
    }
    if (query.table === "invoices" && query.operation === "insert") {
      return { data: invoice, error: null };
    }
    if (query.table === "invoice_line_items" && query.operation === "select") {
      return { data: [], error: null };
    }
    if (query.table === "invoice_line_items" && query.operation === "insert") {
      return { data: null, error: options.lineError ? { message: options.lineError } : null };
    }
    return { data: null, error: null };
  };
}

function installAutoCompleteResponder(
  options: { statusError?: string; openShift?: boolean; staffed?: boolean } = {},
) {
  const candidate = {
    id: booking.id,
    scheduled_at: "2026-11-07T10:00:00.000Z",
    duration_minutes: 60,
    divide_hours_evenly: false,
    client: { name: "Client One" },
  };
  mocks.coverage.mockResolvedValue(
    new Map([
      [
        booking.id,
        {
          staffed: options.staffed !== false,
          employeeIds: options.staffed === false ? [] : ["member-1"],
          segments: [],
        },
      ],
    ]),
  );
  mocks.autoCompleteDue.mockReturnValue(true);
  mocks.respond = (query) => {
    if (query.table === "organizations" && query.selection === "id, booking_auto_complete_hours") {
      return { data: [{ id: "org-1", booking_auto_complete_hours: 1 }], error: null };
    }
    if (
      query.table === "organizations" &&
      query.selection?.includes("automation_settings")
    ) {
      return automationSettings;
    }
    if (query.table === "bookings" && query.operation === "select") {
      if (query.eq.status === "pending") return { data: [], error: null };
      if (Array.isArray(query.in.status)) return { data: [candidate], error: null };
      return { data: booking, error: null };
    }
    if (query.table === "time_entries") {
      return {
        data: options.openShift ? [{ booking_id: booking.id }] : [],
        error: null,
      };
    }
    if (query.table === "bookings" && query.operation === "update") {
      return options.statusError
        ? { data: null, error: { message: options.statusError } }
        : { data: [{ id: booking.id }], error: null };
    }
    if (query.table === "clients") return { data: { billing_cadence: "on_demand" }, error: null };
    if (query.table === "invoices" && query.operation === "select") {
      return { data: null, error: null };
    }
    if (query.table === "invoices" && query.operation === "insert") {
      return { data: invoice, error: null };
    }
    if (query.table === "invoice_line_items" && query.operation === "select") {
      return { data: [], error: null };
    }
    if (query.table === "invoice_line_items" && query.operation === "insert") {
      return { data: null, error: null };
    }
    return { data: null, error: null };
  };
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.notify.mockClear();
  mocks.syncJob.mockClear();
  mocks.coverage.mockReset();
  mocks.classifyJob.mockReset();
  mocks.lateStarters.mockReset();
  mocks.orgUsesClockIn.mockReset();
  mocks.saidForThisSchedule.mockReset();
  mocks.autoCompleteDue.mockReset();
  mocks.clientNotify.mockReset();
  mocks.clientNotify.mockResolvedValue({ email: false, sms: false, clientPhone: null });
  mocks.sendOrgEmail.mockReset();
  mocks.sendOrgEmail.mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("autoInvoiceOnJobComplete", () => {
  it("does not invoice a booking that is not completed", async () => {
    installInvoiceResponder();
    mocks.respond = (query) =>
      query.table === "bookings" && query.operation === "select"
        ? { data: { ...booking, status: "confirmed" }, error: null }
        : { data: null, error: null };

    await expect(autoInvoiceOnJobComplete(booking.id)).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("not completed"),
    });
    expect(mocks.calls.some((query) => query.table === "invoices" && query.operation === "insert")).toBe(false);
  });

  it("removes a draft when its line insert fails and never stamps the booking billed", async () => {
    installInvoiceResponder({ lineError: "line insert rejected" });

    await expect(autoInvoiceOnJobComplete(booking.id)).resolves.toMatchObject({
      ok: false,
      reason: "Line item failed: line insert rejected",
    });

    const lineInsert = mocks.calls.findIndex(
      (query) => query.table === "invoice_line_items" && query.operation === "insert",
    );
    const draftDelete = mocks.calls.findIndex(
      (query) => query.table === "invoices" && query.operation === "delete",
    );
    expect(lineInsert).toBeGreaterThanOrEqual(0);
    expect(draftDelete).toBeGreaterThan(lineInsert);
    expect(
      mocks.calls.some(
        (query) =>
          query.table === "bookings" &&
          query.operation === "update" &&
          (query.payload as { billing_invoice_id?: string })?.billing_invoice_id,
      ),
    ).toBe(false);
  });

  it("returns an existing invoice instead of creating a duplicate", async () => {
    installInvoiceResponder();
    const existing = { id: "existing-invoice", number: "INV-2026-0000" };
    mocks.respond = (query) => {
      if (query.table === "bookings" && query.operation === "select") {
        return { data: booking, error: null };
      }
      if (query.table === "clients") {
        return { data: { billing_cadence: "on_demand" }, error: null };
      }
      if (query.table === "organizations" && query.selection?.includes("automation_settings")) {
        return automationSettings;
      }
      if (query.table === "invoices" && query.operation === "select") {
        return { data: existing, error: null };
      }
      return { data: null, error: null };
    };

    await expect(autoInvoiceOnJobComplete(booking.id)).resolves.toMatchObject({
      ok: true,
      invoiceId: existing.id,
    });
    expect(mocks.calls.some((query) => query.table === "invoices" && query.operation === "insert")).toBe(false);
  });

  it("writes the line before stamping a successfully invoiced booking", async () => {
    installInvoiceResponder();

    await expect(autoInvoiceOnJobComplete(booking.id)).resolves.toMatchObject({
      ok: true,
      invoiceId: invoice.id,
    });

    const lineInsert = mocks.calls.findIndex(
      (query) => query.table === "invoice_line_items" && query.operation === "insert",
    );
    const billedStamp = mocks.calls.findIndex(
      (query) =>
        query.table === "bookings" &&
        query.operation === "update" &&
        (query.payload as { billing_invoice_id?: string })?.billing_invoice_id === invoice.id,
    );
    expect(lineInsert).toBeGreaterThanOrEqual(0);
    expect(billedStamp).toBeGreaterThan(lineInsert);
  });
});

describe("autoOnInvoicePaid", () => {
  it("does not resend receipts or review requests when another caller won the claim", async () => {
    mocks.clientNotify.mockResolvedValue({ email: true, sms: false, clientPhone: null });
    mocks.respond = (query) => {
      if (query.table === "organizations" && query.selection?.includes("automation_settings")) {
        return automationSettings;
      }
      if (query.table === "invoices" && query.operation === "select") {
        if (query.selection?.includes("number, organization_id")) {
          return {
            data: {
              id: invoice.id,
              number: invoice.number,
              organization_id: "org-1",
              amount_cents: 14_000,
              public_token: "public-token",
              paid_at: "2026-11-07T10:00:00.000Z",
              booking_id: booking.id,
              client: { id: "client-1", name: "Client One", email: "client@example.test" },
            },
            error: null,
          };
        }
      }
      if (query.table === "invoices" && query.operation === "update") {
        return { data: [], error: null };
      }
      return { data: null, error: null };
    };

    await expect(autoOnInvoicePaid(invoice.id)).resolves.toBeUndefined();
    expect(mocks.sendOrgEmail).not.toHaveBeenCalled();
    expect(mocks.calls.filter(
      (query) => query.table === "invoices" && query.operation === "update",
    )).toHaveLength(1);
  });
});

describe("autoGenerateRecurringInvoices", () => {
  it("removes a draft and releases the series claim when its lines fail", async () => {
    const nextRunAt = "2026-11-01T10:00:00.000Z";
    const series = {
      id: "series-1",
      organization_id: "org-1",
      client_id: "client-1",
      name: "Weekly service",
      cadence: "weekly",
      amount_cents: 8_000,
      line_items: [{ label: "Weekly service", quantity: 1, unit_price_cents: 8_000 }],
      notes: null,
      next_run_at: nextRunAt,
      due_days: 14,
    };
    mocks.respond = (query) => {
      if (query.table === "invoice_series" && query.operation === "select") {
        return { data: [series], error: null };
      }
      if (query.table === "organizations" && query.selection?.includes("automation_settings")) {
        return automationSettings;
      }
      if (query.table === "invoice_series" && query.operation === "update") {
        return { data: [{ id: series.id }], error: null };
      }
      if (query.table === "clients") return { data: { name: "Client One", billing_cadence: "on_demand" }, error: null };
      if (query.table === "invoices" && query.operation === "insert") {
        return { data: invoice, error: null };
      }
      if (query.table === "invoice_line_items" && query.operation === "insert") {
        return { data: null, error: { message: "line insert rejected" } };
      }
      return { data: null, error: null };
    };

    await expect(autoGenerateRecurringInvoices()).resolves.toEqual({ generated: 0 });

    expect(mocks.calls.some((query) => query.table === "invoices" && query.operation === "delete")).toBe(true);
    expect(
      mocks.calls.some(
        (query) =>
          query.table === "invoice_series" &&
          query.operation === "update" &&
          (query.payload as { next_run_at?: string })?.next_run_at === nextRunAt,
      ),
    ).toBe(true);
    expect(
      mocks.calls.some(
        (query) =>
          query.table === "invoice_series" &&
          query.operation === "update" &&
          (query.payload as { last_invoice_id?: string })?.last_invoice_id === invoice.id,
      ),
    ).toBe(false);
  });

  it("does not create an invoice when another run already claimed the period", async () => {
    const series = {
      id: "series-1",
      organization_id: "org-1",
      client_id: "client-1",
      name: "Weekly service",
      cadence: "weekly",
      amount_cents: 8_000,
      line_items: [],
      notes: null,
      next_run_at: "2026-11-01T10:00:00.000Z",
      due_days: 14,
    };
    mocks.respond = (query) => {
      if (query.table === "invoice_series" && query.operation === "select") {
        return { data: [series], error: null };
      }
      if (query.table === "organizations" && query.selection?.includes("automation_settings")) {
        return automationSettings;
      }
      if (query.table === "invoice_series" && query.operation === "update") {
        return { data: [], error: null };
      }
      return { data: null, error: null };
    };

    await expect(autoGenerateRecurringInvoices()).resolves.toEqual({ generated: 0 });
    expect(mocks.calls.some((query) => query.table === "invoices" && query.operation === "insert")).toBe(false);
  });
});

describe("autoCompletePastBookings", () => {
  it("does not invoice when the booking status update fails", async () => {
    installAutoCompleteResponder({ statusError: "booking update rejected" });

    await expect(autoCompletePastBookings()).resolves.toEqual({ completed: 0 });
    expect(mocks.calls.some((query) => query.table === "invoices" && query.operation === "insert")).toBe(false);
    expect(mocks.syncJob).not.toHaveBeenCalled();
  });

  it("leaves unstaffed past bookings untouched", async () => {
    installAutoCompleteResponder({ staffed: false });

    await expect(autoCompletePastBookings()).resolves.toEqual({ completed: 0 });
    expect(
      mocks.calls.some(
        (query) =>
          query.table === "bookings" &&
          query.operation === "update" &&
          (query.payload as { status?: string })?.status === "completed",
      ),
    ).toBe(false);
    expect(mocks.calls.some((query) => query.table === "invoices" && query.operation === "insert")).toBe(false);
  });

  it("does not close a booking while someone is still clocked in", async () => {
    installAutoCompleteResponder({ openShift: true });

    await expect(autoCompletePastBookings()).resolves.toEqual({ completed: 0 });
    expect(
      mocks.calls.some(
        (query) =>
          query.table === "bookings" &&
          query.operation === "update" &&
          (query.payload as { status?: string })?.status === "completed",
      ),
    ).toBe(false);
    expect(mocks.calls.some((query) => query.table === "invoices" && query.operation === "insert")).toBe(false);
  });

  it("completes successfully before attempting invoice creation", async () => {
    installAutoCompleteResponder();

    await expect(autoCompletePastBookings()).resolves.toEqual({ completed: 1 });
    const statusUpdate = mocks.calls.findIndex(
      (query) =>
        query.table === "bookings" &&
        query.operation === "update" &&
        (query.payload as { status?: string })?.status === "completed",
    );
    const invoiceInsert = mocks.calls.findIndex(
      (query) => query.table === "invoices" && query.operation === "insert",
    );
    expect(statusUpdate).toBeGreaterThanOrEqual(0);
    expect(invoiceInsert).toBeGreaterThan(statusUpdate);
    expect(mocks.syncJob).toHaveBeenCalledWith(booking.id, "nightly_sweep");
  });
});

describe("runJobWatch", () => {
  it("rejects a failed clock-evidence read before writing flags or sending alerts", async () => {
    const candidate = {
      id: booking.id,
      organization_id: "org-1",
      scheduled_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      duration_minutes: 30,
      status: "confirmed",
      assigned_to: "member-1",
      no_show_nudge_sent_at: null,
      no_clock_in_flagged_at: null,
      divide_hours_evenly: false,
      created_at: new Date(Date.now() - 60 * 60_000).toISOString(),
      client: { name: "Client One" },
    };
    mocks.coverage.mockResolvedValue(
      new Map([[booking.id, { staffed: true, employeeIds: ["member-1"], segments: [] }]]),
    );
    mocks.respond = (query) => {
      if (query.table === "bookings" && query.operation === "select") {
        return { data: [candidate], error: null };
      }
      if (query.table === "time_entries") {
        return { data: null, error: { message: "time entry query failed" } };
      }
      return { data: null, error: null };
    };

    await expect(runJobWatch()).rejects.toThrow("clock-in evidence query failed");
    expect(mocks.calls.some((query) => query.operation === "update")).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("nudges only the split-shift member whose start is late, and remembers the nudge", async () => {
    const now = new Date("2026-11-07T09:20:00.000Z");
    const scheduledAt = "2026-11-07T09:00:00.000Z";
    const candidate = {
      id: booking.id,
      organization_id: "org-1",
      scheduled_at: scheduledAt,
      duration_minutes: 240,
      status: "confirmed",
      assigned_to: null,
      no_show_nudge_sent_at: null,
      no_clock_in_flagged_at: null,
      divide_hours_evenly: false,
      created_at: "2026-11-07T08:00:00.000Z",
      client: { name: "Client One" },
    };
    const remembered = new Map<string, string>();
    mocks.coverage.mockResolvedValue(
      new Map([
        [
          booking.id,
          {
            staffed: true,
            employeeIds: ["member-a", "member-b"],
            segments: [
              { membership_id: "member-a", split_start_offset_minutes: 0 },
              { membership_id: "member-b", split_start_offset_minutes: 120 },
            ],
          },
        ],
      ]),
    );
    mocks.classifyJob.mockReturnValue({ kind: "late_start" });
    mocks.orgUsesClockIn.mockReturnValue(true);
    mocks.lateStarters.mockImplementation(({ scheduledAtMs, crew, nowMs }) =>
      crew
        .map((person: { membershipId: string; startOffsetMinutes: number | null }) => ({
          membershipId: person.membershipId,
          dueAtMs: scheduledAtMs + (person.startOffsetMinutes ?? 0) * 60_000 + 15 * 60_000,
        }))
        .filter((person: { dueAtMs: number }) => person.dueAtMs <= nowMs),
    );
    mocks.saidForThisSchedule.mockImplementation(
      (notifiedAt: string | null, scheduleAtMs: number) =>
        Boolean(notifiedAt && new Date(notifiedAt).getTime() >= scheduleAtMs),
    );
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.respond = (query) => {
      if (query.table === "bookings" && query.operation === "select") {
        return { data: [candidate], error: null };
      }
      if (query.table === "time_entries" && query.selectOptions?.count === "exact") {
        return { data: null, count: 1, error: null };
      }
      if (query.table === "time_entries") return { data: [], error: null };
      if (query.table === "organizations" && query.selection?.includes("automation_settings")) {
        return automationSettings;
      }
      if (query.table === "needs_you_state" && query.operation === "select") {
        return {
          data: [...remembered].map(([key, notified_at]) => ({ key, notified_at })),
          error: null,
        };
      }
      if (query.table === "needs_you_state" && query.operation === "insert") {
        const row = query.payload as { key: string; notified_at: string };
        remembered.set(row.key, row.notified_at);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };

    await expect(runJobWatch()).resolves.toMatchObject({ nudged: 1, flagged: 0 });
    await expect(runJobWatch()).resolves.toMatchObject({ nudged: 0, flagged: 0 });

    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ membershipId: "member-a", audience: "membership" }),
    );
    expect(mocks.calls.filter(
      (query) => query.table === "needs_you_state" && query.operation === "insert",
    )).toHaveLength(1);
  });
});

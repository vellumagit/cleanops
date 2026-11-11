import { describe, it, expect, vi } from "vitest";
import {
  noteBilled,
  billableInSweep,
  matchLineToJob,
  releaseJobsFromVoidedInvoices,
  removalReleasesJobs,
  jobsBilledByInvoices,
  markJobsReleased,
  type BilledBy,
} from "./billed-bookings";

const inv = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "inv1",
  number: 64,
  status: "sent",
  amount_cents: 14175,
  ...over,
});

describe("noteBilled", () => {
  it("records the invoice billing a booking", () => {
    const m = new Map<string, BilledBy>();
    noteBilled(m, "bk1", inv());
    expect(m.get("bk1")).toEqual({
      id: "inv1",
      number: 64,
      status: "sent",
      amountCents: 14175,
    });
  });

  it("IGNORES voided invoices — voiding is how you free a job to be rebilled", () => {
    const m = new Map<string, BilledBy>();
    noteBilled(m, "bk1", inv({ status: "void" }));
    expect(m.has("bk1")).toBe(false);
  });

  it("first writer wins, so the three signals can't fight", () => {
    // invoices.booking_id is read first, then line items, then the stamp.
    // A booking reachable by all three must resolve to ONE answer.
    const m = new Map<string, BilledBy>();
    noteBilled(m, "bk1", inv({ id: "first" }));
    noteBilled(m, "bk1", inv({ id: "second" }));
    noteBilled(m, "bk1", inv({ id: "third" }));
    expect(m.get("bk1")?.id).toBe("first");
  });

  it("a void first does not block a real invoice found later", () => {
    // The void is skipped entirely rather than claiming the slot — otherwise
    // a voided invoice would mask a live one and the job would read unbilled.
    const m = new Map<string, BilledBy>();
    noteBilled(m, "bk1", inv({ id: "voided", status: "void" }));
    noteBilled(m, "bk1", inv({ id: "real" }));
    expect(m.get("bk1")?.id).toBe("real");
  });

  it("skips null bookings and null invoices without throwing", () => {
    const m = new Map<string, BilledBy>();
    noteBilled(m, null, inv());
    noteBilled(m, undefined, inv());
    noteBilled(m, "bk1", null);
    expect(m.size).toBe(0);
  });

  it("treats a missing amount as zero rather than NaN", () => {
    const m = new Map<string, BilledBy>();
    noteBilled(m, "bk1", inv({ amount_cents: null }));
    expect(m.get("bk1")?.amountCents).toBe(0);
  });

  it("keeps a draft distinguishable from a sent invoice", () => {
    // The consolidate panel decides whether a job can be folded in based on
    // this status — a draft can, a sent one must be left alone.
    const m = new Map<string, BilledBy>();
    noteBilled(m, "bk1", inv({ status: "draft" }));
    expect(m.get("bk1")?.status).toBe("draft");
  });
});

describe("billableInSweep", () => {
  const billed = new Map<string, BilledBy>([
    ["on-invoice", { id: "i", number: 1, status: "sent", amountCents: 100 }],
  ]);

  it("keeps only work nobody has billed or voided", () => {
    const rows = [
      { id: "new", billing_released_at: null },
      { id: "voided", billing_released_at: "2026-10-29T20:21:00Z" },
      { id: "on-invoice", billing_released_at: null },
    ];
    expect(billableInSweep(rows, billed).map((r) => r.id)).toEqual(["new"]);
  });
});

describe("matchLineToJob", () => {
  const TZ = "America/Regina";
  const job = (id: string, scheduled_at: string, total_cents: number | null = 14700) => ({
    id,
    scheduled_at,
    total_cents,
  });
  const line = (label: string, over: Partial<{ quantity: number; unit_price_cents: number }> = {}) => ({
    label,
    quantity: 1,
    unit_price_cents: 14700,
    ...over,
  });
  // INV-2026-0312's real hand-added line. It says 10:30; the job moved to 1:30.
  const oct15 = "Standard clean · Thu, Oct 15, 2026, 10:30 AM–2:30 PM · Main address · 903 Proctor Wynd NW";

  it("links on date and price, not time", () => {
    expect(matchLineToJob(line(oct15), [job("a", "2026-10-15T19:30:00Z")], TZ)).toBe("a");
  });

  it("doesn't read Oct 1 out of Oct 15", () => {
    expect(matchLineToJob(line(oct15), [job("oct1", "2026-10-01T16:30:00Z")], TZ)).toBeNull();
  });

  it("uses the org's day, not UTC's", () => {
    // 8 PM Thursday in Alberta is already Friday in UTC.
    const label = "Standard clean · Thu, Oct 15, 2026, 8:00 PM";
    expect(matchLineToJob(line(label), [job("late", "2026-10-16T02:00:00Z")], TZ)).toBe("late");
  });

  it("leaves it alone unless exactly one job fits", () => {
    const two = [job("a", "2026-10-15T16:00:00Z"), job("b", "2026-10-15T19:00:00Z")];
    expect(matchLineToJob(line(oct15), two, TZ)).toBeNull();
    expect(matchLineToJob(line(oct15), [], TZ)).toBeNull();
  });

  it("leaves it alone when the price or quantity differs, or no date is named", () => {
    const jobs = [job("a", "2026-10-15T19:30:00Z")];
    expect(matchLineToJob(line(oct15, { unit_price_cents: 10000 }), jobs, TZ)).toBeNull();
    expect(matchLineToJob(line(oct15, { quantity: 2 }), jobs, TZ)).toBeNull();
    expect(matchLineToJob(line("Extra supplies"), jobs, TZ)).toBeNull();
  });
});

describe("releaseJobsFromVoidedInvoices", () => {
  /** Records every bookings update; the reads answer from `rows`. */
  function fake(rows: { invoices: unknown[]; lines: unknown[] }) {
    const updates: Array<{ set: Record<string, unknown>; filters: Record<string, unknown> }> = [];
    const client = {
      from: (table: string) => ({
        select: () => ({
          in: async () => ({ data: table === "invoices" ? rows.invoices : rows.lines, error: null }),
        }),
        update: (set: Record<string, unknown>) => {
          const entry = { set, filters: {} as Record<string, unknown> };
          updates.push(entry);
          const chain = {
            in: (col: string, v: unknown) => ((entry.filters[col] = v), chain),
            eq: (col: string, v: unknown) => ((entry.filters[col] = v), chain),
            is: (col: string, v: unknown) => ((entry.filters[col] = v), chain),
            then: (resolve: (v: unknown) => void) => resolve({ error: null }),
          };
          return chain;
        },
      }),
    };
    return { client: client as never, updates };
  }

  it("un-stamps and marks stamped jobs, then marks the rest only if unstamped", async () => {
    const { client, updates } = fake({
      invoices: [{ booking_id: "per-job" }, { booking_id: null }],
      lines: [{ booking_id: "on-line" }, { booking_id: "per-job" }],
    });
    await releaseJobsFromVoidedInvoices(client, "org", ["i1"], "NOW");
    expect(updates[0].set).toEqual({ billing_invoice_id: null, billing_released_at: "NOW" });
    expect(updates[0].filters).toEqual({ billing_invoice_id: ["i1"], organization_id: "org" });
    expect(updates[1].set).toEqual({ billing_released_at: "NOW" });
    // Still stamped means another live invoice bills it; hands off.
    expect(updates[1].filters).toEqual({
      id: ["per-job", "on-line"],
      organization_id: "org",
      billing_invoice_id: null,
    });
  });

  it("does nothing for no invoices", async () => {
    const { client, updates } = fake({ invoices: [], lines: [] });
    await releaseJobsFromVoidedInvoices(client, "org", [], "NOW");
    expect(updates).toHaveLength(0);
  });
});

describe("resolveBilledBookings fails closed by default", () => {
  // A client whose every query answers with an error and no rows — the shape
  // a bad embed or a dropped connection produces.
  function failingClient(message: string) {
    const builder = (): unknown =>
      new Proxy(
        {},
        {
          get: (_t, prop) =>
            prop === "then"
              ? (resolve: (v: unknown) => void) => resolve({ data: null, error: { message } })
              : () => builder(),
        },
      );
    return { from: () => builder() } as never;
  }

  it("throws when a read fails — 'couldn't check' is never 'not billed'", async () => {
    const { resolveBilledBookings } = await import("./billed-bookings");
    await expect(resolveBilledBookings(failingClient("connection reset"), ["bk1"])).rejects.toThrow(
      /could not read what is billed/,
    );
  });

  it("only a caller that says so gets the old behaviour", async () => {
    const { resolveBilledBookings } = await import("./billed-bookings");
    const m = await resolveBilledBookings(failingClient("connection reset"), ["bk1"], { failClosed: false });
    expect(m.size).toBe(0);
  });

  it("asks nothing of the database for no bookings", async () => {
    const { resolveBilledBookings } = await import("./billed-bookings");
    const m = await resolveBilledBookings(failingClient("would have thrown"), []);
    expect(m.size).toBe(0);
  });
});

describe("billedRefusal — the one sentence every writer says", () => {
  it("names the invoice, its status, and what to do after voiding it", async () => {
    const { billedRefusal } = await import("./billed-bookings");
    expect(
      billedRefusal({ id: "i", number: 64, status: "sent", amountCents: 100 }, "change the booking's status"),
    ).toBe("invoice INV-064 (sent) already bills this job. Void or fix that invoice first, then change the booking's status.");
  });

  it("copes with an unnumbered draft, and says nothing for an unbilled job", async () => {
    const { billedRefusal } = await import("./billed-bookings");
    expect(billedRefusal({ id: "i", number: null, status: "draft", amountCents: 0 }, "invoice it again")).toMatch(
      /^another invoice \(draft\) already bills this job/,
    );
    expect(billedRefusal(undefined, "anything")).toBeNull();
  });
});

describe("deleting an invoice is void's twin", () => {
  it("holds the jobs of an issued invoice, and leaves a draft's free", () => {
    for (const s of ["sent", "overdue", "paid", "partially_paid", "refunded"]) {
      expect(removalReleasesJobs(s)).toBe(true);
    }
    // Nobody has seen a draft; the work is still owed and the run offers it again.
    expect(removalReleasesJobs("draft")).toBe(false);
    // Marked when it was voided.
    expect(removalReleasesJobs("void")).toBe(false);
    expect(removalReleasesJobs(null)).toBe(false);
    expect(removalReleasesJobs(undefined)).toBe(false);
  });

  /** Reads answer per table; `fail` names a table whose read errors. */
  function reader(rows: Record<string, unknown[]>, fail?: string) {
    const seen: Array<{ table: string; filters: Record<string, unknown> }> = [];
    const client = {
      from: (table: string) => {
        const entry = { table, filters: {} as Record<string, unknown> };
        seen.push(entry);
        const chain = {
          select: () => chain,
          in: (col: string, v: unknown) => ((entry.filters[col] = v), chain),
          eq: (col: string, v: unknown) => ((entry.filters[col] = v), chain),
          then: (resolve: (v: unknown) => void) =>
            resolve(
              table === fail
                ? { data: null, error: { message: "boom" } }
                : { data: rows[table] ?? [], error: null },
            ),
        };
        return chain;
      },
    };
    return { client: client as never, seen };
  }

  it("finds the jobs by all three signals, once each", async () => {
    const { client, seen } = reader({
      invoices: [{ booking_id: "per-job" }],
      invoice_line_items: [{ booking_id: "on-line" }, { booking_id: null }, { booking_id: "per-job" }],
      bookings: [{ id: "stamp-only" }, { id: "on-line" }],
    });
    await expect(jobsBilledByInvoices(client, "org", ["i1"])).resolves.toEqual([
      "per-job",
      "on-line",
      "stamp-only",
    ]);
    // The stamp read stays inside the org.
    expect(seen.find((s) => s.table === "bookings")?.filters).toEqual({
      billing_invoice_id: ["i1"],
      organization_id: "org",
    });
  });

  it("throws when any read fails, so the delete stops", async () => {
    for (const table of ["invoices", "invoice_line_items", "bookings"]) {
      const { client } = reader({}, table);
      await expect(jobsBilledByInvoices(client, "org", ["i1"])).rejects.toThrow(/could not read the jobs/);
    }
  });

  function writer(result: "ok" | "error" | "reject" = "ok") {
    const updates: Array<{ set: Record<string, unknown>; filters: Record<string, unknown> }> = [];
    const client = {
      from: () => ({
        update: (set: Record<string, unknown>) => {
          const entry = { set, filters: {} as Record<string, unknown> };
          updates.push(entry);
          const chain = {
            in: (col: string, v: unknown) => ((entry.filters[col] = v), chain),
            eq: (col: string, v: unknown) => ((entry.filters[col] = v), chain),
            is: (col: string, v: unknown) => ((entry.filters[col] = v), chain),
            then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
              result === "reject"
                ? reject(new Error("fail-closed scope rejected"))
                : resolve({ error: result === "error" ? { message: "boom" } : null }),
          };
          return chain;
        },
      }),
    };
    return { client: client as never, updates };
  }

  it("marks only jobs no other invoice still stamps", async () => {
    const { client, updates } = writer();
    await markJobsReleased(client, "org", ["a", "b"], "NOW");
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toEqual({ billing_released_at: "NOW" });
    expect(updates[0].filters).toEqual({ id: ["a", "b"], organization_id: "org", billing_invoice_id: null });
  });

  it("writes nothing for no jobs, and never throws once the invoice is gone", async () => {
    const none = writer();
    await markJobsReleased(none.client, "org", [], "NOW");
    expect(none.updates).toHaveLength(0);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(markJobsReleased(writer("error").client, "org", ["a"], "NOW")).resolves.toBeUndefined();
    await expect(markJobsReleased(writer("reject").client, "org", ["a"], "NOW")).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });
});

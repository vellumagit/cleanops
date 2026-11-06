import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { guardQueries, inFailClosedScope, runFailClosed, runFailOpen } from "./query-guard";

/** Minimal stand-in for a PostgREST builder: chainable and thenable. */
type Result = { data?: unknown; error?: unknown };
type FakeBuilder = PromiseLike<Result> & {
  select: (s?: string) => FakeBuilder;
  eq: (a?: string, b?: unknown) => FakeBuilder;
  order: (s?: string) => FakeBuilder;
  limit: (n?: number) => FakeBuilder;
  is: (a?: string, b?: unknown) => FakeBuilder;
  single: () => FakeBuilder;
};

function fakeBuilder(result: Result): FakeBuilder {
  const builder = {
    then(onFulfilled?: (v: Result) => unknown) {
      return Promise.resolve(result).then(onFulfilled);
    },
  } as unknown as FakeBuilder;
  // Chain methods return the same builder, exactly like the real client.
  for (const m of ["select", "eq", "order", "limit", "is", "single"] as const) {
    (builder as unknown as Record<string, unknown>)[m] = () => builder;
  }
  return builder;
}

function fakeClient(result: Result) {
  return {
    from: (_table: string): FakeBuilder => fakeBuilder(result),
    rpc: () => "rpc-called",
  };
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
  vi.unstubAllEnvs();
});

describe("successful queries are untouched", () => {
  it("passes data through and logs nothing", async () => {
    const db = guardQueries(fakeClient({ data: [{ id: 1 }], error: null }));
    const res = await db.from("clients").select("id").eq("x", 1);
    expect(res).toEqual({ data: [{ id: 1 }], error: null });
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("leaves non-query methods working", () => {
    const db = guardQueries(fakeClient({ data: null, error: null }));
    expect(db.rpc()).toBe("rpc-called");
  });
});

describe("schema errors — the silent-failure class", () => {
  const undefinedColumn = {
    data: null,
    error: { code: "42703", message: "column x.y does not exist" },
  };

  it("throws outside production, naming the table", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const db = guardQueries(fakeClient(undefinedColumn));
    await expect(db.from("time_entries").select("membership_id")).rejects.toThrow(
      /time_entries/,
    );
  });

  it("in production logs loudly but does NOT throw", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const db = guardQueries(fakeClient(undefinedColumn));
    const res = await db.from("time_entries").select("membership_id");
    expect(res).toBe(undefinedColumn); // caller still gets its result
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[db-error] time_entries"),
    );
  });

  it("catches a missing relationship too", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const db = guardQueries(
      fakeClient({
        data: null,
        error: {
          code: "PGRST200",
          message: "Could not find a relationship between 'a' and 'b'",
        },
      }),
    );
    await expect(db.from("invoices").select("clients(name)")).rejects.toThrow(
      /db-error/,
    );
  });
});

describe("non-schema errors", () => {
  it("logs but never throws — a permissions blip shouldn't stop dev work", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const db = guardQueries(
      fakeClient({
        data: null,
        error: { code: "42501", message: "permission denied for table x" },
      }),
    );
    const res = await db.from("secrets").select("id");
    expect((res as { error: unknown }).error).toBeTruthy();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[db-error] secrets"),
    );
  });
});

describe("an ambiguous relationship is a schema error too", () => {
  it("throws outside production — two links, the embed names neither", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const db = guardQueries(
      fakeClient({
        data: null,
        error: {
          code: "PGRST201",
          message: "Could not embed because more than one relationship was found for 'bookings' and 'memberships'",
        },
      }),
    );
    await expect(db.from("bookings").select("assignee:memberships ( display_name )")).rejects.toThrow(
      /bookings/,
    );
  });
});

describe("background work fails closed", () => {
  const permissionBlip = { data: null, error: { code: "42501", message: "permission denied for table x" } };
  const ambiguous = {
    data: null,
    error: { code: "PGRST201", message: "Could not embed because more than one relationship was found" },
  };

  it("inside the scope, ANY error rejects — in production too", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const db = guardQueries(fakeClient(ambiguous));
    await expect(
      runFailClosed(() => db.from("bookings").select("assignee:memberships ( display_name )")),
    ).rejects.toThrow(/Background work stops here/);
    const db2 = guardQueries(fakeClient(permissionBlip));
    await expect(runFailClosed(() => db2.from("secrets").select("id"))).rejects.toThrow(/secrets/);
  });

  it("outside the scope, production still only logs", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const db = guardQueries(fakeClient(ambiguous));
    const res = await db.from("bookings").select("x");
    expect(res).toBe(ambiguous);
    expect(inFailClosedScope()).toBe(false);
  });

  it("a .single() with no row is not a failure, even inside the scope", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const noRow = { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
    const db = guardQueries(fakeClient(noRow));
    const res = await runFailClosed(() => db.from("organizations").select("timezone").single());
    expect(res).toBe(noRow);
  });

  it("covers everything awaited after the scope is entered, and runFailOpen steps out", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const db = guardQueries(fakeClient(permissionBlip));
    await runFailClosed(async () => {
      await Promise.resolve();
      expect(inFailClosedScope()).toBe(true);
      await expect(db.from("a").select("id")).rejects.toThrow(/db-error/);
      const res = await runFailOpen(() => db.from("a").select("id"));
      expect(res).toBe(permissionBlip);
      expect(inFailClosedScope()).toBe(true);
    });
  });
});

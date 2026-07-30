import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { guardQueries } from "./query-guard";

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

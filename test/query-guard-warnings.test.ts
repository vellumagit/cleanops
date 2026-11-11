/**
 * Two ways a read used to come back short without anyone being told.
 *
 * PostgREST returns at most 1000 rows and says nothing when there were more.
 * A long .in() list fails outright at around 390 ids. Both were on the
 * half-shipped list as "reads still truncate silently". The query guard now
 * logs each one where the error tracker sees it. It logs only: the result
 * still reaches the caller untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardQueries } from "@/lib/supabase/query-guard";

/** A query chain: every method returns the chain, and awaiting it gives the rows. */
type Chain = PromiseLike<{ data: unknown[] }> & {
  [method in "select" | "eq" | "in" | "order" | "limit" | "range" | "insert" | "update" | "delete" | "is" | "maybeSingle"]: (
    ...args: unknown[]
  ) => Chain;
};

/** A PostgREST-shaped client whose every chain resolves to `rows`. */
function clientReturning(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit", "range", "insert", "update", "delete", "is", "maybeSingle"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return guardQueries({ from: () => chain }) as unknown as { from: (table: string) => Chain };
}

const thousand = Array.from({ length: 1000 }, (_, i) => ({ id: i }));

let logged: string[];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(String(args[0]));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a read that comes back with exactly 1000 rows", () => {
  it("is called out when nothing bounded it, and still returns its rows", async () => {
    const db = clientReturning(thousand);
    const res = await db.from("bookings").select("id").eq("organization_id", "o");
    expect(res.data).toHaveLength(1000);
    expect(logged.filter((l) => l.startsWith("[db-truncated] bookings"))).toHaveLength(1);
  });

  it("is fine when the caller asked for a limit or a range", async () => {
    await clientReturning(thousand).from("bookings").select("id").limit(1000);
    await clientReturning(thousand).from("bookings").select("id").range(0, 999);
    expect(logged).toEqual([]);
  });

  it("is fine for rows a write returned, and for a count", async () => {
    await clientReturning(thousand).from("bookings").update({ notes: "x" }).eq("organization_id", "o").select("id");
    await clientReturning(thousand).from("bookings").select("id", { count: "exact", head: true });
    expect(logged).toEqual([]);
  });

  it("says nothing about 999", async () => {
    await clientReturning(thousand.slice(1)).from("bookings").select("id");
    expect(logged).toEqual([]);
  });
});

describe("a long .in() list", () => {
  it("is called out past 300 values, naming the table and the column", async () => {
    const ids = Array.from({ length: 301 }, (_, i) => `id-${i}`);
    await clientReturning([]).from("booking_assignees").select("booking_id").in("booking_id", ids);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('[db-long-in] booking_assignees: .in("booking_id") with 301 values');
  });

  it("says nothing at 300 or below", async () => {
    await clientReturning([]).from("booking_assignees").select("booking_id").in("booking_id", Array(300).fill("x"));
    expect(logged).toEqual([]);
  });
});

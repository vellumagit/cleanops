/**
 * Inside the fail-closed scope a failed query rejects — including the one
 * failure an idempotency insert EXPECTS: 23505 on a duplicate delivery. Left
 * alone, that rejection fires before the caller's `code === "23505"` branch,
 * and a webhook retrying an event it had already handled 500s and retries
 * again, forever. allowDbErrors hands the listed codes back as an ordinary
 * result; everything else still stops the caller.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ error: null as { code?: string; message: string } | null }));

vi.mock("@/lib/supabase/admin", async () => {
  const { guardQueries } = await import("@/lib/supabase/query-guard");
  return { createSupabaseAdminClient: () => guardQueries(fakeClient()) };
});

/** A client whose one query resolves with whatever error the test sets. */
function fakeClient() {
  const builder: PromiseLike<unknown> = {
    then: (res, rej) => Promise.resolve({ data: null, error: mocks.error }).then(res, rej),
  };
  const chain = { insert: () => builder, upsert: () => builder, select: () => builder };
  return { from: () => chain };
}

const { allowDbErrors, DbQueryError, guardQueries, runFailClosed } = await import("@/lib/supabase/query-guard");
const { addEmailSuppression } = await import("@/lib/email-suppression");

const duplicate = { code: "23505", message: "duplicate key value violates unique constraint" };
const missingTable = { code: "42P01", message: 'relation "x" does not exist' };

describe("allowDbErrors", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("a plain await of an expected error still rejects inside the scope, with the code attached", async () => {
    mocks.error = duplicate;
    const client = guardQueries(fakeClient());
    const rejection = runFailClosed(() => client.from().insert()).then(
      () => null,
      (e: unknown) => e,
    );
    const err = await rejection;
    expect(err).toBeInstanceOf(DbQueryError);
    expect((err as InstanceType<typeof DbQueryError>).code).toBe("23505");
  });

  it("hands a listed code back as the ordinary result inside the scope", async () => {
    mocks.error = duplicate;
    const client = guardQueries(fakeClient());
    await expect(runFailClosed(() => allowDbErrors(["23505"], client.from().insert()))).resolves.toEqual({
      data: null,
      error: duplicate,
    });
  });

  it("still rejects on a code that was not listed", async () => {
    mocks.error = missingTable;
    const client = guardQueries(fakeClient());
    await expect(runFailClosed(() => allowDbErrors(["23505"], client.from().insert()))).rejects.toBeInstanceOf(
      DbQueryError,
    );
  });

  it("outside the scope returns the result untouched", async () => {
    mocks.error = duplicate;
    const client = guardQueries(fakeClient());
    await expect(allowDbErrors(["23505"], client.from().insert())).resolves.toEqual({ data: null, error: duplicate });
  });
});

describe("the suppression upsert under a fail-closed webhook", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("treats a redelivered event as already handled", async () => {
    mocks.error = duplicate;
    await expect(
      runFailClosed(() => addEmailSuppression({ email: "a@b.co", reason: "bounced", providerEventId: "evt_1" })),
    ).resolves.toEqual({ ok: true });
  });

  it("lets any other failure stop the handler so the provider retries", async () => {
    mocks.error = missingTable;
    await expect(
      runFailClosed(() => addEmailSuppression({ email: "a@b.co", reason: "bounced", providerEventId: "evt_1" })),
    ).rejects.toBeInstanceOf(DbQueryError);
  });
});

/**
 * The twin of the fix above, for the source: a `code === "23505"` (or 23503,
 * 23P01) branch after a `.from()` query is dead inside the fail-closed scope
 * unless the query went through allowDbErrors — the rejection fires first.
 * `.rpc()` calls are not wrapped by the guard, so their branches still run.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("every expected-error branch survives the fail-closed scope", () => {
  it("wraps the query in allowDbErrors (or reads an rpc, which the guard leaves alone)", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      if (file.endsWith("query-guard.ts")) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/code\s*[!=]==\s*"(23505|23503|23P01)"|includes\("23505"\)/.test(line)) return;
        // The statement this branch inspects: back to the nearest await.
        let start = i;
        while (start > 0 && !/\bawait\b/.test(lines[start])) start--;
        const span = lines.slice(start, i + 1).join("\n");
        if (/\.rpc\(/.test(span) || /allowDbErrors\(/.test(span)) return;
        // A thrown error already handled by a catch that reads the code.
        if (/catch\s*\(/.test(span) && /dbErrorCode|DbQueryError|\.code/.test(span)) return;
        offenders.push(`${relative(ROOT, file).replace(/\\/g, "/")}:${i + 1}`);
      });
    }
    expect(
      offenders,
      "\nThese branches expect a Postgres error code after a query that rejects on\n" +
        "any error inside the fail-closed scope, so they can never run there.\n" +
        "Fix: await allowDbErrors([\"<code>\"], <the query>) from @/lib/supabase/query-guard.\n",
    ).toEqual([]);
  }, 30_000); // walks all of src; slow under the full suite's load
});

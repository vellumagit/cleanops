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

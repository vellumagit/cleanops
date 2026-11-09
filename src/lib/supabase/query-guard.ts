/**
 * Make a failed database query impossible to ignore.
 *
 * THE BUG CLASS THIS EXISTS FOR — seven confirmed instances in one week:
 *
 *   const { data } = await db.from("time_entries").select("membership_id, ...")
 *   if (!data || data.length === 0) continue;   // "nothing to do"
 *
 * `membership_id` is not a column. PostgREST answers with an ERROR, not a
 * throw. `data` is null. The guard clause reads that as "no rows" and the
 * feature does nothing — silently, forever. The overtime warning never fired
 * for anyone. The changelog email resolved zero recipients. Client statements
 * rendered with no invoices and no letterhead. None of it logged a thing.
 *
 * A wrapped client watches every result. On `error` it logs one loud,
 * greppable line (`[db-error]`, picked up by Sentry's console capture), and
 * OUTSIDE production it throws — so the next one dies the first time it runs
 * instead of hiding for months.
 *
 * Deliberately NOT throwing in production for a page or an action: these
 * queries are already failing today, and turning silent degradation into a
 * 500 for a live customer is a worse outcome than a loud log we act on.
 *
 * BACKGROUND WORK IS THE EXCEPTION — it fails closed. A cron that reads
 * "no rows" where there was an error goes on to send, mark sent, complete
 * or invoice on nothing, and nobody is at a screen to notice. Inside a
 * fail-closed scope (every cron route enters one in requireCronAuth) ANY
 * error rejects the await, in production too; the per-org try/catch in the
 * job then skips that org and logs, instead of acting on a lie. 2026-10-28
 * to 11-01: a second bookings→memberships link made four embeds ambiguous
 * (PGRST201); the nightly calendar reconcile read the error as an empty
 * list and did nothing for five days.
 */

import { AsyncLocalStorage } from "node:async_hooks";

type MaybeResult = { error?: unknown; data?: unknown } | null | undefined;

/**
 * What a failed query rejects with inside the fail-closed scope. It carries
 * the PostgREST error, so a caller that EXPECTS one code can still tell it
 * apart — see allowDbErrors.
 */
export class DbQueryError extends Error {
  readonly code: string | null;
  readonly raw: unknown;
  constructor(message: string, raw: unknown) {
    super(message);
    this.name = "DbQueryError";
    this.raw = raw;
    const code = (raw as { code?: unknown } | null)?.code;
    this.code = typeof code === "string" ? code : null;
  }
}

/**
 * Await a query some of whose errors are expected. An idempotency insert
 * meets 23505 on a duplicate delivery and means "already done", not "stop";
 * inside the fail-closed scope that error would reject before the caller's
 * `if (error.code === "23505")` ever ran, and a webhook retrying an event it
 * had already handled would 500 and retry again, forever. The listed codes
 * come back as the ordinary { data, error } result in any scope, so the
 * caller's own branch handles them; every other failure keeps the scope's
 * behaviour.
 */
export async function allowDbErrors<T>(codes: readonly string[], query: PromiseLike<T>): Promise<T> {
  try {
    return await query;
  } catch (err) {
    if (err instanceof DbQueryError && err.code && codes.includes(err.code)) {
      return { data: null, error: err.raw } as T;
    }
    throw err;
  }
}

const failClosedScope = new AsyncLocalStorage<boolean>();

/**
 * From here to the end of the current async flow, a failed query rejects
 * instead of returning. For a request handler: call it synchronously at the
 * top, before the first await, and everything the handler awaits is covered.
 */
export function enterFailClosed(): void {
  failClosedScope.enterWith(true);
}

/** Run `fn` with failed queries rejecting. */
export function runFailClosed<T>(fn: () => T): T {
  return failClosedScope.run(true, fn);
}

/**
 * Run `fn` with the page/action behaviour (log, return the result) inside a
 * fail-closed scope — for the rare caller that checks every error itself
 * and reports them, like the morning check.
 */
export function runFailOpen<T>(fn: () => T): T {
  return failClosedScope.run(false, fn);
}

export function inFailClosedScope(): boolean {
  return failClosedScope.getStore() === true;
}

/**
 * `.single()` with no row answers PGRST116. That is the one error a caller
 * routinely means as "not there" (`data` null, carry on with defaults), so
 * fail-closed leaves it alone.
 */
function isNoRow(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "PGRST116");
}

function describe(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as { code?: string; message?: string; details?: string };
  return [e.code && `[${e.code}]`, e.message, e.details]
    .filter(Boolean)
    .join(" ");
}

/**
 * A schema mistake — the column/table/relationship doesn't exist. These are
 * always bugs, never bad input or a transient blip, so they're the ones worth
 * failing hard on in dev.
 *   42703 undefined_column · 42P01 undefined_table · PGRST200 no relationship
 *   PGRST201 ambiguous relationship (two links, embed names neither)
 */
function isSchemaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, message } = err as { code?: string; message?: string };
  if (code === "42703" || code === "42P01" || code === "PGRST200" || code === "PGRST201") return true;
  return Boolean(
    message &&
      (message.includes("does not exist") ||
        message.includes("Could not find a relationship") ||
        message.includes("more than one relationship")),
  );
}

/**
 * Log the failure and RETURN an Error when the caller should be stopped —
 * never throw from here. This runs inside a promise's resolve callback, and
 * a throw there is swallowed by the await machinery and hangs the caller
 * forever. The wrapper routes what we return into the rejection path instead.
 */
function inspect(result: MaybeResult, table: string, failClosed: boolean): Error | null {
  if (!result || typeof result !== "object" || !result.error) return null;
  const err = result.error;
  const detail = describe(err);

  console.error(`[db-error] ${table}: ${detail}`);

  // Background work: every error stops the caller, in production too. The
  // alternative is a cron acting on "no rows" that were really a failure.
  if (failClosed && !isNoRow(err)) {
    return new DbQueryError(
      `[db-error] ${table}: ${detail}\n` +
        `Background work stops here rather than treating a failed read as "no rows".`,
      err,
    );
  }

  // Elsewhere only schema errors stop the caller, and only outside
  // production. A permissions or network blip in dev shouldn't halt work; a
  // typo'd column should, loudly and immediately.
  if (isSchemaError(err) && process.env.NODE_ENV !== "production") {
    return new Error(
      `[db-error] ${table}: ${detail}\n` +
        `This is a schema mistake — the query names something that does not exist. ` +
        `In production it would return null data and the caller would silently treat ` +
        `it as "no rows". Fix the column/table name.`,
    );
  }
  return null;
}

/**
 * Wrap one PostgREST builder so awaiting it inspects the result. Whether a
 * failure rejects was decided when the query was issued (`.from()`), where
 * the scope is unambiguous; by the time the promise settles the async
 * context may be a different one.
 */
function wrapBuilder<T extends object>(builder: T, table: string, failClosed: boolean): T {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // The await point. Inspect, then hand the result on untouched.
      if (prop === "then" && typeof value === "function") {
        return (
          onFulfilled?: (v: unknown) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) =>
          (value as (...a: unknown[]) => unknown).call(
            target,
            (res: MaybeResult) => {
              const failure = inspect(res, table, failClosed);
              if (failure) {
                // Route into the REJECTION path. `await` passes its own
                // resolve/reject here; throwing instead would be swallowed
                // and the caller would hang.
                if (onRejected) return onRejected(failure);
                return Promise.reject(failure);
              }
              return onFulfilled ? onFulfilled(res) : res;
            },
            onRejected,
          );
      }

      // Chainable methods (.select, .eq, .order, .single…) return a builder —
      // keep the wrapper on it so the chain stays observed.
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          const out = (value as (...a: unknown[]) => unknown).apply(
            target,
            args,
          );
          return out && typeof out === "object" && "then" in (out as object)
            ? wrapBuilder(out as object, table, failClosed)
            : out;
        };
      }

      return value;
    },
  }) as T;
}

/**
 * Wrap a Supabase client so every query through `.from()` is watched.
 * Transparent: same API, same return values, no call-site changes.
 */
export function guardQueries<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "from" && typeof value === "function") {
        return (...args: unknown[]) => {
          const builder = (value as (...a: unknown[]) => unknown).apply(
            target,
            args,
          );
          const table = typeof args[0] === "string" ? args[0] : "unknown";
          return builder && typeof builder === "object"
            ? wrapBuilder(builder as object, table, inFailClosedScope())
            : builder;
        };
      }
      // Methods like .rpc/.auth/.storage must stay bound to the real client.
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}

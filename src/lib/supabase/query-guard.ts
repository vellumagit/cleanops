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
 * Deliberately NOT throwing in production: these queries are already failing
 * today. Turning silent degradation into a 500 for a live customer is a
 * worse outcome than a loud log we act on.
 */

type MaybeResult = { error?: unknown; data?: unknown } | null | undefined;

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
 */
function isSchemaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, message } = err as { code?: string; message?: string };
  if (code === "42703" || code === "42P01" || code === "PGRST200") return true;
  return Boolean(
    message &&
      (message.includes("does not exist") ||
        message.includes("Could not find a relationship")),
  );
}

/**
 * Log the failure and RETURN an Error when the caller should be stopped —
 * never throw from here. This runs inside a promise's resolve callback, and
 * a throw there is swallowed by the await machinery and hangs the caller
 * forever. The wrapper routes what we return into the rejection path instead.
 */
function inspect(result: MaybeResult, table: string): Error | null {
  if (!result || typeof result !== "object" || !result.error) return null;
  const err = result.error;
  const detail = describe(err);

  console.error(`[db-error] ${table}: ${detail}`);

  // Only schema errors stop the caller, and only outside production. A
  // permissions or network blip in dev shouldn't halt work; a typo'd column
  // should, loudly and immediately.
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

/** Wrap one PostgREST builder so awaiting it inspects the result. */
function wrapBuilder<T extends object>(builder: T, table: string): T {
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
              const failure = inspect(res, table);
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
            ? wrapBuilder(out as object, table)
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
            ? wrapBuilder(builder as object, table)
            : builder;
        };
      }
      // Methods like .rpc/.auth/.storage must stay bound to the real client.
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}

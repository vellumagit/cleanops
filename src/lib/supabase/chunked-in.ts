/**
 * `.in(column, ids)` for lists that can be long.
 *
 * PostgREST takes an `in` filter in the URL, and the gateway rejects URLs past
 * roughly 16 KB with a bare 400 "Bad Request". At 37 characters a UUID that is
 * about 400 ids. The bookings list loads up to 1,000 rows and then asked for
 * their crew, cover and claims in one request each — every one of those came
 * back an error, so the list showed team jobs without their crew and covered
 * jobs as unstaffed, with nothing on screen to say so.
 *
 * 150 ids per request keeps each URL near 6 KB, with room for the rest of the
 * query. Chunks run in parallel; the first error is returned, like a single
 * query would.
 */
export const IN_CHUNK_SIZE = 150;

export function chunkIds<T>(ids: readonly T[], size = IN_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

type Result<R> = {
  data: R[] | null;
  error: { message: string } | null;
};

export async function selectInChunks<R>(
  ids: readonly string[],
  run: (chunk: string[]) => PromiseLike<Result<R>>,
  size = IN_CHUNK_SIZE,
): Promise<{ data: R[]; error: { message: string } | null }> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return { data: [], error: null };
  const results = await Promise.all(chunkIds(unique, size).map((c) => run(c)));
  const error = results.find((r) => r.error)?.error ?? null;
  return { data: results.flatMap((r) => r.data ?? []), error };
}

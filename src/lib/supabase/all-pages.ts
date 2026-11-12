/**
 * Every row a query returns, a page at a time.
 *
 * PostgREST stops at 1000 rows without saying so (the query guard only logs
 * `[db-truncated]`). Where missing a row is a wrong answer rather than a
 * shorter list — an opt-out not recorded, a sender shown as unknown, an
 * overdue invoice never chased — read it all. The query MUST be ordered on a
 * unique key, or pages can overlap and skip.
 */
export type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export const PAGE_SIZE = 1000;

export async function allPages<T>(
  page: (from: number, to: number) => Page<T>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return rows;
  }
}

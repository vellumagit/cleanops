import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runFailOpen } from "@/lib/supabase/query-guard";

/**
 * A ledger of cron runs, so a job that fails or stops running is seen.
 *
 * Vercel keeps about fifty log lines per deployment and nobody reads them.
 * The calendar reconcile threw every night from Oct 28 to Nov 1 and showed
 * nowhere; fail-closed crons (cron-auth.ts) now throw more, by design, which
 * makes a place to see it more important, not less.
 *
 * withCronRun wraps a route's GET: one row per run with when it started and
 * finished, whether it returned 2xx, the error text if not, and the JSON
 * result. The morning check reads the last week (summarizeCronRuns) and
 * lists what failed and what hasn't run when its schedule says it should
 * have. Auth refusals (401, 503) are not runs and are not recorded. The
 * ledger write is best-effort and fail-open: it must never be the reason a
 * cron fails.
 */

const AUTH_REFUSALS = new Set([401, 503]);

async function record(row: {
  path: string;
  startedAt: Date;
  finishedAt: Date;
  ok: boolean;
  status: number | null;
  error: string | null;
  result: unknown;
}): Promise<void> {
  await runFailOpen(async () => {
    try {
      const db = createSupabaseAdminClient();
      const { error } = await db.from("cron_runs" as never).insert({
        path: row.path,
        started_at: row.startedAt.toISOString(),
        finished_at: row.finishedAt.toISOString(),
        ok: row.ok,
        status: row.status,
        error: row.error ? row.error.slice(0, 2000) : null,
        result: row.result ?? null,
      } as never);
      if (error) console.error(`[cron-run] could not record ${row.path}:`, error.message);
    } catch (err) {
      console.error(`[cron-run] could not record ${row.path}:`, err);
    }
  });
}

/** Wrap a cron route's handler so every run leaves a row. */
export function withCronRun<R extends Request>(
  path: string,
  handler: (req: R) => Promise<Response>,
): (req: R) => Promise<Response> {
  return async (req: R) => {
    const startedAt = new Date();
    let res: Response | null = null;
    let thrown: unknown = null;
    try {
      res = await handler(req);
    } catch (err) {
      thrown = err;
    }
    const finishedAt = new Date();
    const status = res?.status ?? null;
    if (!thrown && status != null && AUTH_REFUSALS.has(status)) return res!;

    let error: string | null = null;
    let result: unknown = null;
    if (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown);
    } else if (res) {
      // The body is read from a clone so the caller's response is untouched.
      const text = await res
        .clone()
        .text()
        .catch(() => "");
      if (res.ok) {
        try {
          result = text ? JSON.parse(text) : null;
        } catch {
          result = text.slice(0, 500);
        }
      } else {
        error = `HTTP ${res.status}: ${text.slice(0, 500)}`;
      }
    }
    await record({
      path,
      startedAt,
      finishedAt,
      ok: !thrown && Boolean(res?.ok),
      status,
      error,
      result,
    });
    if (thrown) throw thrown;
    return res!;
  };
}

// The summary the morning check reads lives in cron-run-summary.ts (pure, so
// the check can run from a script too); re-exported here for callers.
export {
  cronIntervalMinutes,
  missingAfterMinutes,
  summarizeCronRuns,
  type CronRunRow,
  type CronSchedule,
  type CronSummary,
} from "@/lib/cron-run-summary";

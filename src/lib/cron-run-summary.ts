/**
 * The morning check's reading of the cron ledger (src/lib/cron-run.ts). Pure,
 * so the check can run from a script as well as from the cron: what failed
 * in the window, and what has not run when its schedule says it should have.
 */

export type CronRunRow = {
  path: string;
  started_at: string;
  finished_at: string;
  ok: boolean;
  status: number | null;
  error: string | null;
};

export type CronSchedule = { path: string; schedule: string };

/**
 * How often a 5-field cron expression fires, in minutes, when that is a
 * fixed interval: every N minutes, hourly, every N hours, daily. Weekly and
 * monthly schedules (a day-of-week or day-of-month) return null; "it hasn't
 * run" is not judged for them, only "it failed".
 */
export function cronIntervalMinutes(schedule: string): number | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, , dow] = parts;
  if (dom !== "*" || dow !== "*") return null;
  const every = (f: string) => (/^\*\/(\d+)$/.test(f) ? Number(f.slice(2)) : null);
  if (hour === "*") return every(minute) ?? 60;
  const h = every(hour);
  if (h != null) return h * 60;
  // A fixed hour (or a list of them): daily, judged against the first.
  if (/^\d+(,\d+)*$/.test(hour) && /^\d+$/.test(minute)) return 24 * 60;
  return null;
}

/** How long after its interval a run may be missing before it is flagged. */
export function missingAfterMinutes(intervalMinutes: number): number {
  if (intervalMinutes <= 60) return intervalMinutes * 2 + 10;
  if (intervalMinutes <= 6 * 60) return intervalMinutes + 60;
  return 25 * 60;
}

export type CronSummary = {
  lines: string[];
  failed: number;
  missing: number;
};

const name = (path: string) => path.replace(/^\/api\/cron\//, "");

/**
 * `runs` is the last week or so, in any order; `sinceMs` is the window for
 * failures (the check's 36 hours). "Missing" looks at the whole week.
 */
export function summarizeCronRuns(
  crons: CronSchedule[],
  runs: CronRunRow[],
  opts: { nowMs: number; sinceMs: number; fmt: (iso: string) => string },
): CronSummary {
  const byPath = new Map<string, CronRunRow[]>();
  for (const r of runs) {
    const list = byPath.get(r.path) ?? [];
    list.push(r);
    byPath.set(r.path, list);
  }
  for (const list of byPath.values()) list.sort((a, b) => a.started_at.localeCompare(b.started_at));

  const failures: string[] = [];
  const missing: string[] = [];
  let ranClean = 0;
  for (const c of crons) {
    const list = byPath.get(c.path) ?? [];
    const recent = list.filter((r) => new Date(r.started_at).getTime() >= opts.sinceMs);
    const recentFailures = recent.filter((r) => !r.ok);
    for (const f of recentFailures) {
      failures.push(
        `   FAILED   ${opts.fmt(f.started_at)}  ${name(c.path).padEnd(26)} ${(f.error ?? "no error text").replace(/\s+/g, " ").slice(0, 140)}`,
      );
    }
    const interval = cronIntervalMinutes(c.schedule);
    const lastOk = [...list].reverse().find((r) => r.ok);
    if (interval != null) {
      const lastOkMs = lastOk ? new Date(lastOk.started_at).getTime() : null;
      const overdueMs = missingAfterMinutes(interval) * 60_000;
      if (lastOkMs == null || opts.nowMs - lastOkMs > overdueMs) {
        const expected =
          interval % (24 * 60) === 0 ? "daily" : interval % 60 === 0 ? `every ${interval / 60}h` : `every ${interval} min`;
        missing.push(
          `   MISSING  ${name(c.path).padEnd(26)} last ran clean ${lastOk ? opts.fmt(lastOk.started_at) : "never (in the last week)"} — expected ${expected}`,
        );
      }
    }
    if (recent.length > 0 && recentFailures.length === 0) ranClean++;
  }

  const lines = [
    `6. CRONS (last 36h): ${crons.length} scheduled · ${ranClean} ran clean · ${failures.length} failed run(s) · ${missing.length} not running`,
    ...failures,
    ...missing,
  ];
  return { lines, failed: failures.length, missing: missing.length };
}

/**
 * What a vercel.json cron entry must be for Vercel to accept it and for it to
 * reach a handler. Pure, so scripts/validate-cron-schedules.ts can run it in CI
 * without installing the app, and the tests can feed it cases directly.
 *
 * The project is on Vercel Pro, so sub-daily schedules are allowed (shift
 * reminders every 30 minutes, task reminders hourly). The old guard banned them
 * for the Hobby plan and failed every push after the upgrade. What can still
 * stop a deploy or a job is a malformed expression or a path with no route.
 */

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 6 },
] as const;

/** Returns why Vercel would reject the expression, or null if it is valid. */
export function scheduleProblem(schedule: string): string | null {
  if (schedule.length > 256) return "longer than 256 characters";
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return `expected 5 fields, got ${parts.length}`;

  for (let i = 0; i < 5; i++) {
    const problem = fieldProblem(parts[i], FIELDS[i].min, FIELDS[i].max);
    if (problem) return `${FIELDS[i].name} '${parts[i]}': ${problem}`;
  }

  // Vercel will not take both; standard cron would OR them, which is never
  // what the author meant anyway.
  if (parts[2] !== "*" && parts[4] !== "*") {
    return "day of month and day of week are both set; one must be '*'";
  }
  return null;
}

function fieldProblem(field: string, min: number, max: number): string | null {
  for (const item of field.split(",")) {
    const [range, step, extra] = item.split("/");
    if (extra !== undefined) return "more than one '/'";
    if (step !== undefined && !isInt(step, 1, max)) return `step must be 1-${max}`;
    if (range === "*") continue;
    const [lo, hi, more] = range.split("-");
    if (more !== undefined) return "more than one '-'";
    // Names (MON, JAN) are not supported by Vercel; isInt rejects them.
    if (!isInt(lo, min, max)) return `'${lo}' is not a number ${min}-${max}`;
    if (hi !== undefined) {
      if (!isInt(hi, min, max)) return `'${hi}' is not a number ${min}-${max}`;
      if (Number(hi) < Number(lo)) return `range '${range}' runs backwards`;
    } else if (step !== undefined) {
      return "a step needs '*' or a range before it";
    }
  }
  return null;
}

function isInt(s: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  return n >= min && n <= max;
}

/**
 * The route file a cron path lands on, relative to the repo root. Cron paths
 * are plain (no dynamic segments) and may carry a query string.
 */
export function routeFileFor(path: string): string | null {
  if (!path.startsWith("/")) return null;
  const clean = path.split("?")[0].replace(/\/+$/, "");
  return `src/app${clean}/route.ts`;
}

/** Vercel calls crons with GET; a route without one returns 405 every run. */
export function exportsGet(source: string): boolean {
  return /export\s+(async\s+)?function\s+GET\b|export\s+const\s+GET\b|export\s*\{[^}]*\bGET\b[^}]*\}/.test(
    source,
  );
}

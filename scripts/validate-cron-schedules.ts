/**
 * CI guard against sub-daily Vercel cron schedules.
 *
 * Vercel Hobby plan only allows daily-or-slower cron expressions.
 * Anything more frequent (hourly or "step every N minutes") fails
 * deployment with:
 *
 *   "Hobby accounts are limited to daily cron jobs. This cron
 *    expression would run more than once per day."
 *
 * We learned this the hard way — a single sub-daily expression in
 * vercel.json froze ALL deploys for 2 days because every subsequent
 * commit failed the build gate. This script catches the same class
 * of mistake at PR time.
 *
 * Usage:
 *   tsx scripts/validate-cron-schedules.ts            (runs from repo root)
 *   npm run cron:check                                 (via package.json)
 *
 * Exit code: 0 on clean, 1 on any violation.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type VercelConfig = {
  crons?: Array<{ path: string; schedule: string }>;
};

const VERCEL_JSON = resolve(process.cwd(), "vercel.json");

function main() {
  let raw: string;
  try {
    raw = readFileSync(VERCEL_JSON, "utf-8");
  } catch (err) {
    console.error(`Could not read ${VERCEL_JSON}:`, err);
    process.exit(1);
  }

  let config: VercelConfig;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    console.error(`vercel.json is not valid JSON:`, err);
    process.exit(1);
  }

  const crons = config.crons ?? [];
  if (crons.length === 0) {
    console.log("✓ No cron schedules to validate.");
    process.exit(0);
  }

  const violations: Array<{
    path: string;
    schedule: string;
    reason: string;
  }> = [];

  for (const cron of crons) {
    const issue = validateSchedule(cron.schedule);
    if (issue) {
      violations.push({ path: cron.path, schedule: cron.schedule, reason: issue });
    }
  }

  if (violations.length === 0) {
    console.log(`✓ All ${crons.length} cron schedules are daily-or-slower.`);
    process.exit(0);
  }

  console.error("\n✗ Sub-daily cron schedules detected — Vercel Hobby plan rejects these:\n");
  for (const v of violations) {
    console.error(`  ${v.path}`);
    console.error(`    schedule: "${v.schedule}"`);
    console.error(`    reason:   ${v.reason}\n`);
  }
  console.error(
    "If you genuinely need sub-daily crons, upgrade to Vercel Pro and update\n" +
      "this script's allowlist. Until then, keep schedules to at most one\n" +
      "firing per day:\n" +
      "  '0 10 * * *'  ✓ daily at 10:00 UTC\n" +
      "  '0 7 1 * *'   ✓ monthly on the 1st at 07:00 UTC\n" +
      "  '0 8 * * 1'   ✓ weekly on Monday at 08:00 UTC\n" +
      "  '0 * * * *'   ✗ hourly\n" +
      "  '*/30 * * * *'✗ every 30 minutes\n" +
      "  '0 0,12 * * *'✗ twice daily\n",
  );
  process.exit(1);
}

/**
 * Returns a human-readable reason if the schedule fires more than once
 * per day; null if it's daily-or-slower.
 *
 * Cron format: "minute hour day-of-month month day-of-week"
 * We only need to check the first two fields — month/day-of-week
 * constraints only NARROW the firing schedule, never widen it.
 */
function validateSchedule(schedule: string): string | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) {
    return `expected 5 cron fields, got ${parts.length}`;
  }

  const [minute, hour] = parts;

  // Minute field check
  if (minute === "*") {
    return "minute is '*' — fires every minute (60x/hour)";
  }
  if (minute.includes("/")) {
    return `minute uses '/' step — fires multiple times per hour (got '${minute}')`;
  }
  if (minute.includes("-")) {
    return `minute uses '-' range — fires multiple times per hour (got '${minute}')`;
  }
  if (minute.includes(",")) {
    return `minute uses ',' list — fires multiple times per hour (got '${minute}')`;
  }
  // Minute should now be a single digit 0-59
  const minuteNum = Number(minute);
  if (!Number.isInteger(minuteNum) || minuteNum < 0 || minuteNum > 59) {
    return `minute must be a single integer 0-59 (got '${minute}')`;
  }

  // Hour field check
  if (hour === "*") {
    return "hour is '*' — fires every hour (sub-daily)";
  }
  if (hour.includes("/")) {
    return `hour uses '/' step — fires multiple times per day (got '${hour}')`;
  }
  if (hour.includes("-")) {
    return `hour uses '-' range — fires multiple times per day (got '${hour}')`;
  }
  if (hour.includes(",")) {
    return `hour uses ',' list — fires multiple times per day (got '${hour}')`;
  }
  const hourNum = Number(hour);
  if (!Number.isInteger(hourNum) || hourNum < 0 || hourNum > 23) {
    return `hour must be a single integer 0-23 (got '${hour}')`;
  }

  // At this point minute + hour are both single specific values.
  // The schedule fires at most once per day (further narrowed by
  // day-of-month, month, day-of-week if those are constrained).
  return null;
}

main();

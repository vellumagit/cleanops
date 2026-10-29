/**
 * CI guard for vercel.json crons. Fails if any entry would be rejected by
 * Vercel (which blocks the whole deploy) or would never reach a handler
 * (which fails silently every run).
 *
 * Checks each entry for:
 *   - a valid 5-field expression Vercel accepts (src/lib/cron-schedule.ts)
 *   - a path whose route file exists and exports GET
 *
 * Sub-daily schedules are fine: the project is on Vercel Pro. This script
 * used to ban them for the Hobby plan and failed every push after the upgrade.
 *
 * Usage:
 *   tsx scripts/validate-cron-schedules.ts            (runs from repo root)
 *   npm run cron:check                                 (via package.json)
 *
 * Exit code: 0 on clean, 1 on any violation.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exportsGet, routeFileFor, scheduleProblem } from "../src/lib/cron-schedule";

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

  const violations: Array<{ path: string; schedule: string; reason: string }> = [];

  for (const cron of crons) {
    const problem = scheduleProblem(cron.schedule);
    if (problem) {
      violations.push({ ...cron, reason: problem });
    }

    const file = routeFileFor(cron.path);
    if (!file) {
      violations.push({ ...cron, reason: "path must start with '/'" });
    } else if (!existsSync(resolve(process.cwd(), file))) {
      violations.push({ ...cron, reason: `no route at ${file}` });
    } else if (!exportsGet(readFileSync(resolve(process.cwd(), file), "utf-8"))) {
      violations.push({ ...cron, reason: `${file} does not export GET` });
    }
  }

  if (violations.length === 0) {
    console.log(`✓ All ${crons.length} cron entries are valid and reach a GET handler.`);
    process.exit(0);
  }

  console.error("\n✗ vercel.json cron entries that would fail:\n");
  for (const v of violations) {
    console.error(`  ${v.path}`);
    console.error(`    schedule: "${v.schedule}"`);
    console.error(`    reason:   ${v.reason}\n`);
  }
  process.exit(1);
}

main();

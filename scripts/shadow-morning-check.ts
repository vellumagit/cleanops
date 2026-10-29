/**
 * The morning check for the job-state shadow week. Read-only.
 *
 *   pnpm tsx --env-file=.env.local scripts/shadow-morning-check.ts [orgId] [hoursBack]
 *
 * Defaults to Svit, last 36 hours. The report itself lives in
 * src/lib/morning-check.ts; /api/cron/morning-check emails the same report
 * at 8 AM Edmonton, so this is for a second look or another window.
 */
import { createClient } from "@supabase/supabase-js";
import { MORNING_CHECK_DEFAULT_ORG, runMorningCheck } from "../src/lib/morning-check";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
const db = createClient(url, key);

/**
 * Alberta stopped changing its clocks (official 2026-06-18; IANA tzdata
 * 2026c): America/Edmonton is UTC-6 year-round from 2026-11-01. Production
 * has that data; a local Node on 2026b or older still falls Edmonton back
 * to UTC-7 and would print every winter time an hour early. Regina has
 * been on permanent UTC-6 all along, so it is the exact same clock.
 */
function localZoneFor(tz: string): string {
  const tzdata = process.versions.tz ?? "";
  if (tz === "America/Edmonton" && tzdata < "2026c") {
    console.warn(`(local tzdata ${tzdata} predates Alberta's permanent UTC-6 — formatting Edmonton as America/Regina)`);
    return "America/Regina";
  }
  return tz;
}

async function main() {
  const report = await runMorningCheck(db, {
    orgId: process.argv[2] ?? MORNING_CHECK_DEFAULT_ORG,
    hoursBack: Number(process.argv[3] ?? "36"),
    zoneFor: localZoneFor,
  });
  console.log("");
  console.log(report.flags.length ? `LOOK AT:\n${report.flags.map((f) => `  - ${f}`).join("\n")}` : "CLEAN — nothing to look at.");
  console.log("");
  console.log(report.lines.join("\n"));
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

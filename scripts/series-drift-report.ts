/**
 * Every future series visit whose stored time doesn't match its series under
 * the current zone rules, grouped by client, with what the office should do.
 * Read-only. Writes reports/series-drift-<date>.md (gitignored).
 *
 *   npx tsx --env-file=.env.local scripts/series-drift-report.ts [orgId]
 *
 * Same decision as the dashboard's "Needs you" list (src/lib/series-drift.ts),
 * plus one more piece of evidence the dashboard doesn't show: whether the
 * series' visits BEFORE the Nov 1 clock change sat at the series' time. If
 * they did, and the winter ones are exactly an hour late, the hour is the
 * zone rules and Restore is safe. If October was already off the template,
 * the office was booking that client at a different time on purpose, and
 * only they know whether Restore or Keep is right.
 *
 * Times are formatted as America/Regina (UTC-6 forever) so this prints the
 * right wall clock on a machine with old Alberta rules too.
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { findSeriesDrift } from "../src/lib/series-drift";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
const db = createClient(url, key);
const orgId = process.argv[2] ?? "4cf4c402-5889-43c9-91f3-7186f66ee08b";
const WINTER_FROM = "2026-11-01T06:00:00Z";
const DISPLAY_TZ = "America/Regina";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone: DISPLAY_TZ, hour: "numeric", minute: "2-digit" });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: DISPLAY_TZ, weekday: "short", month: "short", day: "numeric" });

async function main() {
  const now = Date.now();
  const { data: org } = await db.from("organizations").select("name, timezone").eq("id", orgId).maybeSingle();
  const { data: seriesRows } = await db
    .from("booking_series")
    .select("id, start_time, pattern, active, client:clients ( name )")
    .eq("organization_id", orgId);
  const series = (seriesRows ?? []).map((s) => ({
    id: s.id,
    start_time: String(s.start_time),
    clientName: ((s.client as unknown as { name: string | null } | null)?.name) ?? "A client",
    pattern: s.pattern as string,
    active: s.active as boolean,
  }));

  // time_set_by_hand_at arrives with migration 20261030010000; before it runs
  // every visit counts as the series' own.
  const load = (cols: string) =>
    db
      .from("bookings")
      .select(cols)
      .eq("organization_id", orgId)
      .not("series_id", "is", null)
      .is("archived_at", null)
      .gte("scheduled_at", "2026-09-01T00:00:00Z")
      .order("scheduled_at")
      .limit(5000);
  let visitRes = await load("id, series_id, scheduled_at, status, time_set_by_hand_at, created_at");
  if (visitRes.error) {
    console.log(`(${visitRes.error.message} — reading without time_set_by_hand_at)`);
    visitRes = await load("id, series_id, scheduled_at, status, created_at");
  }
  const visits = ((visitRes.data ?? []) as unknown as Array<{
    id: string; series_id: string; scheduled_at: string; status: string; time_set_by_hand_at?: string | null; created_at: string;
  }>).map((v) => ({ ...v, time_set_by_hand_at: v.time_set_by_hand_at ?? null }));

  // What the computed drift check would show on the dashboard.
  const drift = findSeriesDrift({
    series,
    visits: visits.filter((v) => v.scheduled_at >= new Date(now).toISOString()),
    tz: DISPLAY_TZ, // UTC-6 forever = what production's current Edmonton rules give
    now,
  });

  // Evidence: the latest pre-winter visit of each series, any status but cancelled.
  const lastBefore = new Map<string, string>();
  for (const v of visits) {
    if (v.scheduled_at >= WINTER_FROM || v.status === "cancelled") continue;
    lastBefore.set(v.series_id, v.scheduled_at);
  }

  type Verdict = "restore" | "ask";
  const rows: Array<{ client: string; seriesTime: string; pattern: string; n: number; verdict: Verdict; why: string; lines: string[] }> = [];
  let restoreVisits = 0, askVisits = 0;
  for (const d of drift) {
    const s = series.find((x) => x.id === d.seriesId)!;
    const allHourLate = d.visits.every((v) => v.deltaMinutes === 60);
    const prior = lastBefore.get(d.seriesId);
    const priorOnTime = prior ? time(prior) === time(d.visits[0].expected_at) : false;
    const verdict: Verdict = allHourLate && priorOnTime ? "restore" : "ask";
    const why =
      verdict === "restore"
        ? `every visit is exactly an hour late and the ${day(prior!)} visit was at ${time(prior!)}, the series' time`
        : !prior
          ? "no visit before Nov 1 to compare against"
          : !allHourLate
            ? `not a flat hour: ${[...new Set(d.visits.map((v) => v.deltaMinutes))].map((m) => `${m > 0 ? "+" : ""}${m} min`).join(", ")}`
            : `October visits were at ${time(prior)}, not the series' ${time(d.visits[0].expected_at)} — booked off-template on purpose?`;
    if (verdict === "restore") restoreVisits += d.visits.length; else askVisits += d.visits.length;
    rows.push({
      client: d.clientName,
      seriesTime: time(d.visits[0].expected_at),
      pattern: s.pattern,
      n: d.visits.length,
      verdict,
      why,
      lines: d.visits.map((v) => `${day(v.scheduled_at)} — now ${time(v.scheduled_at)}, series says ${time(v.expected_at)}`),
    });
  }
  rows.sort((a, b) => (a.verdict === b.verdict ? a.client.localeCompare(b.client) : a.verdict === "restore" ? -1 : 1));

  const ymd = new Date().toISOString().slice(0, 10);
  const md: string[] = [];
  md.push(`# ${org?.name ?? orgId} — recurring visits that don't match their series`);
  md.push("");
  md.push(`Checked ${new Date().toLocaleString("en-US", { timeZone: DISPLAY_TZ })} Edmonton. ${drift.length} series, ${restoreVisits + askVisits} future visits. Times in Alberta time (UTC-6).`);
  md.push("");
  md.push("**Why.** Alberta stays on UTC-6 from Nov 1 instead of falling back. Sollos's server used the old rules until about Sep 29, so winter visits generated before then were saved an hour late. Visits created from Sep 29 on are right.");
  md.push("");
  md.push(`**Restore** (${rows.filter((r) => r.verdict === "restore").length} series, ${restoreVisits} visits): exactly an hour late, and the client's October visits were at the series' time. Safe to restore. **Ask Svitlana** (${rows.filter((r) => r.verdict === "ask").length} series, ${askVisits} visits): this client was already being booked off the series' time before November, so only she knows which time is right.`);
  md.push("");
  md.push("Both buttons are on the dashboard under **Needs you**: *Restore to 9:00 AM* moves the visits back; *Keep these times* leaves them and stops asking. Nobody is notified either way; Google calendars update overnight.");
  md.push("");
  for (const verdict of ["restore", "ask"] as Verdict[]) {
    md.push(`## ${verdict === "restore" ? "Restore" : "Ask Svitlana"}`);
    md.push("");
    for (const r of rows.filter((x) => x.verdict === verdict)) {
      md.push(`### ${r.client} — series at ${r.seriesTime}, ${r.pattern.replace(/_/g, " ")}, ${r.n} ${r.n === 1 ? "visit" : "visits"}`);
      md.push("");
      md.push(`${r.why}.`);
      md.push("");
      for (const l of r.lines) md.push(`- ${l}`);
      md.push("");
    }
  }
  md.push("## Making sure it doesn't happen again");
  md.push("");
  md.push("- The series generator refuses to run when the server's zone rules are out of date (`runtimeKnowsZone`, src/lib/tz-probe.ts), so visits can't be generated an hour off again.");
  md.push("- Every future visit is compared to its series under the current rules on every dashboard load and every 30 minutes. Anything that differs, and that nobody set by hand, appears under Needs you with Restore and Keep.");
  md.push("- From now on the edit form, the calendar drag and the API record when a person sets a visit's time (`bookings.time_set_by_hand_at`), so a deliberate move is never mistaken for drift.");
  md.push("- Devices with old zone rules see a banner telling them their times are showing an hour early.");
  md.push("");

  mkdirSync("reports", { recursive: true });
  const path = `reports/series-drift-${ymd}.md`;
  writeFileSync(path, md.join("\n"));
  console.log(md.slice(0, 8).join("\n"));
  console.log(`\nFull list: ${path}`);
  for (const r of rows) console.log(`${r.verdict.padEnd(8)} ${String(r.n).padStart(2)}  ${r.client.padEnd(42)} series ${r.seriesTime}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

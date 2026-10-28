/**
 * Alberta's permanent UTC-6: find (and, with --apply, fix) visits stored an
 * hour late.
 *
 *   npx tsx --env-file=.env.local scripts/fix-alberta-winter-times.ts [orgId]          # dry run
 *   npx tsx --env-file=.env.local scripts/fix-alberta-winter-times.ts [orgId] --apply  # write
 *
 * What happened. Alberta stopped changing its clocks (official 2026-06-18;
 * IANA tzdata 2026c, 2026-07-08): from 2026-11-01 America/Edmonton stays at
 * UTC-6. Until about 2026-09-29 production ran older tzdata, which still fell
 * Edmonton back to UTC-7 in November. Every visit generated before then for a
 * date on or after Nov 1 was stored as "9:00 AM at UTC-7" = 16:00Z, which in
 * real Alberta time is 10:00 AM. The client was told 9:00 (the stale server
 * formatted it that way); the calendar now says 10:00.
 *
 * What counts as a clear case (repaired by --apply):
 *   - a series visit, not cancelled or completed, on or after Nov 1;
 *   - created before CUTOFF;
 *   - its UTC-6 wall time is exactly the series start time + 60 minutes;
 *   - the series' latest visit before Nov 1 sits exactly at the series start
 *     time — proof the template still says what the visits were meant to be,
 *     and the hour is the zone, not a deliberate move.
 * Everything else that looks off is listed for a person to check and left
 * alone, as are one-off bookings created before CUTOFF for a winter date
 * (nothing records the time they were meant for).
 *
 * --apply moves each clear case one hour earlier, writes a backup of every
 * original value to reports/alberta-repair-<ts>.json (gitignored), and logs
 * one audit row per visit. It sends nothing: the client was already told the
 * right time, and the nightly calendar reconcile re-pushes the events.
 *
 * Reads every time as America/Regina (UTC-6 forever), never the local
 * Edmonton rules: local Node here has stale tzdata, and on 2026-10-08 reading
 * winter times through it produced a wrong "repair" (see memory).
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
const db = createClient(url, key);

const orgId = process.argv.find((a) => /^[0-9a-f-]{36}$/.test(a)) ?? "4cf4c402-5889-43c9-91f3-7186f66ee08b";
const APPLY = process.argv.includes("--apply");
/** Midnight Nov 1 in Alberta time. */
const WINTER_FROM = "2026-11-01T06:00:00Z";
/** First day every winter visit production generated was right. */
const CUTOFF = "2026-09-29T00:00:00Z";

const wall = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "America/Regina",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/Regina",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const label = (t: string) => {
  const m = mins(t);
  const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

type Row = {
  id: string;
  scheduled_at: string;
  series_id: string | null;
  status: string;
  created_at: string;
  client: { name: string | null } | null;
};

async function main() {
  const { data: org } = await db.from("organizations").select("name, timezone").eq("id", orgId).maybeSingle();
  if (org?.timezone !== "America/Edmonton") {
    console.log(`${org?.name ?? orgId} is on ${org?.timezone}; nothing to do.`);
    return;
  }
  const { data: series } = await db.from("booking_series").select("id, start_time").eq("organization_id", orgId);
  const startOf = new Map((series ?? []).map((s) => [s.id, String(s.start_time).slice(0, 5)]));

  const { data: rowsRaw, error } = await db
    .from("bookings")
    .select("id, scheduled_at, series_id, status, created_at, client:clients ( name )")
    .eq("organization_id", orgId)
    .gte("scheduled_at", "2026-09-01T00:00:00Z")
    .not("status", "in", "(cancelled,completed)")
    .is("archived_at", null)
    .order("scheduled_at")
    .limit(10000);
  if (error) throw new Error(error.message);
  const rows = (rowsRaw ?? []) as unknown as Row[];

  // Latest pre-winter visit per series: does it sit at the template's time?
  const lastBefore = new Map<string, Row>();
  for (const b of rows) {
    if (!b.series_id || b.scheduled_at >= WINTER_FROM) continue;
    lastBefore.set(b.series_id, b);
  }
  // Completed visits count as evidence too (they're how October looked).
  const { data: doneRaw } = await db
    .from("bookings")
    .select("id, scheduled_at, series_id, status, created_at, client:clients ( name )")
    .eq("organization_id", orgId)
    .eq("status", "completed")
    .gte("scheduled_at", "2026-09-01T00:00:00Z")
    .lt("scheduled_at", WINTER_FROM)
    .not("series_id", "is", null)
    .order("scheduled_at");
  for (const b of (doneRaw ?? []) as unknown as Row[]) {
    const cur = lastBefore.get(b.series_id!);
    if (!cur || cur.scheduled_at < b.scheduled_at) lastBefore.set(b.series_id!, b);
  }

  const clear: Array<Row & { from: string; to: string }> = [];
  const review: Array<{ row: Row; why: string }> = [];
  for (const b of rows) {
    if (b.scheduled_at < WINTER_FROM || b.created_at >= CUTOFF) continue;
    if (!b.series_id) {
      review.push({ row: b, why: "one-off booked before the fix; no record of the intended time" });
      continue;
    }
    const want = startOf.get(b.series_id);
    if (!want) continue;
    const got = wall(b.scheduled_at);
    const delta = mins(got) - mins(want);
    if (delta === 0) continue;
    if (delta !== 60) {
      review.push({ row: b, why: `series says ${label(want)}, visit is ${label(got)} — moved by hand?` });
      continue;
    }
    const prior = lastBefore.get(b.series_id);
    if (!prior || wall(prior.scheduled_at) !== want) {
      review.push({
        row: b,
        why: `an hour after the series' ${label(want)}, but its October visits were at ${prior ? label(wall(prior.scheduled_at)) : "no time on record"}`,
      });
      continue;
    }
    clear.push({ ...b, from: b.scheduled_at, to: new Date(new Date(b.scheduled_at).getTime() - 3_600_000).toISOString() });
  }

  console.log(`${org.name}: ${clear.length} visit(s) an hour late from the old zone rules; ${review.length} to check by hand.\n`);
  console.log("CLEAR — will move one hour earlier:");
  for (const c of clear) {
    console.log(`  ${day(c.from).padEnd(12)} ${label(wall(c.from)).padStart(8)} -> ${label(wall(c.to)).padStart(8)}  ${c.client?.name ?? "?"}`);
  }
  console.log("\nCHECK BY HAND — left alone:");
  for (const r of review) {
    console.log(`  ${day(r.row.scheduled_at).padEnd(12)} ${label(wall(r.row.scheduled_at)).padStart(8)}  ${(r.row.client?.name ?? "?").padEnd(28)} ${r.why}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Nothing written. Re-run with --apply to move the CLEAR visits.");
    return;
  }

  mkdirSync("reports", { recursive: true });
  const backup = `reports/alberta-repair-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backup, JSON.stringify(clear.map((c) => ({ id: c.id, scheduled_at: c.from, to: c.to })), null, 2));
  console.log(`\nBackup of original times: ${backup}`);

  let moved = 0;
  for (const c of clear) {
    // Guard on the time we read, so a visit someone moved in the meantime
    // is left alone.
    const { data: upd, error: updErr } = await db
      .from("bookings")
      .update({ scheduled_at: c.to })
      .eq("id", c.id)
      .eq("scheduled_at", c.from)
      .select("id");
    if (updErr || !upd || upd.length === 0) {
      console.log(`  skipped ${c.id}: ${updErr?.message ?? "changed since read"}`);
      continue;
    }
    await db.from("audit_log").insert({
      organization_id: orgId,
      actor_id: null,
      action: "update",
      entity: "booking",
      entity_id: c.id,
      before: { scheduled_at: c.from },
      after: { scheduled_at: c.to, via: "alberta_tz_repair" },
    } as never);
    moved++;
  }
  console.log(`Moved ${moved} of ${clear.length}. Calendars catch up on the nightly reconcile (45-day window).`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

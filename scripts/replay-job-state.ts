/**
 * Run the computed job state (src/lib/job-state.ts) over an org's real
 * history and report where it disagrees with the status on the row.
 *
 *   pnpm tsx --env-file=.env.local scripts/replay-job-state.ts [orgId] [sinceYYYY-MM-DD]
 *
 * Defaults to Svit from 2026-08-01. Read-only.
 *
 * Two comparisons, because they answer different questions:
 *   honoured — closed_at respected. Any disagreement here is a bug in the
 *              rules or a wrong row, and must be explained before the rules
 *              take over writing.
 *   unaided  — closed_at ignored: what the rules would have reached from
 *              shifts and the schedule alone. Disagreements here are where a
 *              person had to step in. Expected; useful for seeing how often.
 */
import { createClient } from "@supabase/supabase-js";
import { deriveJobState, type JobStateShift } from "../src/lib/job-state";
import { resolveAutomationEnabled } from "../src/lib/automation-defaults";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
const db = createClient(url, key);

const orgId = process.argv[2] ?? "4cf4c402-5889-43c9-91f3-7186f66ee08b";
const since = process.argv[3] ?? "2026-08-01";
const now = Date.now();

type Row = {
  id: string;
  status: string;
  scheduled_at: string;
  duration_minutes: number;
  total_cents: number | null;
  hourly_rate_cents: number | null;
  is_free: boolean | null;
  closed_at?: string | null;
  updated_at: string;
  client: { name: string | null } | null;
};

async function main() {
  const { data: org } = await db
    .from("organizations")
    .select("name, timezone, automation_settings, booking_auto_complete_hours")
    .eq("id", orgId)
    .single();
  if (!org) throw new Error("org not found");
  const autoOn = resolveAutomationEnabled(
    (org.automation_settings as Record<string, { enabled?: boolean } | undefined> | null) ?? null,
    "auto_complete_past_bookings",
  );
  const h = org.booking_auto_complete_hours;
  const autoCompleteAfterMinutes = autoOn && h != null && h >= 1 ? h * 60 : null;
  const tz = org.timezone ?? "America/Edmonton";

  // closed_at only exists once migration 20261028010000 has run. Before
  // that, treat completed as closed at its last update — the backfill does
  // the same.
  const probe = await db.from("bookings").select("closed_at").limit(1);
  const hasClosedAt = !probe.error;
  const cols =
    "id, status, scheduled_at, duration_minutes, total_cents, hourly_rate_cents, is_free, updated_at, client:clients ( name )" +
    (hasClosedAt ? ", closed_at" : "");
  const { data: rows, error } = await db
    .from("bookings")
    .select(cols)
    .eq("organization_id", orgId)
    .gte("scheduled_at", since)
    .lt("scheduled_at", new Date(now).toISOString())
    .order("scheduled_at");
  if (error) throw error;
  const bookings = (rows ?? []) as unknown as Row[];

  const ids = bookings.map((b) => b.id);
  const crewBy = new Map<string, Array<{ membership_id: string; split_start_offset_minutes: number | null; split_duration_minutes: number | null }>>();
  const shiftsBy = new Map<string, JobStateShift[]>();
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const [{ data: crew }, { data: shifts }] = await Promise.all([
      db.from("booking_assignees").select("booking_id, membership_id, split_start_offset_minutes, split_duration_minutes").in("booking_id", chunk),
      db.from("time_entries").select("booking_id, employee_id, clock_in_at, clock_out_at").in("booking_id", chunk),
    ]);
    for (const c of crew ?? []) {
      const list = crewBy.get(c.booking_id) ?? [];
      list.push(c);
      crewBy.set(c.booking_id, list);
    }
    for (const s of shifts ?? []) {
      if (!s.booking_id) continue;
      const list = shiftsBy.get(s.booking_id) ?? [];
      list.push(s);
      shiftsBy.set(s.booking_id, list);
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-CA", { timeZone: tz, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  type Dis = { b: Row; derived: string; phase: string; shifts: number; crew: number; needs: string[] };
  const honoured: Dis[] = [];
  const unaided: Dis[] = [];
  const unaidedCounts = new Map<string, number>();
  const needsPrice: Row[] = [];

  for (const b of bookings) {
    const crew = crewBy.get(b.id) ?? [];
    const shifts = shiftsBy.get(b.id) ?? [];
    const closedAt = hasClosedAt ? (b.closed_at ?? null) : b.status === "completed" ? b.updated_at : null;
    const base = { ...b, total_cents: b.total_cents, closed_at: closedAt };

    const h1 = deriveJobState({ booking: base, crew, shifts, now, autoCompleteAfterMinutes });
    if (h1.status !== b.status) {
      honoured.push({ b, derived: h1.status, phase: h1.phase, shifts: shifts.length, crew: crew.length, needs: h1.needs });
    }
    if (h1.needs.includes("price")) needsPrice.push(b);

    const h2 = deriveJobState({ booking: { ...base, closed_at: null }, crew, shifts, now, autoCompleteAfterMinutes });
    const k = `${b.status} → ${h2.status} (${h2.phase})`;
    unaidedCounts.set(k, (unaidedCounts.get(k) ?? 0) + 1);
    if (h2.status !== b.status) {
      unaided.push({ b, derived: h2.status, phase: h2.phase, shifts: shifts.length, crew: crew.length, needs: h2.needs });
    }
  }

  console.log(`\n${org.name} — ${bookings.length} jobs since ${since} (closed_at column: ${hasClosedAt ? "yes" : "not yet"}; auto-complete after: ${autoCompleteAfterMinutes ?? "off"} min)\n`);

  console.log(`HONOURED (closed_at respected) — ${honoured.length} disagreement(s). Each one is a bug or a bad row:`);
  for (const d of honoured) {
    console.log(`  ${fmt(d.b.scheduled_at)}  ${(d.b.client?.name ?? "?").padEnd(26)} row=${d.b.status.padEnd(11)} computed=${d.derived} (${d.phase})  crew=${d.crew} shifts=${d.shifts}${d.needs.length ? "  needs " + d.needs.join(",") : ""}  ${d.b.id}`);
  }

  console.log(`\nUNAIDED (closed_at ignored) — row status → what the rules reach on their own:`);
  for (const [k, n] of [...unaidedCounts.entries()].sort((a, b2) => b2[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }
  const interesting = unaided.filter((d) => !(d.b.status === "completed" && d.derived === "completed"));
  console.log(`\n  ${interesting.length} where a person stepped in or would have to (first 40):`);
  for (const d of interesting.slice(0, 40)) {
    console.log(`  ${fmt(d.b.scheduled_at)}  ${(d.b.client?.name ?? "?").padEnd(26)} row=${d.b.status.padEnd(11)} rules=${d.derived} (${d.phase})  crew=${d.crew} shifts=${d.shifts}  ${d.b.id}`);
  }

  console.log(`\nDONE WITH NO PRICE (and not marked free): ${needsPrice.length}`);
  for (const b of needsPrice.slice(0, 20)) {
    console.log(`  ${fmt(b.scheduled_at)}  ${b.client?.name ?? "?"}  ${b.id}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

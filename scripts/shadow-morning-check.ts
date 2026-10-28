/**
 * The morning check for the job-state shadow week. Read-only.
 *
 *   pnpm tsx --env-file=.env.local scripts/shadow-morning-check.ts [orgId] [hoursBack]
 *
 * Defaults to Svit, last 36 hours. Answers, in order:
 *   1. Did the computed state disagree with the row? (audit_log state_check)
 *   2. Which "Needs you" alerts went out, and the night-before digest?
 *   3. What did managers actually receive? (notifications)
 *   4. Yesterday's, today's and tomorrow's jobs: row vs computed state.
 *   5. Who is on the clock right now?
 */
import { createClient } from "@supabase/supabase-js";
import { deriveJobState, type JobStateShift } from "../src/lib/job-state";
import { resolveAutomationEnabled } from "../src/lib/automation-defaults";
import { zonedDayBoundsUtc } from "../src/lib/wall-clock";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
const db = createClient(url, key);

const orgId = process.argv[2] ?? "4cf4c402-5889-43c9-91f3-7186f66ee08b";
const hoursBack = Number(process.argv[3] ?? "36");
const now = Date.now();
const sinceIso = new Date(now - hoursBack * 3_600_000).toISOString();

type Member = { display_name: string | null; profile: { full_name: string | null } | null } | null;
const nameOf = (m: Member) => m?.display_name?.trim() || m?.profile?.full_name?.trim() || "?";

async function main() {
  const { data: org } = await db
    .from("organizations")
    .select("name, timezone, automation_settings, booking_auto_complete_hours")
    .eq("id", orgId)
    .single();
  if (!org) throw new Error("org not found");
  const tz = org.timezone ?? "America/Edmonton";
  const autoOn = resolveAutomationEnabled(
    (org.automation_settings as Record<string, { enabled?: boolean } | undefined> | null) ?? null,
    "auto_complete_past_bookings",
  );
  const h = org.booking_auto_complete_hours;
  const autoCompleteAfterMinutes = autoOn && h != null && h >= 1 ? h * 60 : null;
  const orgDivides = resolveAutomationEnabled(
    (org.automation_settings as Record<string, { enabled?: boolean } | undefined> | null) ?? null,
    "divide_crew_hours",
  );
  const fmt = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleString("en-CA", { timeZone: tz, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";

  console.log(`\n${org.name} — morning check at ${fmt(new Date(now).toISOString())} (${tz}), looking back ${hoursBack}h`);
  console.log(`auto-complete after window end: ${autoCompleteAfterMinutes ?? "off"} min; JOB_STATE_WRITE=${process.env.JOB_STATE_WRITE ?? "(unset → shadow)"}\n`);

  // 1. Shadow disagreements -------------------------------------------------
  const { data: checks, error: cErr } = await db
    .from("audit_log")
    .select("entity_id, created_at, after")
    .eq("organization_id", orgId)
    .eq("action", "state_check")
    .gte("created_at", sinceIso)
    .order("created_at");
  if (cErr) throw cErr;
  const checkIds = Array.from(new Set((checks ?? []).map((c) => c.entity_id).filter(Boolean))) as string[];
  const clientByBooking = new Map<string, string>();
  if (checkIds.length) {
    const { data: bs } = await db.from("bookings").select("id, client:clients ( name )").in("id", checkIds);
    for (const b of (bs ?? []) as unknown as Array<{ id: string; client: { name: string | null } | null }>) {
      clientByBooking.set(b.id, b.client?.name ?? "?");
    }
  }
  console.log(`1. STATE CHECKS (computed state disagreed with the row): ${checks?.length ?? 0}`);
  const byKind = new Map<string, number>();
  for (const c of checks ?? []) {
    const a = (c.after ?? {}) as Record<string, unknown>;
    const k = `${a.actual} → ${a.derived} (${a.phase}) via ${a.reason}`;
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...byKind.entries()].sort((x, y) => y[1] - x[1])) console.log(`   ${String(n).padStart(3)}  ${k}`);
  for (const c of (checks ?? []).slice(0, 40)) {
    const a = (c.after ?? {}) as Record<string, unknown>;
    console.log(`   ${fmt(c.created_at)}  ${(clientByBooking.get(c.entity_id ?? "") ?? "?").padEnd(24)} row=${String(a.actual).padEnd(11)} computed=${String(a.derived).padEnd(11)} ${a.summary ?? ""}  ${c.entity_id}`);
  }

  // 2. Alerts marked sent ---------------------------------------------------
  const { data: alerts } = (await db
    .from("needs_you_state" as never)
    .select("key, notified_at, snoozed_until")
    .eq("organization_id" as never, orgId as never)
    .or(`notified_at.gte.${sinceIso},snoozed_until.gte.${sinceIso}` as never)
    .order("notified_at" as never)) as unknown as {
    data: Array<{ key: string; notified_at: string | null; snoozed_until: string | null }> | null;
  };
  console.log(`\n2. NEEDS-YOU ALERTS MARKED SENT / SNOOZED: ${alerts?.length ?? 0}`);
  for (const a of alerts ?? []) {
    console.log(`   sent ${fmt(a.notified_at).padEnd(16)} ${a.snoozed_until ? `snoozed until ${fmt(a.snoozed_until)}  ` : ""}${a.key}`);
  }
  const digest = (alerts ?? []).find((a) => a.key.startsWith("night_before:"));
  console.log(`   night-before digest: ${digest ? `${digest.key} at ${fmt(digest.notified_at)}` : "NOT marked in this window"}`);

  // 3. What managers received ----------------------------------------------
  const { data: notes } = await db
    .from("notifications")
    .select("title, body, created_at, recipient_membership_id, href, type")
    .eq("organization_id", orgId)
    .gte("created_at", sinceIso)
    .order("created_at");
  const grouped = new Map<string, { n: number; first: string; body: string | null }>();
  for (const n of notes ?? []) {
    const k = `${n.type} | ${n.title}`;
    const g = grouped.get(k);
    if (g) g.n++;
    else grouped.set(k, { n: 1, first: n.created_at, body: n.body });
  }
  console.log(`\n3. NOTIFICATIONS WRITTEN (all types): ${notes?.length ?? 0} rows, ${grouped.size} distinct`);
  for (const [k, g] of grouped) {
    console.log(`   ${fmt(g.first)}  ×${String(g.n).padEnd(3)} ${k}`);
    if (g.body && /Needs you|Tomorrow|hasn't|still on the clock|Close it|price/i.test(k + g.body)) {
      console.log(`                      ${g.body.replace(/\n/g, " / ").slice(0, 160)}`);
    }
  }

  // 4. Jobs yesterday → tomorrow --------------------------------------------
  const { start } = zonedDayBoundsUtc(new Date(now), tz, -1);
  const { end } = zonedDayBoundsUtc(new Date(now), tz, 1);
  const { data: rows, error: bErr } = await db
    .from("bookings")
    .select("id, status, scheduled_at, duration_minutes, total_cents, hourly_rate_cents, is_free, closed_at, divide_hours_evenly, client:clients ( name )")
    .eq("organization_id", orgId)
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString())
    .neq("status", "cancelled")
    .order("scheduled_at");
  if (bErr) throw bErr;
  type Row = {
    id: string; status: string; scheduled_at: string; duration_minutes: number;
    total_cents: number | null; hourly_rate_cents: number | null; is_free: boolean | null;
    closed_at: string | null; divide_hours_evenly: boolean | null; client: { name: string | null } | null;
  };
  const jobs = (rows ?? []) as unknown as Row[];
  const ids = jobs.map((j) => j.id);
  const [{ data: crew }, { data: shifts }] = ids.length
    ? await Promise.all([
        db.from("booking_assignees").select("booking_id, membership_id, split_start_offset_minutes, split_duration_minutes, acceptance_status, membership:memberships ( display_name, profile:profiles ( full_name ) )").in("booking_id", ids),
        db.from("time_entries").select("booking_id, employee_id, clock_in_at, clock_out_at, auto_closed_at, employee:memberships!time_entries_employee_id_fkey ( display_name, profile:profiles ( full_name ) )").in("booking_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  type CrewRow = { booking_id: string; membership_id: string; split_start_offset_minutes: number | null; split_duration_minutes: number | null; acceptance_status: string | null; membership: Member };
  type ShiftRow = JobStateShift & { booking_id: string | null; auto_closed_at: string | null; employee: Member };
  const crewBy = new Map<string, CrewRow[]>();
  for (const c of (crew ?? []) as unknown as CrewRow[]) crewBy.set(c.booking_id, [...(crewBy.get(c.booking_id) ?? []), c]);
  const shiftsBy = new Map<string, ShiftRow[]>();
  for (const s of (shifts ?? []) as unknown as ShiftRow[]) if (s.booking_id) shiftsBy.set(s.booking_id, [...(shiftsBy.get(s.booking_id) ?? []), s]);

  console.log(`\n4. JOBS ${fmt(start.toISOString())} → ${fmt(end.toISOString())}: ${jobs.length}`);
  for (const j of jobs) {
    const c = crewBy.get(j.id) ?? [];
    const s = shiftsBy.get(j.id) ?? [];
    const st = deriveJobState({
      booking: { ...j, divides_hours: j.divide_hours_evenly === true || orgDivides },
      crew: c,
      shifts: s,
      now,
      autoCompleteAfterMinutes,
    });
    const flag = st.status !== j.status ? "  <-- DISAGREES" : "";
    const price = j.is_free ? "free" : j.total_cents ? `$${(j.total_cents / 100).toFixed(0)}` : j.hourly_rate_cents ? `$${(j.hourly_rate_cents / 100).toFixed(0)}/h` : "NO PRICE";
    console.log(`   ${fmt(j.scheduled_at)}  ${(j.client?.name ?? "?").padEnd(24)} row=${j.status.padEnd(11)} computed=${st.status.padEnd(11)} phase=${st.phase.padEnd(16)} ${price.padEnd(8)} ${st.needs.length ? "needs " + st.needs.join(",") : ""}${flag}`);
    for (const m of c) {
      const mine = s.filter((x) => x.employee_id === m.membership_id);
      const desc = mine.length
        ? mine.map((x) => `${fmt(x.clock_in_at)}–${x.clock_out_at ? fmt(x.clock_out_at).split(", ").pop() : "OPEN"}${x.auto_closed_at ? " (auto-closed)" : ""}`).join("; ")
        : "no shift";
      console.log(`        ${nameOf(m.membership).padEnd(18)} ${(m.acceptance_status ?? "—").padEnd(9)} ${desc}`);
    }
    if (j.closed_at) console.log(`        closed_at ${fmt(j.closed_at)}`);
  }

  // 5. On the clock now -----------------------------------------------------
  const { data: open } = await db
    .from("time_entries")
    .select("clock_in_at, booking:bookings ( scheduled_at, client:clients ( name ) ), employee:memberships!time_entries_employee_id_fkey ( display_name, profile:profiles ( full_name ) )")
    .eq("organization_id", orgId)
    .is("clock_out_at", null);
  type OpenRow = { clock_in_at: string; booking: { scheduled_at: string; client: { name: string | null } | null } | null; employee: Member };
  const openRows = (open ?? []) as unknown as OpenRow[];
  console.log(`\n5. ON THE CLOCK NOW: ${openRows.length}`);
  for (const o of openRows) {
    const mins = Math.round((now - new Date(o.clock_in_at).getTime()) / 60_000);
    console.log(`   ${nameOf(o.employee).padEnd(18)} since ${fmt(o.clock_in_at)} (${mins} min)  ${o.booking?.client?.name ?? "no job"}`);
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

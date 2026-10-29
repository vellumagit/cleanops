/**
 * The morning check, as a report. Read-only.
 *
 * Shared by scripts/shadow-morning-check.ts (prints it) and
 * /api/cron/morning-check (emails it at 8 AM Edmonton), so the email and the
 * terminal can never disagree. Answers, in order:
 *   1. Did the computed state disagree with the row? (audit_log state_check)
 *   2. Which "Needs you" alerts went out, and the night-before digest?
 *   3. What did managers actually receive? (notifications)
 *   4. Yesterday's, today's and tomorrow's jobs: row vs computed state.
 *   5. Who is on the clock right now?
 *
 * Above the five answers sits a short list of what needs a look (flags).
 * A query that fails becomes a flag, never an empty section: a clean email
 * has to mean clean, not "couldn't read".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveJobState, type JobStateShift } from "./job-state";
import { resolveAutomationEnabled } from "./automation-defaults";
import { zonedDayBoundsUtc } from "./wall-clock";

/** Svit's org — the one the shadow week watches. */
export const MORNING_CHECK_DEFAULT_ORG = "4cf4c402-5889-43c9-91f3-7186f66ee08b";

/** Anyone still clocked in after this long is flagged. */
const LONG_OPEN_CLOCK_HOURS = 12;

export type MorningFlagInput = {
  stateChecks: number;
  disagreeingJobs: number;
  digestMarked: boolean;
  longOpenClocks: number;
  duplicateMessages: number;
  readErrors: string[];
};

/** What the reader should look at, most serious first. Empty means clean. */
export function morningFlags(f: MorningFlagInput): string[] {
  const out = f.readErrors.map((e) => `Could not read ${e} — this report is incomplete`);
  if (f.disagreeingJobs) out.push(`${f.disagreeingJobs} job(s) disagree with the computed state right now (section 4)`);
  if (f.stateChecks) out.push(`${f.stateChecks} state check(s) logged a disagreement (section 1)`);
  if (f.duplicateMessages) out.push(`${f.duplicateMessages} message(s) went to the same person twice (section 3)`);
  if (f.longOpenClocks) out.push(`${f.longOpenClocks} cleaner(s) on the clock ${LONG_OPEN_CLOCK_HOURS}+ hours (section 5)`);
  if (!f.digestMarked) out.push("Night-before digest not marked sent (section 2)");
  return out;
}

export type MorningCheck = { orgName: string; flags: string[]; lines: string[] };

type Member = { display_name: string | null; profile: { full_name: string | null } | null } | null;
const nameOf = (m: Member) => m?.display_name?.trim() || m?.profile?.full_name?.trim() || "?";

export async function runMorningCheck(
  db: SupabaseClient,
  opts: {
    orgId?: string;
    hoursBack?: number;
    now?: number;
    /** Override the org's zone for formatting (stale local tzdata). */
    zoneFor?: (tz: string) => string;
  } = {},
): Promise<MorningCheck> {
  const orgId = opts.orgId ?? MORNING_CHECK_DEFAULT_ORG;
  const hoursBack = opts.hoursBack ?? 36;
  const now = opts.now ?? Date.now();
  const sinceIso = new Date(now - hoursBack * 3_600_000).toISOString();
  const out: string[] = [];
  const readErrors: string[] = [];
  const failed = (what: string, err: { message: string } | null) => {
    if (err) readErrors.push(`${what} (${err.message})`);
  };

  const { data: org, error: orgErr } = await db
    .from("organizations")
    .select("name, timezone, automation_settings, booking_auto_complete_hours")
    .eq("id", orgId)
    .single();
  if (orgErr || !org) throw new Error(`org ${orgId} not readable: ${orgErr?.message ?? "not found"}`);
  const tz = (opts.zoneFor ?? ((z) => z))(org.timezone ?? "America/Edmonton");
  const settings = (org.automation_settings as Record<string, { enabled?: boolean } | undefined> | null) ?? null;
  const autoOn = resolveAutomationEnabled(settings, "auto_complete_past_bookings");
  const h = org.booking_auto_complete_hours;
  const autoCompleteAfterMinutes = autoOn && h != null && h >= 1 ? h * 60 : null;
  const orgDivides = resolveAutomationEnabled(settings, "divide_crew_hours");
  const fmt = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleString("en-CA", { timeZone: tz, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";

  out.push(`${org.name} — morning check at ${fmt(new Date(now).toISOString())} (${tz}), looking back ${hoursBack}h`);
  out.push(`auto-complete after window end: ${autoCompleteAfterMinutes ?? "off"} min; JOB_STATE_WRITE=${process.env.JOB_STATE_WRITE ?? "(unset → shadow)"}`, "");

  // 1. Shadow disagreements -------------------------------------------------
  const { data: checks, error: cErr } = await db
    .from("audit_log")
    .select("entity_id, created_at, after")
    .eq("organization_id", orgId)
    .eq("action", "state_check")
    .gte("created_at", sinceIso)
    .order("created_at");
  failed("state checks", cErr);
  const checkIds = Array.from(new Set((checks ?? []).map((c) => c.entity_id).filter(Boolean))) as string[];
  const clientByBooking = new Map<string, string>();
  if (checkIds.length) {
    const { data: bs, error } = await db.from("bookings").select("id, client:clients ( name )").in("id", checkIds);
    failed("client names for state checks", error);
    for (const b of (bs ?? []) as unknown as Array<{ id: string; client: { name: string | null } | null }>) {
      clientByBooking.set(b.id, b.client?.name ?? "?");
    }
  }
  out.push(`1. STATE CHECKS (computed state disagreed with the row): ${checks?.length ?? 0}`);
  const byKind = new Map<string, number>();
  for (const c of checks ?? []) {
    const a = (c.after ?? {}) as Record<string, unknown>;
    const k = `${a.actual} → ${a.derived} (${a.phase}) via ${a.reason}`;
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...byKind.entries()].sort((x, y) => y[1] - x[1])) out.push(`   ${String(n).padStart(3)}  ${k}`);
  for (const c of (checks ?? []).slice(0, 40)) {
    const a = (c.after ?? {}) as Record<string, unknown>;
    out.push(`   ${fmt(c.created_at)}  ${(clientByBooking.get(c.entity_id ?? "") ?? "?").padEnd(24)} row=${String(a.actual).padEnd(11)} computed=${String(a.derived).padEnd(11)} ${a.summary ?? ""}  ${c.entity_id}`);
  }

  // 2. Alerts marked sent ---------------------------------------------------
  const { data: alerts, error: aErr } = (await db
    .from("needs_you_state")
    .select("key, notified_at, snoozed_until")
    .eq("organization_id", orgId)
    .or(`notified_at.gte.${sinceIso},snoozed_until.gte.${sinceIso}`)
    .order("notified_at")) as {
    data: Array<{ key: string; notified_at: string | null; snoozed_until: string | null }> | null;
    error: { message: string } | null;
  };
  failed("Needs-you alerts", aErr);
  out.push("", `2. NEEDS-YOU ALERTS MARKED SENT / SNOOZED: ${alerts?.length ?? 0}`);
  for (const a of alerts ?? []) {
    out.push(`   sent ${fmt(a.notified_at).padEnd(16)} ${a.snoozed_until ? `snoozed until ${fmt(a.snoozed_until)}  ` : ""}${a.key}`);
  }
  const digest = (alerts ?? []).find((a) => a.key.startsWith("night_before:"));
  out.push(`   night-before digest: ${digest ? `${digest.key} at ${fmt(digest.notified_at)}` : "NOT marked in this window"}`);

  // 3. What managers received ----------------------------------------------
  const { data: notes, error: nErr } = await db
    .from("notifications")
    .select("title, body, created_at, recipient_membership_id, href, type")
    .eq("organization_id", orgId)
    .gte("created_at", sinceIso)
    .order("created_at");
  failed("notifications", nErr);
  const grouped = new Map<string, { n: number; first: string; body: string | null }>();
  const perPerson = new Map<string, number>();
  for (const n of notes ?? []) {
    const k = `${n.type} | ${n.title}`;
    const g = grouped.get(k);
    if (g) g.n++;
    else grouped.set(k, { n: 1, first: n.created_at, body: n.body });
    const p = `${n.recipient_membership_id}|${n.type}|${n.title}|${n.href}`;
    perPerson.set(p, (perPerson.get(p) ?? 0) + 1);
  }
  const duplicateMessages = [...perPerson.values()].filter((n) => n > 1).length;
  out.push("", `3. NOTIFICATIONS WRITTEN (all types): ${notes?.length ?? 0} rows, ${grouped.size} distinct, ${duplicateMessages} sent twice+ to one person`);
  for (const [k, g] of grouped) {
    out.push(`   ${fmt(g.first)}  ×${String(g.n).padEnd(3)} ${k}`);
    if (g.body && /Needs you|Tomorrow|hasn't|still on the clock|Close it|price/i.test(k + g.body)) {
      out.push(`                      ${g.body.replace(/\n/g, " / ").slice(0, 160)}`);
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
  failed("jobs", bErr);
  type Row = {
    id: string; status: string; scheduled_at: string; duration_minutes: number;
    total_cents: number | null; hourly_rate_cents: number | null; is_free: boolean | null;
    closed_at: string | null; divide_hours_evenly: boolean | null; client: { name: string | null } | null;
  };
  const jobs = (rows ?? []) as unknown as Row[];
  const ids = jobs.map((j) => j.id);
  const [{ data: crew, error: crewErr }, { data: shifts, error: shiftErr }] = ids.length
    ? await Promise.all([
        db.from("booking_assignees").select("booking_id, membership_id, split_start_offset_minutes, split_duration_minutes, acceptance_status, membership:memberships ( display_name, profile:profiles ( full_name ) )").in("booking_id", ids),
        db.from("time_entries").select("booking_id, employee_id, clock_in_at, clock_out_at, auto_closed_at, employee:memberships!time_entries_employee_id_fkey ( display_name, profile:profiles ( full_name ) )").in("booking_id", ids),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  failed("crew", crewErr);
  failed("shifts", shiftErr);
  type CrewRow = { booking_id: string; membership_id: string; split_start_offset_minutes: number | null; split_duration_minutes: number | null; acceptance_status: string | null; membership: Member };
  type ShiftRow = JobStateShift & { booking_id: string | null; auto_closed_at: string | null; employee: Member };
  const crewBy = new Map<string, CrewRow[]>();
  for (const c of (crew ?? []) as unknown as CrewRow[]) crewBy.set(c.booking_id, [...(crewBy.get(c.booking_id) ?? []), c]);
  const shiftsBy = new Map<string, ShiftRow[]>();
  for (const s of (shifts ?? []) as unknown as ShiftRow[]) if (s.booking_id) shiftsBy.set(s.booking_id, [...(shiftsBy.get(s.booking_id) ?? []), s]);

  let disagreeingJobs = 0;
  out.push("", `4. JOBS ${fmt(start.toISOString())} → ${fmt(end.toISOString())}: ${jobs.length}`);
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
    if (st.status !== j.status) disagreeingJobs++;
    const flag = st.status !== j.status ? "  <-- DISAGREES" : "";
    const price = j.is_free ? "free" : j.total_cents ? `$${(j.total_cents / 100).toFixed(0)}` : j.hourly_rate_cents ? `$${(j.hourly_rate_cents / 100).toFixed(0)}/h` : "NO PRICE";
    out.push(`   ${fmt(j.scheduled_at)}  ${(j.client?.name ?? "?").padEnd(24)} row=${j.status.padEnd(11)} computed=${st.status.padEnd(11)} phase=${st.phase.padEnd(16)} ${price.padEnd(8)} ${st.needs.length ? "needs " + st.needs.join(",") : ""}${flag}`);
    for (const m of c) {
      const mine = s.filter((x) => x.employee_id === m.membership_id);
      const desc = mine.length
        ? mine.map((x) => `${fmt(x.clock_in_at)}–${x.clock_out_at ? fmt(x.clock_out_at).split(", ").pop() : "OPEN"}${x.auto_closed_at ? " (auto-closed)" : ""}`).join("; ")
        : "no shift";
      out.push(`        ${nameOf(m.membership).padEnd(18)} ${(m.acceptance_status ?? "—").padEnd(9)} ${desc}`);
    }
    if (j.closed_at) out.push(`        closed_at ${fmt(j.closed_at)}`);
  }

  // 5. On the clock now -----------------------------------------------------
  const { data: open, error: oErr } = await db
    .from("time_entries")
    .select("clock_in_at, booking:bookings ( scheduled_at, client:clients ( name ) ), employee:memberships!time_entries_employee_id_fkey ( display_name, profile:profiles ( full_name ) )")
    .eq("organization_id", orgId)
    .is("clock_out_at", null);
  failed("open shifts", oErr);
  type OpenRow = { clock_in_at: string; booking: { scheduled_at: string; client: { name: string | null } | null } | null; employee: Member };
  const openRows = (open ?? []) as unknown as OpenRow[];
  let longOpenClocks = 0;
  out.push("", `5. ON THE CLOCK NOW: ${openRows.length}`);
  for (const o of openRows) {
    const mins = Math.round((now - new Date(o.clock_in_at).getTime()) / 60_000);
    if (mins >= LONG_OPEN_CLOCK_HOURS * 60) longOpenClocks++;
    out.push(`   ${nameOf(o.employee).padEnd(18)} since ${fmt(o.clock_in_at)} (${mins} min)  ${o.booking?.client?.name ?? "no job"}`);
  }

  const flags = morningFlags({
    stateChecks: checks?.length ?? 0,
    disagreeingJobs,
    digestMarked: Boolean(digest),
    longOpenClocks,
    duplicateMessages,
    readErrors,
  });
  return { orgName: org.name, flags, lines: out };
}

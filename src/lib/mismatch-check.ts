import type { SupabaseClient } from "@supabase/supabase-js";
import { hasNoAddress, samePlace } from "./address-match";
import { proposedWindows, type ProposedVisit } from "./crew-clash-text";

/**
 * Things that don't add up: upcoming visits whose details disagree with
 * where those details come from.
 *
 * Every bug found on 2026-11-14 had the same shape and none was foreseen. A
 * visit keeps its own copy of something (an address, a crew) and nothing
 * told the copy when the original changed: Hilda Daubner's visit kept her
 * old address, and 52 visits were led by a cleaner deactivated in May. A
 * test only checks what someone thought to write down. This checks the
 * results instead, every morning, however they came to be wrong, so the
 * next one of this shape is on a list before a crew drives to it.
 *
 * Double-bookings are here for a different reason. The overlap guard
 * (migration 20261108060000) refuses only a clash a change ADDS, so the ones
 * booked before it shipped stand, and nothing said so: on 2026-11-14 one
 * cleaner had three in December that nobody knew about.
 *
 * Read-only. The 8 AM email prints it (src/lib/morning-check.ts).
 */

export type MismatchKind =
  | "address"
  | "inactive_crew"
  | "series_inactive_crew"
  | "unassigned_soon"
  | "double_booked";

export type Mismatch = {
  kind: MismatchKind;
  /** Booking id, or the series id for a series finding. */
  id: string;
  client: string;
  /** ISO start of the visit; null for a series. */
  when: string | null;
  /** What disagrees, in a few words. */
  detail: string;
};

/** A visit this close with nobody on it is worth a line. */
export const UNASSIGNED_WITHIN_DAYS = 7;

/** How far ahead double-bookings are listed: near enough to act on, far
 *  enough to move a job before the day. */
export const DOUBLE_BOOKED_WITHIN_DAYS = 14;

export const MISMATCH_TITLES: Record<MismatchKind, string> = {
  address: "address is a different place from the client's",
  inactive_crew: "someone on the crew is deactivated",
  series_inactive_crew: "recurring series names someone deactivated",
  unassigned_soon: `nobody assigned, within ${UNASSIGNED_WITHIN_DAYS} days`,
  double_booked: `one person on two jobs at once, within ${DOUBLE_BOOKED_WITHIN_DAYS} days`,
};

export type MismatchVisit = {
  id: string;
  scheduled_at: string;
  client: string;
  /** The visit's own copy. */
  address: string | null;
  /** Where that copy should have come from: its property's address when it
   *  has a property, otherwise the client's. */
  sourceAddress: string | null;
  crew: Array<{ name: string; active: boolean }>;
  /** A subcontractor has claimed it: staffed, without a member on it. */
  covered: boolean;
};

export type MismatchSeries = {
  id: string;
  client: string;
  crew: Array<{ name: string; active: boolean }>;
};

/** A visit as the double-booking rule reads it: who is on it and when. */
export type TimedVisit = ProposedVisit & { bookingId: string; client: string };

/**
 * People on two jobs whose times overlap, one finding per person per pair.
 * The times are the ones the overlap guard uses (proposedWindows: shared
 * hours divided across the crew, a person's own segment kept), so a pair
 * listed here is a pair the guard would refuse if it were booked today.
 * A pair counts when the later job starts within the horizon.
 */
export function findDoubleBookings(
  visits: TimedVisit[],
  nameOfMember: (membershipId: string) => string,
  nowMs: number,
): Mismatch[] {
  const horizon = nowMs + DOUBLE_BOOKED_WITHIN_DAYS * 86_400_000;
  const byMember = new Map<string, Array<{ s: number; e: number; v: TimedVisit }>>();
  for (const v of visits) {
    for (const [memberId, windows] of proposedWindows([v])) {
      for (const w of windows) {
        const list = byMember.get(memberId) ?? [];
        list.push({ s: new Date(w.start_at).getTime(), e: new Date(w.end_at).getTime(), v });
        byMember.set(memberId, list);
      }
    }
  }
  const out: Mismatch[] = [];
  const seen = new Set<string>();
  for (const [memberId, list] of byMember) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].s < list[i].e; j++) {
        const a = list[i];
        const b = list[j];
        if (a.v.bookingId === b.v.bookingId || b.s > horizon) continue;
        const key = `${memberId}|${a.v.bookingId}|${b.v.bookingId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          kind: "double_booked",
          id: `${a.v.bookingId}:${b.v.bookingId}:${memberId}`,
          client: `${nameOfMember(memberId)}: ${a.v.client} and ${b.v.client}`,
          when: b.v.scheduledAt,
          detail: "overlapping times",
        });
      }
    }
  }
  return out;
}

/** The rule, without a database. */
export function findMismatches(
  visits: MismatchVisit[],
  series: MismatchSeries[],
  nowMs: number,
): Mismatch[] {
  const out: Mismatch[] = [];
  const soon = nowMs + UNASSIGNED_WITHIN_DAYS * 86_400_000;
  for (const v of visits) {
    // A blank copy follows its source live; a blank source has nothing to
    // disagree with. The same place written two ways is not a mismatch.
    if (!hasNoAddress(v.address) && !hasNoAddress(v.sourceAddress) && !samePlace(v.address, v.sourceAddress)) {
      out.push({ kind: "address", id: v.id, client: v.client, when: v.scheduled_at, detail: "visit and client have different addresses" });
    }
    const gone = v.crew.filter((c) => !c.active).map((c) => c.name);
    if (gone.length > 0) {
      out.push({ kind: "inactive_crew", id: v.id, client: v.client, when: v.scheduled_at, detail: gone.join(", ") });
    }
    if (v.crew.length === 0 && !v.covered && new Date(v.scheduled_at).getTime() <= soon) {
      out.push({ kind: "unassigned_soon", id: v.id, client: v.client, when: v.scheduled_at, detail: "no cleaner" });
    }
  }
  for (const s of series) {
    const gone = s.crew.filter((c) => !c.active).map((c) => c.name);
    if (gone.length > 0) {
      out.push({ kind: "series_inactive_crew", id: s.id, client: s.client, when: null, detail: gone.join(", ") });
    }
  }
  return out;
}

/**
 * Lines for the report: a count per kind, then who and when. Many visits for
 * one client (a whole series) fold into one line with the range, so 52
 * visits of one problem read as one problem.
 */
export function mismatchLines(
  found: Mismatch[],
  fmt: (iso: string) => string,
  perKind = 8,
): string[] {
  const lines: string[] = [];
  for (const kind of Object.keys(MISMATCH_TITLES) as MismatchKind[]) {
    const rows = found.filter((m) => m.kind === kind);
    lines.push(`   ${String(rows.length).padStart(3)}  ${MISMATCH_TITLES[kind]}`);
    const byClient = new Map<string, Mismatch[]>();
    for (const r of rows) byClient.set(`${r.client}|${r.detail}`, [...(byClient.get(`${r.client}|${r.detail}`) ?? []), r]);
    const groups = [...byClient.values()]
      .map((g) => [...g].sort((a, b) => (a.when ?? "").localeCompare(b.when ?? "")))
      .sort((a, b) => (a[0].when ?? "").localeCompare(b[0].when ?? ""));
    for (const g of groups.slice(0, perKind)) {
      const first = g[0];
      const span =
        first.when == null
          ? ""
          : g.length === 1
            ? ` ${fmt(first.when)}`
            : ` ${g.length} visits, ${fmt(first.when)} to ${fmt(g[g.length - 1].when as string)}`;
      const detail = kind === "address" || kind === "unassigned_soon" || kind === "double_booked" ? "" : ` — ${first.detail}`;
      lines.push(`          ${first.client}${span}${detail}`);
    }
    if (groups.length > perKind) lines.push(`          … and ${groups.length - perKind} more client(s)`);
  }
  return lines;
}

/** Rows per read, at the API's own cap, and how many reads before saying
 *  out loud that there were more. */
const VISIT_PAGE = 1000;
const MAX_VISIT_PAGES = 20;

type Named = { display_name: string | null; profile: { full_name: string | null } | null } | null;
const nameOf = (m: Named) => m?.display_name?.trim() || m?.profile?.full_name?.trim() || "?";

/**
 * Read what the rule needs for one company. `errors` names anything that
 * could not be read, so a report built on half the data says so.
 */
export async function loadMismatches(
  db: SupabaseClient,
  orgId: string,
  nowMs: number,
): Promise<{ found: Mismatch[]; errors: string[]; visitsChecked: number }> {
  const errors: string[] = [];
  const note = (what: string, err: { message: string } | null) => {
    if (err) errors.push(`${what} (${err.message})`);
  };

  const { data: members, error: mErr } = (await db
    .from("memberships")
    .select("id, status, display_name, profile:profiles ( full_name )")
    .eq("organization_id", orgId)
    .limit(2000)) as unknown as {
    data: Array<{ id: string; status: string } & NonNullable<Named>> | null;
    error: { message: string } | null;
  };
  note("members", mErr);
  const member = new Map((members ?? []).map((m) => [m.id, { name: nameOf(m), active: m.status === "active" }]));
  const person = (id: string) => member.get(id) ?? { name: "someone not in this company", active: false };

  type VisitRow = {
    id: string;
    scheduled_at: string;
    duration_minutes: number | null;
    divide_hours_evenly: boolean | null;
    address: string | null;
    assigned_to: string | null;
    property_id: string | null;
    client: { name: string | null; address: string | null } | null;
    property: { address: string | null } | null;
  };
  // In pages. The API answers at most 1000 rows whatever limit is asked
  // (supabase/config.toml max_rows), so one read with a bigger limit quietly
  // checked the nearest thousand visits and called it all of them.
  const visitRows: VisitRow[] = [];
  const nowIso = new Date(nowMs).toISOString();
  for (let page = 0; page < MAX_VISIT_PAGES; page++) {
    const { data: rows, error: vErr } = (await db
      .from("bookings")
      .select("id, scheduled_at, duration_minutes, divide_hours_evenly, address, assigned_to, property_id, client:clients ( name, address ), property:client_properties ( address )")
      .eq("organization_id", orgId)
      .in("status", ["pending", "confirmed"])
      .gte("scheduled_at", nowIso)
      .order("scheduled_at")
      .order("id")
      .range(page * VISIT_PAGE, page * VISIT_PAGE + VISIT_PAGE - 1)) as unknown as {
      data: VisitRow[] | null;
      error: { message: string } | null;
    };
    note("upcoming visits", vErr);
    visitRows.push(...(rows ?? []));
    if (vErr || (rows ?? []).length < VISIT_PAGE) break;
    if (page === MAX_VISIT_PAGES - 1) {
      errors.push(`upcoming visits (more than ${MAX_VISIT_PAGES * VISIT_PAGE}; the rest were not checked)`);
    }
  }

  const crewBy = new Map<string, Set<string>>();
  const segmentBy = new Map<string, Map<string, { offset: number | null; minutes: number | null }>>();
  const covered = new Set<string>();
  const ids = visitRows.map((v) => v.id);
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const { data: crew, error: cErr } = (await db
      .from("booking_assignees")
      .select("booking_id, membership_id, split_start_offset_minutes, split_duration_minutes")
      .in("booking_id", chunk)) as unknown as {
      data: Array<{
        booking_id: string;
        membership_id: string;
        split_start_offset_minutes: number | null;
        split_duration_minutes: number | null;
      }> | null;
      error: { message: string } | null;
    };
    note("crew", cErr);
    for (const r of crew ?? []) {
      crewBy.set(r.booking_id, (crewBy.get(r.booking_id) ?? new Set()).add(r.membership_id));
      const segs = segmentBy.get(r.booking_id) ?? new Map();
      segs.set(r.membership_id, { offset: r.split_start_offset_minutes, minutes: r.split_duration_minutes });
      segmentBy.set(r.booking_id, segs);
    }
    // A claimed shift offer staffs a visit with nobody from the roster on it.
    const { data: claims, error: clErr } = (await db
      .from("job_offer_claims" as never)
      .select("offer:job_offers!inner ( booking_id )")
      .in("offer.booking_id" as never, chunk as never)) as unknown as {
      data: Array<{ offer: { booking_id: string } | null }> | null;
      error: { message: string } | null;
    };
    // The coverage table is a nicety here; without it an offered-out visit
    // reads as unassigned, which errs toward a line too many.
    if (!clErr) for (const c of claims ?? []) if (c.offer?.booking_id) covered.add(c.offer.booking_id);
  }

  const visits: MismatchVisit[] = visitRows.map((v) => {
    const crewIds = new Set(crewBy.get(v.id) ?? []);
    if (v.assigned_to) crewIds.add(v.assigned_to);
    return {
      id: v.id,
      scheduled_at: v.scheduled_at,
      client: v.client?.name ?? "?",
      address: v.address,
      sourceAddress: v.property_id ? (v.property?.address ?? null) : (v.client?.address ?? null),
      crew: [...crewIds].map(person),
      covered: covered.has(v.id),
    };
  });

  type SeriesRow = {
    id: string;
    assigned_to: string | null;
    crew: unknown;
    client: { name: string | null; archived_at?: string | null } | null;
  };
  const { data: seriesRows, error: sErr } = (await db
    .from("booking_series")
    .select("id, assigned_to, crew, client:clients ( name )")
    .eq("organization_id", orgId)
    .eq("active", true)
    .limit(2000)) as unknown as { data: SeriesRow[] | null; error: { message: string } | null };
  note("recurring series", sErr);
  const series: MismatchSeries[] = (seriesRows ?? []).map((s) => {
    const crewIds = new Set<string>();
    if (s.assigned_to) crewIds.add(s.assigned_to);
    for (const c of (Array.isArray(s.crew) ? s.crew : []) as Array<{ membership_id?: unknown }>) {
      if (typeof c?.membership_id === "string") crewIds.add(c.membership_id);
    }
    return { id: s.id, client: s.client?.name ?? "?", crew: [...crewIds].map(person) };
  });

  // Double-bookings. Does the company share a job's hours across its crew?
  // Read the way the database's booking_shares_hours does, so the times here
  // are the overlap guard's.
  const { data: org, error: oErr } = (await db
    .from("organizations")
    .select("automations_enabled, automation_settings")
    .eq("id", orgId)
    .maybeSingle()) as unknown as {
    data: { automations_enabled: boolean | null; automation_settings: Record<string, { enabled?: unknown } | undefined> | null } | null;
    error: { message: string } | null;
  };
  note("company settings", oErr);
  const enabled = org?.automation_settings?.divide_crew_hours?.enabled;
  const orgShares = org?.automations_enabled === true && (enabled === true || enabled === "true");
  // Only visits near enough to matter; the day after the horizon is included
  // so a job that starts inside it is compared with whatever it runs into.
  const until = nowMs + (DOUBLE_BOOKED_WITHIN_DAYS + 1) * 86_400_000;
  const timed: TimedVisit[] = visitRows
    .filter((v) => new Date(v.scheduled_at).getTime() <= until)
    .map((v) => {
      const crewIds = new Set(crewBy.get(v.id) ?? []);
      if (v.assigned_to) crewIds.add(v.assigned_to);
      const segs = segmentBy.get(v.id);
      return {
        bookingId: v.id,
        client: v.client?.name ?? "?",
        scheduledAt: v.scheduled_at,
        durationMinutes: v.duration_minutes ?? 0,
        dividesHours: v.divide_hours_evenly === true || orgShares,
        crew: [...crewIds].map((id) => ({
          membershipId: id,
          startOffsetMinutes: segs?.get(id)?.offset ?? null,
          durationMinutes: segs?.get(id)?.minutes ?? null,
        })),
      };
    });
  const doubled = findDoubleBookings(timed, (id) => person(id).name, nowMs);

  return { found: [...findMismatches(visits, series, nowMs), ...doubled], errors, visitsChecked: visits.length };
}

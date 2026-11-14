import type { SupabaseClient } from "@supabase/supabase-js";
import { hasNoAddress, samePlace } from "./address-match";

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
 * Read-only. The 8 AM email prints it (src/lib/morning-check.ts).
 */

export type MismatchKind =
  | "address"
  | "inactive_crew"
  | "series_inactive_crew"
  | "unassigned_soon";

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

export const MISMATCH_TITLES: Record<MismatchKind, string> = {
  address: "address is a different place from the client's",
  inactive_crew: "someone on the crew is deactivated",
  series_inactive_crew: "recurring series names someone deactivated",
  unassigned_soon: `nobody assigned, within ${UNASSIGNED_WITHIN_DAYS} days`,
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
      const detail = kind === "address" || kind === "unassigned_soon" ? "" : ` — ${first.detail}`;
      lines.push(`          ${first.client}${span}${detail}`);
    }
    if (groups.length > perKind) lines.push(`          … and ${groups.length - perKind} more client(s)`);
  }
  return lines;
}

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
    address: string | null;
    assigned_to: string | null;
    property_id: string | null;
    client: { name: string | null; address: string | null } | null;
    property: { address: string | null } | null;
  };
  const { data: rows, error: vErr } = (await db
    .from("bookings")
    .select("id, scheduled_at, address, assigned_to, property_id, client:clients ( name, address ), property:client_properties ( address )")
    .eq("organization_id", orgId)
    .in("status", ["pending", "confirmed"])
    .gte("scheduled_at", new Date(nowMs).toISOString())
    .order("scheduled_at")
    .limit(5000)) as unknown as { data: VisitRow[] | null; error: { message: string } | null };
  note("upcoming visits", vErr);
  const visitRows = rows ?? [];

  const crewBy = new Map<string, Set<string>>();
  const covered = new Set<string>();
  const ids = visitRows.map((v) => v.id);
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const { data: crew, error: cErr } = (await db
      .from("booking_assignees")
      .select("booking_id, membership_id")
      .in("booking_id", chunk)) as unknown as {
      data: Array<{ booking_id: string; membership_id: string }> | null;
      error: { message: string } | null;
    };
    note("crew", cErr);
    for (const r of crew ?? []) crewBy.set(r.booking_id, (crewBy.get(r.booking_id) ?? new Set()).add(r.membership_id));
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

  return { found: findMismatches(visits, series, nowMs), errors, visitsChecked: visits.length };
}

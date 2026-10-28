import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAutomationEnabled } from "@/lib/automation-defaults";
import { membersOffOn } from "@/lib/unavailability-notice";
import { selectInChunks } from "@/lib/supabase/chunked-in";
import { zonedDayBoundsUtc } from "@/lib/wall-clock";
import {
  buildNeedsYou,
  type NeedsYouBooking,
  type NeedsYouItem,
} from "@/lib/needs-you-items";
import { describeDelta, findSeriesDrift, type SeriesDrift } from "@/lib/series-drift";

export type { NeedsYouItem, NeedsYouAction } from "@/lib/needs-you-items";

/** Finished jobs with no price stop being worth a line after this. */
const PRICE_LOOKBACK_DAYS = 45;

type MemberRow = {
  id: string;
  display_name: string | null;
  contact_phone: string | null;
  profile_id: string | null;
  profile: { full_name: string | null; phone: string | null } | null;
};

/**
 * Load everything the list needs for one org and build it. Admin client:
 * the list is only ever shown to managers, and it reads across every crew
 * member's shifts, which a manager's own session can do but a cron can't.
 */
export async function collectNeedsYou(
  organizationId: string,
  opts: { now?: number } = {},
): Promise<{ items: NeedsYouItem[]; tz: string }> {
  const db = createSupabaseAdminClient();
  const now = opts.now ?? Date.now();

  const { data: org } = (await db
    .from("organizations")
    .select("timezone, automation_settings, booking_auto_complete_hours")
    .eq("id", organizationId)
    .maybeSingle()) as unknown as {
    data: {
      timezone: string | null;
      automation_settings: Record<string, { enabled?: boolean } | undefined> | null;
      booking_auto_complete_hours: number | null;
    } | null;
  };
  const tz = org?.timezone ?? "America/Edmonton";
  const autoOn = resolveAutomationEnabled(org?.automation_settings ?? null, "auto_complete_past_bookings");
  const h = org?.booking_auto_complete_hours;
  const autoCompleteAfterMinutes = autoOn && h != null && h >= 1 ? h * 60 : null;

  // Live window: yesterday through tomorrow, in the org's zone. Plus done
  // jobs with no price over a longer stretch, which don't go stale as fast.
  const { start: yesterdayStart } = zonedDayBoundsUtc(new Date(now), tz, -1);
  const { end: tomorrowEnd } = zonedDayBoundsUtc(new Date(now), tz, 1);
  const tomorrowYmd = new Date(now + 24 * 3_600_000).toLocaleDateString("en-CA", { timeZone: tz });
  const priceSince = new Date(now - PRICE_LOOKBACK_DAYS * 86_400_000).toISOString();

  const orgDivides = resolveAutomationEnabled(org?.automation_settings ?? null, "divide_crew_hours");

  const cols =
    "id, status, scheduled_at, duration_minutes, total_cents, hourly_rate_cents, is_free, closed_at, divide_hours_evenly, client:clients ( name )";
  type Row = {
    id: string;
    status: string;
    scheduled_at: string;
    duration_minutes: number;
    total_cents: number | null;
    hourly_rate_cents: number | null;
    is_free: boolean | null;
    closed_at: string | null;
    divide_hours_evenly: boolean | null;
    client: { name: string | null } | null;
  };
  // Every query below throws on error rather than falling back to "no rows".
  // Empty data is not a safe default here: no shifts means every crew
  // member is late, no crew means every job tomorrow is unstaffed — and
  // the alerts that follow are marked sent, so the false ones are never
  // corrected and the real ones later are suppressed.
  const [liveRes, unpricedRes, { count: recentShifts, error: countErr }] = await Promise.all([
    db
      .from("bookings")
      .select(cols)
      .eq("organization_id", organizationId)
      .neq("status", "cancelled")
      .gte("scheduled_at", yesterdayStart.toISOString())
      .lt("scheduled_at", tomorrowEnd.toISOString())
      .limit(300) as unknown as Promise<{ data: Row[] | null; error: { message: string } | null }>,
    db
      .from("bookings")
      .select(cols)
      .eq("organization_id", organizationId)
      .eq("status", "completed")
      .gte("scheduled_at", priceSince)
      .or("total_cents.is.null,total_cents.eq.0")
      .not("is_free", "is", true)
      .limit(100) as unknown as Promise<{ data: Row[] | null; error: { message: string } | null }>,
    db
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("clock_in_at", new Date(now - 14 * 86_400_000).toISOString()),
  ]);

  const firstErr = liveRes.error ?? unpricedRes.error ?? countErr;
  if (firstErr) throw new Error(`needs-you bookings query failed: ${firstErr.message}`);
  const live = liveRes.data;
  const unpriced = unpricedRes.data;

  const byId = new Map<string, Row>();
  for (const r of [...(live ?? []), ...(unpriced ?? [])]) byId.set(r.id, r);
  const ids = [...byId.keys()];
  if (ids.length === 0) return { items: [], tz };

  type CrewRow = {
    booking_id: string;
    membership_id: string;
    acceptance_status: string | null;
    split_start_offset_minutes: number | null;
    split_duration_minutes: number | null;
    membership: MemberRow | null;
  };
  type ShiftRow = {
    id: string;
    booking_id: string;
    employee_id: string;
    clock_in_at: string;
    clock_out_at: string | null;
  };
  const [{ data: crewRows, error: crewErr }, { data: shiftRows, error: shiftErr }] = await Promise.all([
    selectInChunks<CrewRow>(ids, (chunk) =>
      db
        .from("booking_assignees" as never)
        .select(
          "booking_id, membership_id, acceptance_status, split_start_offset_minutes, split_duration_minutes, membership:memberships ( id, display_name, contact_phone, profile_id, profile:profiles ( full_name, phone ) )" as never,
        )
        .in("booking_id" as never, chunk as never) as unknown as PromiseLike<{
        data: CrewRow[] | null;
        error: { message: string } | null;
      }>,
    ),
    selectInChunks<ShiftRow>(ids, (chunk) =>
      db
        .from("time_entries")
        .select("id, booking_id, employee_id, clock_in_at, clock_out_at")
        .in("booking_id", chunk) as unknown as PromiseLike<{
        data: ShiftRow[] | null;
        error: { message: string } | null;
      }>,
    ),
  ]);

  if (crewErr || shiftErr) {
    throw new Error(`needs-you crew/shift query failed: ${(crewErr ?? shiftErr)?.message}`);
  }

  const crewBy = new Map<string, NeedsYouBooking["crew"]>();
  const memberIds = new Set<string>();
  for (const c of crewRows) {
    const m = c.membership;
    memberIds.add(c.membership_id);
    const list = crewBy.get(c.booking_id) ?? [];
    list.push({
      membership_id: c.membership_id,
      name: m?.display_name?.trim() || m?.profile?.full_name?.trim() || "Crew member",
      phone: m?.contact_phone?.trim() || m?.profile?.phone?.trim() || null,
      acceptance_status: c.acceptance_status,
      has_login: Boolean(m?.profile_id),
      split_start_offset_minutes: c.split_start_offset_minutes,
      split_duration_minutes: c.split_duration_minutes,
    });
    crewBy.set(c.booking_id, list);
  }
  const shiftsBy = new Map<string, NeedsYouBooking["shifts"]>();
  for (const s of shiftRows) {
    const list = shiftsBy.get(s.booking_id) ?? [];
    list.push(s);
    shiftsBy.set(s.booking_id, list);
  }

  const [offTomorrow, { data: stateRows, error: stateErr }] = await Promise.all([
    membersOffOn(organizationId, [...memberIds], tomorrowYmd),
    db
      .from("needs_you_state" as never)
      .select("key, snoozed_until")
      .eq("organization_id" as never, organizationId as never)
      .not("snoozed_until" as never, "is", null as never) as unknown as Promise<{
      data: Array<{ key: string; snoozed_until: string | null }> | null;
      error: { message: string } | null;
    }>,
  ]);
  if (stateErr) throw new Error(`needs-you snooze query failed: ${stateErr.message}`);
  const snoozed = new Map<string, number>();
  for (const r of stateRows ?? []) {
    if (r.snoozed_until) snoozed.set(r.key, new Date(r.snoozed_until).getTime());
  }

  const bookings: NeedsYouBooking[] = ids.map((id) => {
    const r = byId.get(id)!;
    return {
      id: r.id,
      clientName: r.client?.name ?? "A client",
      status: r.status,
      scheduled_at: r.scheduled_at,
      duration_minutes: r.duration_minutes,
      total_cents: r.total_cents,
      hourly_rate_cents: r.hourly_rate_cents,
      is_free: r.is_free,
      closed_at: r.closed_at,
      divides_hours: r.divide_hours_evenly === true || orgDivides,
      crew: crewBy.get(id) ?? [],
      shifts: shiftsBy.get(id) ?? [],
    };
  });

  const items = buildNeedsYou(
    bookings,
    {
      now,
      tz,
      autoCompleteAfterMinutes,
      tomorrowYmd,
      offTomorrow: new Set(offTomorrow),
      usesClockIn: (recentShifts ?? 0) > 0,
    },
    snoozed,
  );
  const drift = await collectSeriesDrift(organizationId, tz, now);
  const driftItems = drift
    .map((d) => seriesDriftItem(d, tz))
    .filter((it) => (snoozed.get(it.key) ?? 0) <= now);
  // Drift sits with tomorrow's problems: before money, after anything live.
  const money = items.filter((it) => it.kind === "needs_price");
  const rest = items.filter((it) => it.kind !== "needs_price");
  return { items: [...rest, ...driftItems, ...money], tz };
}

/**
 * Every future visit of a recurring series whose stored time no longer
 * matches the series under the current zone rules, and that nobody set by
 * hand. See series-drift.ts for why this is a question and not a fix.
 */
export async function collectSeriesDrift(
  organizationId: string,
  tz: string,
  now = Date.now(),
): Promise<SeriesDrift[]> {
  const db = createSupabaseAdminClient();
  const { data: seriesRows, error: seriesErr } = (await db
    .from("booking_series")
    .select("id, start_time, client:clients ( name )")
    .eq("organization_id", organizationId)) as unknown as {
    data: Array<{ id: string; start_time: string; client: { name: string | null } | null }> | null;
    error: { message: string } | null;
  };
  if (seriesErr) throw new Error(`series drift: series query failed: ${seriesErr.message}`);
  if (!seriesRows || seriesRows.length === 0) return [];

  const { data: visitRows, error: visitErr } = (await db
    .from("bookings")
    .select("id, series_id, scheduled_at, status, time_set_by_hand_at" as never)
    .eq("organization_id", organizationId)
    .not("series_id", "is", null)
    .in("status", ["pending", "confirmed", "en_route"])
    .is("archived_at", null)
    .gte("scheduled_at", new Date(now).toISOString())
    .order("scheduled_at")
    .limit(3000)) as unknown as {
    data: Array<{
      id: string;
      series_id: string;
      scheduled_at: string;
      status: string;
      time_set_by_hand_at: string | null;
    }> | null;
    error: { message: string } | null;
  };
  if (visitErr) throw new Error(`series drift: visits query failed: ${visitErr.message}`);

  return findSeriesDrift({
    series: seriesRows.map((s) => ({
      id: s.id,
      start_time: s.start_time,
      clientName: s.client?.name ?? "A client",
    })),
    visits: visitRows ?? [],
    tz,
    now,
  });
}

function seriesDriftItem(d: SeriesDrift, tz: string): NeedsYouItem {
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" });
  const n = d.visits.length;
  const deltas = new Set(d.visits.map((v) => v.deltaMinutes));
  const seriesTime = time(d.visits[0].expected_at);
  const how =
    deltas.size === 1
      ? `${n === 1 ? "is" : "are"} ${describeDelta(d.visits[0].deltaMinutes)}, at ${time(d.visits[0].scheduled_at)}`
      : "don't match";
  const dates = d.visits.slice(0, 4).map((v) => day(v.scheduled_at)).join(", ");
  const more = n > 4 ? ` and ${n - 4} more` : "";
  return {
    key: `drift:${d.seriesId}`,
    kind: "series_drift",
    title: `${d.clientName}: ${n} ${n === 1 ? "visit" : "visits"} ${how}`,
    body: `The series says ${seriesTime}. ${dates}${more}. Restore puts them back at ${seriesTime}; Keep leaves them and stops asking. Nobody is notified either way.`,
    href: `/app/bookings?series=${d.seriesId}`,
    atMs: new Date(d.visits[0].scheduled_at).getTime(),
    alert: false,
    actions: [
      { kind: "restore_series_times", label: `Restore to ${seriesTime}`, seriesId: d.seriesId, count: n },
      { kind: "keep_series_times", label: "Keep these times", seriesId: d.seriesId },
    ],
  };
}

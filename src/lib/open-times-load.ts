import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgTimezone } from "@/lib/org-timezone";
import { orgDividesCrewHours } from "@/lib/crew-hours";
import { memberDisplayName } from "@/lib/member-display";
import { proposedWindows } from "@/lib/crew-clash-text";
import { zonedParts, zonedWallClockUtc, zonedYmd } from "@/lib/wall-clock";
import { readRules } from "@/lib/open-time-rules";
import { getOrgHolidays } from "@/lib/holidays";
import { openTimesForDay, type Busy, type EngineCleaner, type Hours, type NoTimesReason, type OpenTime, type OpenTimeRules } from "@/lib/open-times";

/**
 * Open times for a company's real schedule: the lookups that feed the
 * engine (lib/open-times.ts). Everything that decides is in the engine;
 * this only gathers what it needs, once, for a run of days.
 *
 * Who is busy when is worked out the way the double-booking guard works it
 * out (proposedWindows: shared hours divide a job between its crew, and a
 * person with their own times keeps them), so a time offered here is one the
 * guard would also accept. The guard still has the last word when a booking
 * is actually saved.
 *
 * A statutory holiday (the company's holiday region, Settings) is closed
 * for online booking whatever the weekday's hours say. The office can still
 * book that day by hand; a stranger can't pick it.
 */
export type DayTimes = {
  ymd: string;
  times: OpenTime[];
  reason: NoTimesReason | null;
  /** The statutory holiday that closes this day, when there is one. */
  holiday?: string;
};

export type OpenTimesLoad =
  | {
      ok: true;
      tz: string;
      rules: OpenTimeRules;
      service: { id: string; name: string; minutes: number; crewSize: number };
      cleaners: Array<{ id: string; name: string }>;
      days: DayTimes[];
    }
  | { ok: false; error: string };

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export async function loadOpenTimes(input: {
  organizationId: string;
  serviceId: string;
  /** First day, on the company's calendar. Defaults to today. */
  fromYmd?: string;
  /** How many days, 1 to 31. */
  days: number;
  now?: number;
}): Promise<OpenTimesLoad> {
  const admin = createSupabaseAdminClient();
  const orgId = input.organizationId;
  const nowMs = input.now ?? Date.now();
  const count = Math.min(31, Math.max(1, Math.floor(input.days)));

  const [tz, shares, pageRes, serviceRes, peopleRes] = await Promise.all([
    getOrgTimezone(orgId),
    orgDividesCrewHours(orgId),
    admin
      .from("booking_pages" as never)
      .select("opening_hours, min_notice_hours, max_days_ahead, gap_minutes, slot_step_minutes")
      .eq("organization_id" as never, orgId as never)
      .maybeSingle() as unknown as Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>,
    admin
      .from("service_types")
      .select("id, name, default_duration_minutes, online_crew_size" as never)
      .eq("id", input.serviceId)
      .eq("organization_id", orgId)
      .maybeSingle() as unknown as Promise<{
      data: { id: string; name: string; default_duration_minutes: number | null; online_crew_size: number | null } | null;
      error: { message: string } | null;
    }>,
    admin
      .from("memberships")
      .select("id, display_name, profile:profiles ( full_name )")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .eq("takes_online_bookings" as never, true as never) as unknown as Promise<{
      data: Array<{ id: string; display_name: string | null; profile: { full_name: string | null } | null }> | null;
      error: { message: string } | null;
    }>,
  ]);
  for (const res of [pageRes, serviceRes, peopleRes]) if (res.error) throw new Error(res.error.message);
  if (!pageRes.data) return { ok: false, error: "Make your booking page first." };
  if (!serviceRes.data) return { ok: false, error: "That service wasn't found." };

  const rules = readRules(pageRes.data);
  const service = {
    id: serviceRes.data.id,
    name: serviceRes.data.name,
    minutes: Math.max(0, serviceRes.data.default_duration_minutes ?? 0),
    crewSize: Math.max(1, serviceRes.data.online_crew_size ?? 1),
  };
  const cleaners = (peopleRes.data ?? []).map((m) => ({ id: m.id, name: memberDisplayName(m) })).sort((a, b) => a.name.localeCompare(b.name));
  const ids = cleaners.map((c) => c.id);

  const todayYmd = zonedYmd(new Date(nowMs), tz);
  const fromYmd = /^\d{4}-\d{2}-\d{2}$/.test(input.fromYmd ?? "") ? (input.fromYmd as string) : todayYmd;
  const lastYmd = addDays(fromYmd, count - 1);
  const at = (ymd: string) => (hhmm: string) => zonedWallClockUtc(ymd, hhmm, tz).getTime();
  const clock = (ms: number) => {
    const p = zonedParts(new Date(ms), tz);
    return `${pad(p.hour)}:${pad(p.minute)}`;
  };
  const holidays = await getOrgHolidays(orgId, fromYmd, addDays(lastYmd, 1));

  // Each cleaner's weekly hours, one-off days and approved time off.
  const weekly = new Map<string, Record<number, Hours[]>>();
  const custom = new Map<string, Hours[]>(); // `${id}|${ymd}`
  const offDays = new Set<string>(); // `${id}|${ymd}`
  const busy = new Map<string, Busy[]>();
  if (ids.length > 0) {
    // A job that began the day before can still be running; one that starts
    // just after the last day can sit inside the gap.
    const rangeStart = new Date(at(addDays(fromYmd, -2))("00:00")).toISOString();
    const rangeEnd = new Date(at(addDays(lastYmd, 2))("00:00")).toISOString();
    const [slotsRes, overridesRes, ptoRes, jobsRes] = await Promise.all([
      admin
        .from("availability_slots" as never)
        .select("membership_id, day_of_week, start_time, end_time")
        .eq("organization_id" as never, orgId as never)
        .in("membership_id" as never, ids as never) as unknown as Promise<{
        data: Array<{ membership_id: string; day_of_week: number; start_time: string; end_time: string }> | null;
        error: { message: string } | null;
      }>,
      admin
        .from("availability_overrides" as never)
        .select("membership_id, date, kind, start_time, end_time")
        .eq("organization_id" as never, orgId as never)
        .in("membership_id" as never, ids as never)
        .gte("date" as never, fromYmd as never)
        .lte("date" as never, lastYmd as never) as unknown as Promise<{
        data: Array<{ membership_id: string; date: string; kind: string; start_time: string | null; end_time: string | null }> | null;
        error: { message: string } | null;
      }>,
      admin
        .from("pto_requests")
        .select("employee_id, start_date, end_date")
        .eq("organization_id", orgId)
        .eq("status", "approved")
        .in("employee_id", ids)
        .lte("start_date", lastYmd)
        .gte("end_date", fromYmd) as unknown as Promise<{
        data: Array<{ employee_id: string; start_date: string; end_date: string }> | null;
        error: { message: string } | null;
      }>,
      admin
        .from("bookings")
        .select("id, scheduled_at, duration_minutes, assigned_to, divide_hours_evenly" as never)
        .eq("organization_id", orgId)
        .neq("status", "cancelled")
        .gte("scheduled_at", rangeStart)
        .lt("scheduled_at", rangeEnd)
        .limit(5000) as unknown as Promise<{
        data: Array<{ id: string; scheduled_at: string; duration_minutes: number | null; assigned_to: string | null; divide_hours_evenly: boolean | null }> | null;
        error: { message: string } | null;
      }>,
    ]);
    for (const res of [slotsRes, overridesRes, ptoRes, jobsRes]) if (res.error) throw new Error(res.error.message);

    for (const row of slotsRes.data ?? []) {
      const byDay = weekly.get(row.membership_id) ?? {};
      (byDay[row.day_of_week] ??= []).push({ start: row.start_time.slice(0, 5), end: row.end_time.slice(0, 5) });
      weekly.set(row.membership_id, byDay);
    }
    for (const row of overridesRes.data ?? []) {
      const key = `${row.membership_id}|${row.date}`;
      if (row.kind === "off") offDays.add(key);
      else if (row.start_time && row.end_time) custom.set(key, [{ start: row.start_time.slice(0, 5), end: row.end_time.slice(0, 5) }]);
    }
    for (const row of ptoRes.data ?? []) {
      for (let d = fromYmd; d <= lastYmd; d = addDays(d, 1)) {
        if (d >= row.start_date && d <= row.end_date) offDays.add(`${row.employee_id}|${d}`);
      }
    }

    // Who is on each job, with their own times where they have them.
    const jobs = jobsRes.data ?? [];
    const crewByJob = new Map<string, Array<{ membershipId: string; startOffsetMinutes: number | null; durationMinutes: number | null }>>();
    for (let i = 0; i < jobs.length; i += 150) {
      const { data, error } = (await admin
        .from("booking_assignees")
        .select("booking_id, membership_id, split_start_offset_minutes, split_duration_minutes")
        .in("booking_id", jobs.slice(i, i + 150).map((j) => j.id))) as unknown as {
        data: Array<{ booking_id: string; membership_id: string; split_start_offset_minutes: number | null; split_duration_minutes: number | null }> | null;
        error: { message: string } | null;
      };
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        const list = crewByJob.get(r.booking_id) ?? [];
        list.push({ membershipId: r.membership_id, startOffsetMinutes: r.split_start_offset_minutes, durationMinutes: r.split_duration_minutes });
        crewByJob.set(r.booking_id, list);
      }
    }
    const windows = proposedWindows(
      jobs.map((j) => {
        const crew = crewByJob.get(j.id) ?? [];
        // A lead with no crew row of their own (older bookings).
        if (j.assigned_to && !crew.some((c) => c.membershipId === j.assigned_to)) {
          crew.push({ membershipId: j.assigned_to, startOffsetMinutes: null, durationMinutes: null });
        }
        return {
          bookingId: j.id,
          scheduledAt: j.scheduled_at,
          durationMinutes: j.duration_minutes ?? 0,
          dividesHours: j.divide_hours_evenly === true || shares,
          crew,
        };
      }),
    );
    const eligible = new Set(ids);
    for (const [memberId, list] of windows) {
      if (!eligible.has(memberId)) continue;
      busy.set(
        memberId,
        list.map((w) => ({ startMs: new Date(w.start_at).getTime(), endMs: new Date(w.end_at).getTime() })),
      );
    }
  }

  const days: DayTimes[] = [];
  for (let i = 0; i < count; i++) {
    const ymd = addDays(fromYmd, i);
    const weekday = new Date(`${ymd}T12:00:00Z`).getUTCDay();
    const engineCleaners: EngineCleaner[] = cleaners.map((c) => {
      const mine = weekly.get(c.id);
      const hasAny = !!mine && Object.values(mine).some((list) => list.length > 0);
      return {
        id: c.id,
        off: offDays.has(`${c.id}|${ymd}`),
        // Hours given for this date replace the weekly ones. No hours on
        // file at all is "unknown", so nothing is held against them.
        hours: custom.get(`${c.id}|${ymd}`) ?? (hasAny ? (mine![weekday] ?? []) : null),
        busy: busy.get(c.id) ?? [],
      };
    });
    const result = openTimesForDay({
      ymd,
      todayYmd,
      nowMs,
      at: at(ymd),
      clock,
      rules,
      closed: !!holidays[ymd],
      durationMinutes: service.minutes,
      crewSize: service.crewSize,
      sharesHours: shares,
      cleaners: engineCleaners,
    });
    days.push({ ymd, times: result.times, reason: result.reason, ...(holidays[ymd] ? { holiday: holidays[ymd] } : {}) });
  }

  return { ok: true, tz, rules, service, cleaners, days };
}

import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { memberDisplayName } from "@/lib/member-display";

export type SchedulerView = {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  sort_order: number;
};

/**
 * Fetch the org's saved scheduler views, ordered for display.
 * Uses the admin client because the scheduler_views generated types
 * don't exist yet (migration applied separately from `npm run
 * supabase:types` regen). Values are read-only to the caller — writes
 * go through saveSchedulerViewAction / deleteSchedulerViewAction.
 */
export async function fetchSchedulerViews(
  organizationId: string,
): Promise<SchedulerView[]> {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("scheduler_views" as never)
    .select("id, name, filters, sort_order")
    .eq("organization_id" as never, organizationId as never)
    .order("sort_order" as never, { ascending: true } as never)) as unknown as {
    data: SchedulerView[] | null;
  };
  return data ?? [];
}

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "en_route"
  | "in_progress"
  | "completed"
  | "cancelled";

export type ScheduleBooking = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: BookingStatus;
  service_type: string;
  assigned_to: string | null;
  client_name: string;
  address: string | null;
};

export type ScheduleEmployee = {
  id: string;
  name: string;
};

/** Returns Monday at 00:00 local for the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = out.getDay(); // 0=Sun … 6=Sat
  const offset = dow === 0 ? -6 : 1 - dow; // shift so Mon = day 0
  out.setDate(out.getDate() + offset);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Parse ?week=YYYY-MM-DD or default to this week (Monday). */
export function parseWeekParam(raw: string | undefined): Date {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    const candidate = new Date(y, m - 1, d);
    if (!Number.isNaN(candidate.getTime())) return startOfWeek(candidate);
  }
  return startOfWeek(new Date());
}

export function formatWeekParam(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** UTC-flavored YMD for a Date — used for PTO/override range fallback
 *  when the caller didn't pass explicit org-tz dates. Correct for orgs
 *  at or behind UTC (America, most of Europe); callers in UTC-forward
 *  timezones (Asia, Oceania) should pass `rangeDates` explicitly. */
function formatYmdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Shift a YYYY-MM-DD string by N days. Pure string math, no timezone
 *  conversion — used for the range clamp, where both operands are
 *  already in the same (org) tz. */
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Serialized "employee is off on these YYYY-MM-DD dates" lookup. Keys
 * are membership ids, values are an array (serialized — JSON-safe) of
 * date strings. Consumers convert back to a Set for O(1) lookup per
 * (employee, day) cell.
 */
export type OffDaysByEmployee = Record<string, string[]>;

/**
 * Fetch bookings + employees + off-days for a schedule range.
 *
 * @param rangeStart UTC instant the schedule range starts at (typically
 *                   midnight-in-org-tz converted to UTC by the caller —
 *                   don't pass a naive local-midnight Date or jobs late
 *                   in the day in non-UTC timezones will be missing).
 * @param rangeEnd   Exclusive UTC end. Defaults to rangeStart + 7 days
 *                   for backward-compat.
 * @param rangeDates Optional pair of YYYY-MM-DD strings representing
 *                   the date range in the ORG'S tz. Used for the
 *                   date-column queries (PTO, availability_overrides)
 *                   where we need the wall-clock dates, not the UTC
 *                   instants of the bookings. Falls back to deriving
 *                   from the UTC rangeStart/End if omitted — only safe
 *                   for timezones <= UTC (everything in North
 *                   America). Always pass explicitly for full safety.
 */
export async function fetchScheduleWeek(
  rangeStart: Date,
  rangeEnd?: Date,
  rangeDates?: { startYmd: string; endYmdExclusive: string },
): Promise<{
  bookings: ScheduleBooking[];
  employees: ScheduleEmployee[];
  /** Days each employee is off (PTO approved + explicit availability
   *  overrides of kind='off'). Week grid + Dispatch view shade the
   *  cells / columns for these so owners can't accidentally assign a
   *  job onto a day the cleaner is known to be unavailable. */
  offDays: OffDaysByEmployee;
}> {
  const supabase = await createSupabaseServerClient();
  const weekStart = rangeStart;
  const weekEnd = rangeEnd ?? addDays(weekStart, 7);

  // Range bounds for the off-day queries (pto_requests,
  // availability_overrides). These use date columns, so we want the
  // wall-clock YYYY-MM-DD in the org's tz. Prefer the explicit pair
  // from the caller; otherwise derive from the UTC instants (the
  // derive path uses UTC accessors, which matches caller intent for
  // orgs in UTC or behind UTC — America, most of Europe).
  const rangeStartStr =
    rangeDates?.startYmd ?? formatYmdUtc(weekStart);
  // endYmdExclusive is exclusive — subtract one day for <= comparisons
  // against the date column.
  const rangeEndStr = rangeDates
    ? shiftYmd(rangeDates.endYmdExclusive, -1)
    : formatYmdUtc(addDays(weekEnd, -1));

  const [bookingsRes, membersRes, overridesRes, ptoRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        `
          id,
          scheduled_at,
          duration_minutes,
          status,
          service_type,
          assigned_to,
          address,
          client:clients ( name )
        `,
      )
      .gte("scheduled_at", weekStart.toISOString())
      .lt("scheduled_at", weekEnd.toISOString())
      .order("scheduled_at", { ascending: true }),
    supabase
      .from("memberships")
      // display_name is the shadow-member field (profile_id IS NULL),
      // populated when the owner adds an employee manually instead of
      // inviting them by email. Without it here, manually-added
      // employees showed up as "Unnamed" in scheduling because there
      // was no linked profiles row.
      .select(
        "id, role, status, display_name, profile:profiles ( full_name )",
      )
      .eq("status", "active")
      .in("role", ["employee", "admin", "owner"]),
    // availability_overrides with kind='off' that land inside the
    // displayed range. kind='custom' is ignored here (v1 shading is
    // "fully off" only — partial shading for custom-hours is a
    // follow-up once the UX is validated).
    (supabase
      .from("availability_overrides" as never)
      .select("membership_id, date, kind")
      .eq("kind" as never, "off" as never)
      .gte("date" as never, rangeStartStr as never)
      .lte("date" as never, rangeEndStr as never)) as unknown as Promise<{
      data: Array<{
        membership_id: string;
        date: string;
      }> | null;
      error: { message: string } | null;
    }>,
    // Approved PTO overlapping the range. A request from Mon-Fri with
    // only Wed in view still contributes Wed as off.
    supabase
      .from("pto_requests")
      .select("employee_id, start_date, end_date, status")
      .eq("status", "approved")
      .lte("start_date", rangeEndStr)
      .gte("end_date", rangeStartStr),
  ]);

  if (bookingsRes.error) throw bookingsRes.error;
  if (membersRes.error) throw membersRes.error;

  const bookings: ScheduleBooking[] = (bookingsRes.data ?? []).map((b) => ({
    id: b.id,
    scheduled_at: b.scheduled_at,
    duration_minutes: b.duration_minutes,
    status: b.status,
    service_type: b.service_type,
    assigned_to: b.assigned_to,
    client_name: b.client?.name ?? "—",
    address: b.address,
  }));

  const employees: ScheduleEmployee[] = (membersRes.data ?? [])
    .map((m) => ({
      id: m.id,
      // Shared fallback chain: display_name → profile.full_name →
      // "Unknown". Same helper used by booking options, employees
      // list, etc. so shadow members look identical everywhere.
      name: memberDisplayName(m),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Merge overrides + PTO into a single "employee → off dates" map.
  const offDaysMap = new Map<string, Set<string>>();
  const addOff = (memberId: string, date: string) => {
    let s = offDaysMap.get(memberId);
    if (!s) {
      s = new Set();
      offDaysMap.set(memberId, s);
    }
    s.add(date);
  };

  for (const row of overridesRes.data ?? []) {
    addOff(row.membership_id, row.date);
  }

  // Expand each PTO range into individual YYYY-MM-DD dates, clamped
  // to the display range so we don't balloon the set with dates we'll
  // never render.
  for (const req of (ptoRes.data ?? []) as Array<{
    employee_id: string;
    start_date: string;
    end_date: string;
  }>) {
    const clampStart =
      req.start_date < rangeStartStr ? rangeStartStr : req.start_date;
    const clampEnd =
      req.end_date > rangeEndStr ? rangeEndStr : req.end_date;
    // Iterate day-by-day via Date math. start_date / end_date are
    // plain YYYY-MM-DD so this is safe from tz drift.
    const [sy, sm, sd] = clampStart.split("-").map(Number);
    const [ey, em, ed] = clampEnd.split("-").map(Number);
    const cursor = new Date(sy, sm - 1, sd);
    const endLocal = new Date(ey, em - 1, ed);
    while (cursor <= endLocal) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, "0");
      const d = String(cursor.getDate()).padStart(2, "0");
      addOff(req.employee_id, `${y}-${m}-${d}`);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const offDays: OffDaysByEmployee = {};
  for (const [id, set] of offDaysMap) {
    offDays[id] = Array.from(set).sort();
  }

  return { bookings, employees, offDays };
}

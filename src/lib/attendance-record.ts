import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAutomationEnabled } from "@/lib/automation-defaults";
import {
  attendanceExceptions,
  attendanceMark,
  summarizeAttendance,
  type AttendanceMark,
  type AttendanceSummary,
} from "@/lib/attendance";
import type { JobStateCrewRow, JobStateShift } from "@/lib/job-state";

/**
 * The attendance record for one person's employee file: every job she was
 * rostered on in the window, judged by src/lib/attendance.ts.
 *
 * Read-only, and read from the same three facts the job rules read
 * (booking, roster, shifts), so it can never say something the job page
 * doesn't. Four queries, all after the first.
 */

export const ATTENDANCE_WINDOW_DAYS = 90;

export type AttendanceLine = AttendanceMark & {
  scheduledAt: string;
  clientName: string | null;
  serviceLabel: string | null;
};

export type AttendanceRecord = {
  windowDays: number;
  summary: AttendanceSummary;
  /** Newest first. */
  exceptions: AttendanceLine[];
};

type RosterRow = {
  booking: {
    id: string;
    status: string;
    scheduled_at: string;
    duration_minutes: number | null;
    divide_hours_evenly: boolean | null;
    service_type_label: string | null;
    client: { name: string | null } | null;
  } | null;
};

export async function loadAttendanceRecord(
  db: SupabaseClient,
  organizationId: string,
  membershipId: string,
  opts: { now?: number; windowDays?: number } = {},
): Promise<AttendanceRecord> {
  const now = opts.now ?? Date.now();
  const windowDays = opts.windowDays ?? ATTENDANCE_WINDOW_DAYS;
  const empty: AttendanceRecord = {
    windowDays,
    summary: summarizeAttendance([]),
    exceptions: [],
  };

  const since = new Date(now - windowDays * 86_400_000).toISOString();
  const { data: roster, error } = (await db
    .from("booking_assignees" as never)
    .select(
      "booking:bookings!inner ( id, status, scheduled_at, duration_minutes, divide_hours_evenly, service_type_label, client:clients ( name ) )",
    )
    .eq("membership_id" as never, membershipId as never)
    .eq("booking.organization_id" as never, organizationId as never)
    .gte("booking.scheduled_at" as never, since as never)
    .lte("booking.scheduled_at" as never, new Date(now).toISOString() as never)
    .neq("booking.status" as never, "cancelled" as never)) as unknown as {
    data: RosterRow[] | null;
    error: { message: string } | null;
  };
  if (error) {
    // Say so rather than render a clean record over a failed read.
    throw new Error(`[attendance] roster read failed: ${error.message}`);
  }
  const bookings = (roster ?? [])
    .map((r) => r.booking)
    .filter((b): b is NonNullable<RosterRow["booking"]> => b != null);
  if (bookings.length === 0) return empty;
  const ids = bookings.map((b) => b.id);

  const [crewRes, shiftRes, orgRes] = await Promise.all([
    db
      .from("booking_assignees")
      .select("booking_id, membership_id, split_start_offset_minutes, split_duration_minutes")
      .in("booking_id", ids) as unknown as Promise<{
      data: Array<JobStateCrewRow & { booking_id: string }> | null;
      error: { message: string } | null;
    }>,
    db
      .from("time_entries")
      .select("booking_id, employee_id, clock_in_at, clock_out_at")
      .in("booking_id", ids) as unknown as Promise<{
      data: Array<JobStateShift & { booking_id: string }> | null;
      error: { message: string } | null;
    }>,
    db
      .from("organizations")
      .select("automation_settings")
      .eq("id", organizationId)
      .maybeSingle() as unknown as Promise<{
      data: {
        automation_settings: Record<string, { enabled?: boolean } | undefined> | null;
      } | null;
      error: { message: string } | null;
    }>,
  ]);
  const failed = crewRes.error ?? shiftRes.error ?? orgRes.error;
  if (failed) throw new Error(`[attendance] read failed: ${failed.message}`);

  const crewByBooking = new Map<string, JobStateCrewRow[]>();
  for (const r of crewRes.data ?? []) {
    const list = crewByBooking.get(r.booking_id) ?? [];
    list.push(r);
    crewByBooking.set(r.booking_id, list);
  }
  const shiftsByBooking = new Map<string, JobStateShift[]>();
  for (const s of shiftRes.data ?? []) {
    const list = shiftsByBooking.get(s.booking_id) ?? [];
    list.push(s);
    shiftsByBooking.set(s.booking_id, list);
  }
  // Same precedence as syncJob and resolveShiftWindows: the row's own flag,
  // else the org default.
  const orgDivides = resolveAutomationEnabled(
    orgRes.data?.automation_settings ?? null,
    "divide_crew_hours",
  );

  const lines: AttendanceLine[] = [];
  for (const b of bookings) {
    const mark = attendanceMark(
      {
        bookingId: b.id,
        booking: {
          status: b.status,
          scheduled_at: b.scheduled_at,
          duration_minutes: b.duration_minutes ?? 0,
          divides_hours: b.divide_hours_evenly === true || orgDivides,
        },
        crew: crewByBooking.get(b.id) ?? [],
        shifts: shiftsByBooking.get(b.id) ?? [],
      },
      membershipId,
      now,
    );
    if (!mark) continue;
    lines.push({
      ...mark,
      scheduledAt: b.scheduled_at,
      clientName: b.client?.name ?? null,
      serviceLabel: b.service_type_label ?? null,
    });
  }
  lines.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));

  return {
    windowDays,
    summary: summarizeAttendance(lines),
    exceptions: attendanceExceptions(lines) as AttendanceLine[],
  };
}

/**
 * A person's attendance on the jobs she was rostered for.
 *
 * Svitlana (2026-10-29): "staff doesn't clock in / clocks out late — that is
 * recorded on their profiles for her to deal with ... if a cleaner doesn't
 * clock in it is up to the discretion of the owner." Sollos never kept
 * that record. The jobs ran, the no-shows were decided job by job, and the
 * pattern — the same person late every Tuesday — lived in the office's
 * memory. This writes it down, job by job, from facts that already exist.
 *
 * It records; it never judges. A no-show here is "rostered, never tapped,
 * window over" — exactly what deriveJobState calls one — and whether that
 * was a sick day, a swap nobody wrote down, or a problem is the owner's
 * call. Nothing reads this back into the job rules or the pay runs.
 *
 * Pure: no database, no clock. The same rule the Timesheets page applies
 * per shift (late = more than 5 minutes after the start), measured against
 * the person's OWN window — her split segment if she has one, else the
 * crew's shared length — so the second cleaner on a 9-to-1 / 1-to-5
 * hand-off is on time at 1, and a cleaner on a divided 18-hour house is
 * not "two hours over" for a 4.5-hour share she worked in five.
 */
import {
  jobWindowEndMs,
  teamMinutes,
  type JobStateBooking,
  type JobStateCrewRow,
  type JobStateShift,
} from "@/lib/job-state";

/** Same tolerance as the Timesheets punctuality column. */
export const ATTENDANCE_TOLERANCE_MINUTES = 5;

export type AttendanceJob = {
  bookingId: string;
  booking: Pick<
    JobStateBooking,
    "status" | "scheduled_at" | "duration_minutes" | "divides_hours"
  >;
  /** Everyone rostered on the job, this person included. */
  crew: JobStateCrewRow[];
  /** Every shift on the job, anyone's. */
  shifts: JobStateShift[];
};

export type AttendanceKind =
  /** Clocked in within tolerance of her own start. */
  | "on_time"
  /** Clocked in more than the tolerance after her own start. */
  | "late"
  /** Never clocked in and her window is over. */
  | "no_show";

export type AttendanceMark = {
  bookingId: string;
  kind: AttendanceKind;
  /** When she was due: the job's start plus her own offset, if any. */
  expectedStartMs: number;
  /** When her own window ends: her due time plus her own length. */
  expectedEndMs: number;
  /** Her first clock-in on the job, or null. */
  arrivedMs: number | null;
  /** Her last clock-out, or null while a shift is still open (or she never came). */
  leftMs: number | null;
  /** Minutes after her due time she clocked in; 0 unless late. */
  lateByMinutes: number;
  /**
   * Minutes she clocked out past her own window — or, when she arrived late,
   * past her own length from her arrival, so a late start isn't counted
   * twice. 0 unless over tolerance.
   */
  overByMinutes: number;
  /**
   * On a no-show: did anyone else clock in on the job? "Nobody tapped" is a
   * different thing from "the rest of the crew came and she didn't" — the
   * first is usually a job that ran without the app, the second is hers.
   */
  othersWorked: boolean;
};

/**
 * This person's own window on the job, mirroring resolveShiftWindows in
 * crew-hours.ts: a split segment wins; otherwise she starts with the job and
 * works the crew's shared length.
 */
function personWindow(
  job: AttendanceJob,
  membershipId: string,
): { startMs: number; endMs: number } {
  const start = new Date(job.booking.scheduled_at).getTime();
  const mine = job.crew.find((c) => c.membership_id === membershipId);
  if (mine && (mine.split_duration_minutes ?? 0) > 0) {
    const offset = mine.split_start_offset_minutes ?? 0;
    const s = start + offset * 60_000;
    return { startMs: s, endMs: s + (mine.split_duration_minutes as number) * 60_000 };
  }
  return {
    startMs: start,
    endMs: start + teamMinutes(job.booking, job.crew.length) * 60_000,
  };
}

/**
 * What the record says about one job, or null when there is nothing to say
 * yet: the job was cancelled, or she hasn't come and the window is still
 * open (deriveJobState's "waiting on" — still coming, not a no-show).
 */
export function attendanceMark(
  job: AttendanceJob,
  membershipId: string,
  now: number,
): AttendanceMark | null {
  if (job.booking.status === "cancelled") return null;
  if (!job.crew.some((c) => c.membership_id === membershipId)) return null;

  const { startMs, endMs } = personWindow(job, membershipId);
  const mine = job.shifts
    .filter((s) => s.employee_id === membershipId)
    .sort((a, b) => a.clock_in_at.localeCompare(b.clock_in_at));
  const othersWorked = job.shifts.some((s) => s.employee_id !== membershipId);
  const tol = ATTENDANCE_TOLERANCE_MINUTES * 60_000;

  if (mine.length === 0) {
    // Measured against the whole job's window, not just hers: the rules
    // wait for everyone rostered until the job is over, and so does this.
    if (now < jobWindowEndMs(job.booking, job.crew)) return null;
    return {
      bookingId: job.bookingId,
      kind: "no_show",
      expectedStartMs: startMs,
      expectedEndMs: endMs,
      arrivedMs: null,
      leftMs: null,
      lateByMinutes: 0,
      overByMinutes: 0,
      othersWorked,
    };
  }

  const arrivedMs = new Date(mine[0].clock_in_at).getTime();
  const lateMs = arrivedMs - startMs;
  const lateByMinutes = lateMs > tol ? Math.round(lateMs / 60_000) : 0;

  // Her last clock-out, only once every shift of hers is closed. An open
  // shift is the overrun cron's business, not a record yet.
  let leftMs: number | null = null;
  if (mine.every((s) => s.clock_out_at != null)) {
    leftMs = Math.max(...mine.map((s) => new Date(s.clock_out_at as string).getTime()));
  }
  // "Ran over" is past her window AND past her own length from when she
  // arrived. Arriving 70 minutes late and leaving 73 late is late once, not
  // twice; on Svit's history nearly every "over" was the late arrival
  // counted again. What's left is the real thing: stayed on, or forgot.
  const ownEndMs = Math.max(endMs, arrivedMs + (endMs - startMs));
  const overMs = leftMs == null ? 0 : leftMs - ownEndMs;
  const overByMinutes = overMs > tol ? Math.round(overMs / 60_000) : 0;

  return {
    bookingId: job.bookingId,
    kind: lateByMinutes > 0 ? "late" : "on_time",
    expectedStartMs: startMs,
    expectedEndMs: endMs,
    arrivedMs,
    leftMs,
    lateByMinutes,
    overByMinutes,
    othersWorked,
  };
}

export type AttendanceSummary = {
  /** Jobs with something to say (cancelled and still-coming jobs excluded). */
  jobs: number;
  onTime: number;
  late: number;
  /** Mean minutes late across the late jobs; 0 when none. */
  lateAverageMinutes: number;
  noShows: number;
  /** Of the no-shows, how many where nobody on the job tapped at all. */
  noShowsNobodyTapped: number;
  /** Jobs she clocked out past her own window (any arrival). */
  ranOver: number;
};

export function summarizeAttendance(marks: AttendanceMark[]): AttendanceSummary {
  const late = marks.filter((m) => m.kind === "late");
  const noShows = marks.filter((m) => m.kind === "no_show");
  return {
    jobs: marks.length,
    onTime: marks.filter((m) => m.kind === "on_time").length,
    late: late.length,
    lateAverageMinutes:
      late.length === 0
        ? 0
        : Math.round(late.reduce((n, m) => n + m.lateByMinutes, 0) / late.length),
    noShows: noShows.length,
    noShowsNobodyTapped: noShows.filter((m) => !m.othersWorked).length,
    ranOver: marks.filter((m) => m.overByMinutes > 0).length,
  };
}

/** The jobs worth a line on the file: anything that was not simply on time. */
export function attendanceExceptions(marks: AttendanceMark[]): AttendanceMark[] {
  return marks.filter((m) => m.kind !== "on_time" || m.overByMinutes > 0);
}

export type TimesheetEntry = {
  id: string;
  employee_id: string;
  employee_name: string;
  clock_in_at: string;
  clock_out_at: string | null;
  actual_minutes: number;
  is_open: boolean;
  /** Free-text notes — captured on manual entries, optional on live clocks. */
  notes: string | null;
  /** true when the row came from the Log-hours form (vs live clock-in/out). */
  is_manual: boolean;
  /** System flagged this shift as implausible — capped by the auto-close
   *  cron, or far over the scheduled job. Hours are NEVER auto-corrected;
   *  an owner confirms or fixes them. */
  needs_review: boolean;
  /** The auto-close cron wrote this clock-out, not a person. */
  auto_closed: boolean;
  // Booking details
  booking_id: string | null;
  /** Category for an off-job (no booking) clock-in: manager/admin/training/etc. */
  work_category: string | null;
  client_name: string | null;
  service_type: string | null;
  scheduled_at: string | null;
  estimated_minutes: number | null;
  booking_total_cents: number | null;
  /** Job address — the destination for the punch-location directions link. */
  booking_address: string | null;
  // Where the punches physically happened (browser geolocation, consented;
  // null when denied/unavailable). Captured since day one — these fields
  // are what finally makes them readable.
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  // Analysis
  punctuality: "early" | "on_time" | "late" | null;
  punctuality_minutes: number;
  completion: "under" | "on_target" | "over" | null;
  completion_diff_minutes: number;
  /**
   * Whole minutes this entry ran past the job's allotted time, measured from
   * max(scheduled start, clock-in) + allotted length — the same arithmetic
   * the field card and the clock-out cron use. 0 when within the allotment
   * or when the job has no length to be over.
   *
   * Derived at read time rather than stored, so it is correct for every
   * historical entry the moment this shipped and can never drift from the
   * booking if someone edits the job's duration afterwards.
   */
  over_allotted_minutes: number;
  /**
   * When this person's shift was due to end — max(clock-in, their segment
   * start) + their allotment, the same arithmetic the cron and the field
   * card use. Null for off-job time. The edit dialog offers it as a one-tap
   * correction, because "they actually finished when they were supposed to"
   * is the single most common fix for a capped shift.
   */
  expected_end_at: string | null;
  // Pay
  pay_rate_cents: number;
  pay_type: "hourly" | "flat" | "percent";
  earned_cents: number;
  /** Which pay system these hours belong to (era snapshot, falling back to
   *  the person's current engagement) — payroll runs vs contractor
   *  statements. The CSV export prints it so a payroll-shaped file can't
   *  silently mix in hours the statement system also pays. */
  engagement: "employee" | "subcontractor";
  /** Best assigned-job match for a stray (off-job) punch, if one clears the
   *  overlap bar — rendered as a one-tap "attach" chip. Never auto-applied. */
  attach_suggestion: {
    bookingId: string;
    clientName: string;
    scheduledAt: string;
    candidateCount: number;
  } | null;
};

export type EmployeeMeta = {
  id: string;
  name: string;
  /** Owner/admin/manager/employee — used by the picker to distinguish
   *  office staff from regular field crew. */
  role: string;
  pay_rate_cents: number;
  pay_type: "hourly" | "flat" | "percent";
  /** Which pay system they're in NOW — gates PTO hour summaries (a
   *  subcontractor's time off is unpaid unavailability, never PTO pay). */
  engagement: "employee" | "subcontractor";
};

/** Picker option for the Log-hours form. */
export type BookingOption = {
  id: string;
  scheduled_at: string;
  service_type: string | null;
  client_name: string;
};

export type PtoEntry = {
  id: string;
  employee_id: string;
  employee_name?: string;
  start_date: string;
  end_date: string;
  hours: number;
  status: "pending" | "approved" | "declined" | "cancelled";
  reason: string | null;
  /** Subcontractor requests are unpaid unavailability: the approval panel
   *  badges them and hides hours, so nobody approves contractor "PTO". */
  engagement: "employee" | "subcontractor";
};

/**
 * Time entries whose clock_in_at exists but clock_out_at is NULL. Used
 * by the timesheets page banner so owners can find and close forgotten
 * punches without scrolling through the full list.
 */
export type OpenShift = {
  id: string;
  employee_id: string;
  employee_name: string;
  clock_in_at: string;
  booking_id: string | null;
  client_name: string | null;
  service_type: string | null;
  /** Past the job's expected end + 2h grace (or 12h off-job) — a
   *  genuinely forgotten punch, not someone currently working. */
  overdue: boolean;
};

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
  // Booking details
  booking_id: string | null;
  /** Category for an off-job (no booking) clock-in: manager/admin/training/etc. */
  work_category: string | null;
  client_name: string | null;
  service_type: string | null;
  scheduled_at: string | null;
  estimated_minutes: number | null;
  booking_total_cents: number | null;
  // Analysis
  punctuality: "early" | "on_time" | "late" | null;
  punctuality_minutes: number;
  completion: "under" | "on_target" | "over" | null;
  completion_diff_minutes: number;
  // Pay
  pay_rate_cents: number;
  pay_type: "hourly" | "flat" | "percent";
  earned_cents: number;
};

export type EmployeeMeta = {
  id: string;
  name: string;
  /** Owner/admin/manager/employee — used by the picker to distinguish
   *  office staff from regular field crew. */
  role: string;
  pay_rate_cents: number;
  pay_type: "hourly" | "flat" | "percent";
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
};

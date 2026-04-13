export type TimesheetEntry = {
  id: string;
  employee_id: string;
  employee_name: string;
  clock_in_at: string;
  clock_out_at: string | null;
  actual_minutes: number;
  is_open: boolean;
  // Booking details
  booking_id: string | null;
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
  pay_rate_cents: number;
  pay_type: "hourly" | "flat" | "percent";
};

export type PtoEntry = {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  hours: number;
  status: "pending" | "approved";
  reason: string | null;
};

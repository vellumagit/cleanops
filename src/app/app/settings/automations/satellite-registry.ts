/**
 * Automations that live on their DOMAIN settings pages instead of the main
 * Automations page — Brian: "the internal stuff, we can actually move to
 * where it needs to live." Invoicing machinery beside the auto-send config,
 * payroll/timesheet machinery beside the pay-period calendar, the
 * recurring-invoice switch on the page that configures the cycles.
 *
 * Single source: the main page's STAGES no longer carry these entries, so
 * copy can't drift between the two homes. Client-facing messages (overdue
 * reminders, receipts) deliberately STAY on the Automations page — "unless
 * it has to do with a client."
 */

export type SatelliteAutomation = {
  key: string;
  title: string;
  description: string;
  trigger: string;
};

export const INVOICING_AUTOMATIONS: SatelliteAutomation[] = [
  {
    key: "auto_invoice_on_job_complete",
    title: "Auto-draft invoice on job complete",
    description:
      "Creates a draft invoice for the client automatically when a booking is marked completed. Pair with auto-send above to also email it at a set time the next day — or review and send each one yourself.",
    trigger: "Booking → Completed",
  },
  {
    key: "invoice_review_digest",
    title: "Morning invoice review digest",
    description:
      "Emails owners/admins each morning with yesterday's completed jobs and any invoices auto-sending later today — your window to fix or hold anything before a client sees it. Silent on days with nothing to report.",
    trigger: "Daily, early morning",
  },
  {
    key: "auto_void_overdue_invoices",
    title: "Auto-void long-overdue invoices",
    description:
      "Flips invoices to Void after 90 days past due with no payment activity. Stops the overdue reminder cron from continuing to email the client. Threshold configurable per-org.",
    trigger: "Daily at 03:30 UTC",
  },
  {
    key: "stripe_payout_alert",
    title: "Stripe payout notification",
    description:
      "Emails owners when Stripe sends a payout to your bank account, with the amount and expected arrival date.",
    trigger: "Stripe → payout.paid webhook",
  },
];

export const RECURRING_INVOICE_AUTOMATIONS: SatelliteAutomation[] = [
  {
    key: "auto_recurring_invoices",
    title: "Auto-generate recurring invoices",
    description:
      "Generates invoices on the schedules configured below. Supports weekly, biweekly, monthly, and quarterly cadences.",
    trigger: "Daily at 06:30 UTC",
  },
];

export const PAYROLL_AUTOMATIONS: SatelliteAutomation[] = [
  {
    key: "shift_clock_out_reminder",
    title: "Forgotten clock-out reminders",
    description:
      "Reminds a cleaner who is still clocked in past their job's expected end, then repeats. Once your grace period is up, the shift is capped, flagged for review, and your managers are notified (plus a text to the owner). Hours are never silently reduced — you confirm or correct the flagged shift yourself. Set both intervals below.",
    trigger: "Every 30 minutes",
  },
  {
    key: "overtime_warning",
    title: "Overtime warning",
    description:
      "Friday email to any employee whose week-to-date hours are within 20% of your overtime threshold (default 40h, configurable).",
    trigger: "Fridays at 15:00 UTC",
  },
  {
    key: "pto_status_notify",
    title: "PTO request decision email",
    description:
      "Emails the employee when their time-off request is approved, declined, or cancelled.",
    trigger: "PTO → Approved / Declined / Cancelled",
  },
  {
    key: "payroll_paid_receipt",
    title: "Payroll paid receipt",
    description:
      "Emails each employee a receipt when a payroll run is marked paid, showing amount, hours, regular/bonus/PTO breakdown.",
    trigger: "Payroll Run → Marked Paid",
  },
  {
    key: "divide_crew_hours",
    title: "Divide team-job hours across the crew",
    description:
      "When two or more cleaners work a job together, show each of them their share of the hours (job length ÷ crew) in the field app. Does not change the visit window, pay, or the client's bill.",
    trigger: "Applies to any job with 2+ crew",
  },
];
